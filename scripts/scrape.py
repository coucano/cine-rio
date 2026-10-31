#!/usr/bin/env python3
"""Récupère les séances de cinéma de Rio de Janeiro sur AdoroCinema
et écrit site/data/showtimes.json.

Usage : python3 scripts/scrape.py [--days 7] [--limit-theaters N]
"""
import argparse
import concurrent.futures as cf
import gzip
import datetime as dt
import html
import json
import os
import re
import time
import unicodedata
import urllib.error
import urllib.request

BASE = "https://www.adorocinema.com"
CITY_ID = "296781"  # Rio de Janeiro
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "site", "data", "showtimes.json")
FR_CACHE = os.path.join(ROOT, "site", "data", "titres-fr.json")
LB_CACHE = os.path.join(ROOT, "site", "data", "letterboxd-map.json")


def get(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if i == tries - 1:
                raise
        except Exception:
            if i == tries - 1:
                raise
        time.sleep(2 * (i + 1))


def list_theaters():
    theaters = {}
    page = 1
    while True:
        s = get(f"{BASE}/programacao/cinema/cidade-{CITY_ID}/?page={page}")
        if not s:
            break
        found = 0
        for blob in re.findall(r'data-theater="([^"]*)"', s):
            t = json.loads(html.unescape(blob))
            if t["id"] not in theaters:
                theaters[t["id"]] = {"name": t["name"].strip()}
                found += 1
        # adresse : bloc qui suit chaque cinéma
        for tid, addr in re.findall(r'cinema-([A-Z]\d+)/".{0,3000}?<address[^>]*>(.*?)</address>', s, re.S):
            if tid in theaters and "address" not in theaters[tid]:
                theaters[tid]["address"] = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", addr))).strip()
        if page == 1:
            last = max([int(n) for n in re.findall(r"\?page=(\d+)", s)] or [1])
        if not found or page >= last:
            break
        page += 1
    return theaters


def version_of(key, movie):
    if key.startswith("dubbed"):
        return "dub"
    langs = movie.get("languages") or []
    if "PORTUGUESE" in langs:
        return "nac"
    return "vo"


def fetch_theater_day(tid, day):
    out = []
    page = 1
    while True:
        url = f"{BASE}/_/showtimes/theater-{tid}/d-{day}/" + (f"p-{page}/" if page > 1 else "")
        s = get(url)
        if not s:
            break
        d = json.loads(s)
        out.extend(d.get("results") or [])
        pag = d.get("pagination") or {}
        if page >= int(pag.get("totalPages") or 1):
            break
        page += 1
    return out


def movie_info(m):
    year = (m.get("data") or {}).get("productionYear")
    release = None
    for r in m.get("releases") or []:
        rd = (r.get("releaseDate") or {}).get("date")
        if rd:
            release = rd[:10]
            break
    directors = [
        " ".join(filter(None, [c["person"].get("firstName"), c["person"].get("lastName")]))
        for c in m.get("credits") or []
        if (c.get("position") or {}).get("name") == "DIRECTOR" and c.get("person")
    ]
    return {
        "title": (m.get("title") or "").strip(),
        "original": (m.get("originalTitle") or "").strip(),
        "year": year,
        "release": release,
        "runtime": m.get("runtime"),
        "genres": [g.get("translate") for g in m.get("genres") or [] if g.get("translate")],
        "directors": directors,
        "countries": [c.get("localizedName") or c.get("name") for c in m.get("countries") or []],
        "langs": m.get("languages") or [],
        "poster": (m.get("poster") or {}).get("url"),
        "url": f"{BASE}/filmes/filme-{m['internalId']}/",
    }


def lb_slugify(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = s.lower().replace("'", "").replace("’", "")
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s


def lb_year(slug):
    """Année du film Letterboxd pour ce slug, ou None si la page n'existe pas."""
    try:
        s = get(f"https://letterboxd.com/film/{slug}/", tries=2)
    except Exception:
        return None
    if not s:
        return None
    m = re.search(r'<meta property="og:title" content="[^"]*\((\d{4})\)"', s)
    return int(m.group(1)) if m else None


def lb_details(slug):
    """Note moyenne Letterboxd, nombre de notes et identifiant IMDb d'un film."""
    try:
        s = get(f"https://letterboxd.com/film/{slug}/", tries=2) or ""
    except Exception:
        return {}
    out = {}
    m = re.search(r'"ratingValue":([0-9.]+)', s)
    if m:
        out["lbRating"] = round(float(m.group(1)), 2)
    m = re.search(r'"ratingCount":(\d+)', s)
    if m:
        out["lbVotes"] = int(m.group(1))
    m = re.search(r"imdb\.com/title/(tt\d+)", s)
    if m:
        out["imdb"] = m.group(1)
    return out


def allocine_title(fid):
    """Titre français : AlloCiné partage les identifiants de films d'AdoroCinema."""
    try:
        s = get(f"https://www.allocine.fr/film/fichefilm_gen_cfilm={fid}.html", tries=2)
    except Exception:
        return None
    m = s and re.search(r'<meta property="og:title" content="([^"]+)"', s)
    if not m:
        return None
    t = html.unescape(m.group(1))
    return re.sub(r"\s*-\s*(film|série)?\s*\d{4}.*$|\s*-\s*AlloCiné$", "", t).strip() or None


def add_imdb_ratings(films):
    """Notes IMDb depuis le fichier public d'IMDb (datasets.imdbws.com)."""
    wanted = {f["imdb"]: f for f in films.values() if f.get("imdb")}
    if not wanted:
        return
    try:
        req = urllib.request.Request("https://datasets.imdbws.com/title.ratings.tsv.gz", headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=120) as r, gzip.open(r, "rt") as fh:
            for line in fh:
                tid, _, rest = line.partition("\t")
                if tid in wanted:
                    rating, votes = rest.strip().split("\t")
                    wanted[tid]["imdbRating"] = float(rating)
                    wanted[tid]["imdbVotes"] = int(votes)
    except Exception as e:
        print(f"Notes IMDb indisponibles : {e}")


def resolve_letterboxd(film):
    """Devine le slug Letterboxd d'un film à partir de son titre original et de son année."""
    years = [film.get("year")]
    if film.get("release"):
        years.append(int(film["release"][:4]))
    years = {y for y in years if y}
    for title in dict.fromkeys([film["original"], film["title"]]):
        base = lb_slugify(title)
        if not base:
            continue
        cands = [f"{base}-{y}" for y in sorted(years)] + [base]
        for c in cands:
            y = lb_year(c)
            if y and (not years or any(abs(y - yy) <= 1 for yy in years)):
                return c
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--limit-theaters", type=int, default=0)
    args = ap.parse_args()

    today = dt.datetime.now(dt.timezone(dt.timedelta(hours=-3))).date()  # heure de Rio
    days = [(today + dt.timedelta(days=i)).isoformat() for i in range(args.days)]

    theaters = list_theaters()
    print(f"{len(theaters)} cinémas trouvés")
    tids = list(theaters)[: args.limit_theaters or None]

    films, shows = {}, []
    jobs = [(t, d) for t in tids for d in days]
    with cf.ThreadPoolExecutor(max_workers=6) as ex:
        futs = {ex.submit(fetch_theater_day, t, d): (t, d) for t, d in jobs}
        for f in cf.as_completed(futs):
            tid, day = futs[f]
            try:
                results = f.result()
            except Exception as e:
                print(f"  échec {tid} {day}: {e}")
                continue
            for r in results:
                m = r.get("movie")
                if not m:
                    continue
                fid = str(m["internalId"])
                if fid not in films:
                    films[fid] = movie_info(m)
                for key, lst in (r.get("showtimes") or {}).items():
                    for st in lst or []:
                        tags = st.get("tags") or []
                        extra = [p for p in (st.get("projection") or []) if p not in ("DIGITAL",)]
                        if any("3D" in t for t in tags):
                            extra.append("3D")
                        shows.append([fid, tid, st["startsAt"][:16], version_of(key, m), sorted(set(extra))])

    # Correspondance Letterboxd, en cache d'une exécution à l'autre
    try:
        cache = json.load(open(LB_CACHE))
    except Exception:
        cache = {}
    todo = [fid for fid in films if fid not in cache or (cache[fid] is None and cache.get(f"{fid}:t", 0) < time.time() - 3 * 86400)]
    print(f"{len(films)} films, {len(todo)} à chercher sur Letterboxd")
    with cf.ThreadPoolExecutor(max_workers=4) as ex:
        for fid, slug in zip(todo, ex.map(lambda i: resolve_letterboxd(films[i]), todo)):
            cache[fid] = slug
            cache[f"{fid}:t"] = int(time.time())
    for fid, f in films.items():
        f["lb"] = cache.get(fid)

    # Notes Letterboxd (et identifiant IMDb), relues à chaque exécution
    with_lb = [f for f in films.values() if f["lb"]]
    with cf.ThreadPoolExecutor(max_workers=4) as ex:
        for f, info in zip(with_lb, ex.map(lambda f: lb_details(f["lb"]), with_lb)):
            f.update(info)
    add_imdb_ratings(films)

    # Titres français, en cache (ils ne changent pas)
    try:
        fr_cache = json.load(open(FR_CACHE))
    except Exception:
        fr_cache = {}
    todo = [fid for fid in films if fid not in fr_cache]
    with cf.ThreadPoolExecutor(max_workers=4) as ex:
        for fid, t in zip(todo, ex.map(allocine_title, todo)):
            if t:
                fr_cache[fid] = t
    for fid, f in films.items():
        if fr_cache.get(fid):
            f["fr"] = fr_cache[fid]
    with open(FR_CACHE, "w") as fh:
        json.dump(fr_cache, fh, ensure_ascii=False, indent=0, sort_keys=True)

    used = {s[1] for s in shows}
    shows.sort(key=lambda s: (s[2], s[1]))
    data = {
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "days": days,
        "theaters": {t: theaters[t] for t in tids if t in used},
        "films": films,
        "shows": shows,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
    with open(LB_CACHE, "w") as fh:
        json.dump(cache, fh, ensure_ascii=False, indent=0, sort_keys=True)
    print(f"OK : {len(shows)} séances, {len(films)} films, {len(data['theaters'])} cinémas")


if __name__ == "__main__":
    main()

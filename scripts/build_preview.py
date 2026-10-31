#!/usr/bin/env python3
"""Fabrique un aperçu autonome (une seule page HTML, données et affiches incluses).

Usage : python3 scripts/build_preview.py site watchlist.json sortie.html
"""
import base64, concurrent.futures as cf, io, json, re, sys, urllib.request

site, wl, out = sys.argv[1:4]
data = json.load(open(f"{site}/data/showtimes.json"))


def thumb(url):
    try:
        url = re.sub(r"(acsta\.net)/(?!c_)", r"\1/c_160_213/", url)
        raw = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=30).read()
        from PIL import Image
        im = Image.open(io.BytesIO(raw)).convert("RGB")
        im.thumbnail((120, 180))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=70)
        return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    except Exception as e:
        print("affiche ignorée", url, e)
        return None


films = [f for f in data["films"].values() if f.get("poster")]
with cf.ThreadPoolExecutor(8) as ex:
    for f, t in zip(films, ex.map(lambda f: thumb(f["poster"]), films)):
        f["poster"] = t

html = open(f"{site}/index.html").read()
inject = ("<script>window.EMBED_DATA=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) +
          ";window.EMBED_WATCHLIST=" + open(wl).read() + ";</script>\n<script>")
open(out, "w").write(html.replace("<script>", inject, 1))

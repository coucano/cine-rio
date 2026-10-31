// Fonction serveur (Vercel) : renvoie la watchlist publique d'un membre Letterboxd.
// GET /api/watchlist?user=pseudo  ->  { user, films: [[slug, titre, année], ...] }

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function decode(s) {
  return s
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}

async function fetchPage(user, page) {
  const url = `https://letterboxd.com/${user}/watchlist/` + (page > 1 ? `page/${page}/` : "");
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en" } });
    if (r.status === 404) return null;
    if (r.ok) return r.text();
    await new Promise((res) => setTimeout(res, 800 * (i + 1)));
  }
  throw new Error(`Letterboxd a répondu une erreur pour la page ${page}`);
}

function parse(html) {
  const films = [];
  const re = /data-component-class="LazyPoster"[^>]*?data-item-name="([^"]*)"[^>]*?data-item-slug="([^"]*)"/g;
  let m;
  while ((m = re.exec(html))) {
    const name = decode(m[1]);
    const y = name.match(/\s\((\d{4})\)$/);
    films.push([m[2], y ? name.slice(0, y.index) : name, y ? +y[1] : null]);
  }
  return films;
}

async function getWatchlist(user) {
  const first = await fetchPage(user, 1);
  if (first === null) return null;
  const pages = [...first.matchAll(/\/watchlist\/page\/(\d+)\//g)].map((m) => +m[1]);
  const last = Math.max(1, ...pages);
  const films = parse(first);
  const rest = [];
  for (let p = 2; p <= last; p++) rest.push(p);
  // quelques pages à la fois pour ménager Letterboxd
  for (let i = 0; i < rest.length; i += 6) {
    const htmls = await Promise.all(rest.slice(i, i + 6).map((p) => fetchPage(user, p)));
    for (const h of htmls) if (h) films.push(...parse(h));
  }
  return films;
}

async function handler(req, res) {
  const q = new URL(req.url, "http://x").searchParams;
  const user = (q.get("user") || "").trim().toLowerCase();
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (!/^[a-z0-9_]{1,40}$/.test(user)) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: "Pseudo Letterboxd invalide" }));
  }
  try {
    const films = await getWatchlist(user);
    if (films === null) {
      res.statusCode = 404;
      return res.end(JSON.stringify({ error: "Membre introuvable ou watchlist privée" }));
    }
    res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=86400");
    res.end(JSON.stringify({ user, films }));
  } catch (e) {
    res.statusCode = 502;
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
}

module.exports = handler;
module.exports.getWatchlist = getWatchlist;

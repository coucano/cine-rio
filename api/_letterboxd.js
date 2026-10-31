// Lecture de la watchlist publique d'un membre Letterboxd : [[slug, titre, année], ...]

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
  const last = Math.min(Math.max(1, ...pages), 400); // 400 pages = 11 200 films au plus
  const films = parse(first);
  const rest = [];
  for (let p = 2; p <= last; p++) rest.push(p);
  // quelques pages à la fois pour ménager Letterboxd
  const batch = rest.length > 60 ? 4 : 6;
  for (let i = 0; i < rest.length; i += batch) {
    const htmls = await Promise.all(rest.slice(i, i + batch).map((p) => fetchPage(user, p)));
    for (const h of htmls) if (h) films.push(...parse(h));
  }
  return films;
}

// Synchro par petits bouts : la watchlist est triée des derniers ajouts aux plus anciens,
// on lit donc les premières pages jusqu'à retrouver un film déjà connu.
// Renvoie la nouvelle liste, null si le membre n'existe plus, ou undefined s'il faut tout relire.
async function getNewEntries(user, known, maxPages = 5) {
  const knownSlugs = new Set(known.map((f) => f[0]));
  const added = [];
  for (let page = 1; page <= maxPages; page++) {
    const html = await fetchPage(user, page);
    if (html === null) return page === 1 ? null : added.concat(known);
    const films = parse(html);
    for (const f of films) {
      if (knownSlugs.has(f[0])) return added.concat(known);
      added.push(f);
    }
    if (films.length < 28) return added; // dernière page atteinte sans film connu : tout a été remplacé
  }
  return undefined;
}

module.exports = { getWatchlist, getNewEntries };

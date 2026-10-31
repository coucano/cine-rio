// GET /api/watchlist?user=pseudo         -> watchlist gardée sur le site (lue sur Letterboxd la première fois)
// GET /api/watchlist?user=pseudo&sync=1  -> relit la watchlist sur Letterboxd (au plus une fois par heure)
// Réponse : { user, syncedAt, films: [[slug, titre, année], ...] }

const { getWatchlist } = require("./_letterboxd");
const store = require("./_store");

const SYNC_COOLDOWN = 3600e3;

function send(res, code, body) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  const q = new URL(req.url, "http://x").searchParams;
  const user = (q.get("user") || "").trim().toLowerCase();
  if (!/^[a-z0-9_]{1,40}$/.test(user)) return send(res, 400, { error: "Pseudo Letterboxd invalide" });
  try {
    let rec = await store.load(user);
    const wantSync = q.get("sync") === "1";
    if (rec && wantSync && Date.now() - rec.t < SYNC_COOLDOWN) {
      const min = Math.ceil((SYNC_COOLDOWN - (Date.now() - rec.t)) / 60e3);
      return send(res, 429, { error: `Déjà synchronisée récemment, réessaie dans ${min} min`, user, syncedAt: rec.t, films: rec.films });
    }
    if (!rec || wantSync) {
      if (!(await store.allowFetch())) {
        const body = { error: "Le site est très sollicité, réessaie dans une minute" };
        return rec ? send(res, 429, { ...body, user, syncedAt: rec.t, films: rec.films }) : send(res, 503, body);
      }
      const films = await getWatchlist(user);
      if (films === null) return send(res, 404, { error: "Membre introuvable ou watchlist privée" });
      rec = await store.save(user, films);
    }
    send(res, 200, { user, syncedAt: rec.t, films: rec.films });
  } catch (e) {
    send(res, 502, { error: String(e.message || e) });
  }
};

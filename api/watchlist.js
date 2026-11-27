// GET /api/watchlist?user=pseudo         -> watchlist gardée sur le site (lue sur Letterboxd la première fois)
// GET /api/watchlist?user=pseudo&sync=1  -> resynchronise avec Letterboxd (au plus une fois toutes les 10 min)
// Réponse : { user, syncedAt, films: [[slug, titre, année], ...] }

const { syncUser } = require("./_sync");
const store = require("./_store");

const SYNC_COOLDOWN = 10 * 60e3;

function send(res, code, body) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  const q = new URL(req.url, "http://x").searchParams;
  const user = (q.get("user") || "").trim().toLowerCase();
  if (!/^[a-z0-9_]{1,40}$/.test(user)) return send(res, 400, { code: "invalid", error: "Pseudo Letterboxd invalide" });
  try {
    let rec = await store.load(user);
    const wantSync = q.get("sync") === "1";
    if (rec && wantSync && Date.now() - rec.t < SYNC_COOLDOWN) {
      const min = Math.ceil((SYNC_COOLDOWN - (Date.now() - rec.t)) / 60e3);
      return send(res, 429, { code: "cooldown", min, error: `Déjà synchronisée récemment, réessaie dans ${min} min`, user, syncedAt: rec.t, films: rec.films });
    }
    if (!rec || wantSync) {
      const ip = String(req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || "").split(",")[0].trim();
      if (!(await store.allowVisitor(ip))) {
        const body = { code: "visitor", error: "Trop de pseudos demandés depuis cette connexion, réessaie dans une heure" };
        return rec ? send(res, 429, { ...body, user, syncedAt: rec.t, films: rec.films }) : send(res, 429, body);
      }
      if (!(await store.allowFetch())) {
        const body = { code: "busy", error: "Le site est très sollicité, réessaie dans une minute" };
        return rec ? send(res, 429, { ...body, user, syncedAt: rec.t, films: rec.films }) : send(res, 503, body);
      }
      const synced = await syncUser(user, rec);
      if (synced === null) return send(res, 404, { code: "notfound", error: "Membre introuvable ou watchlist privée" });
      rec = synced;
    }
    send(res, 200, { user, syncedAt: rec.t, stored: store.hasDatabase, films: rec.films });
  } catch (e) {
    send(res, 502, { error: String(e.message || e) });
  }
};

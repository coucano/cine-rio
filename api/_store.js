// Stockage des watchlists dans une base Redis Upstash (variables fournies par Vercel).
// Sans base configurée (tests en local), on garde tout en mémoire.

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const memory = new Map();

async function redis(...cmds) {
  const r = await fetch(`${URL_}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error(`Base de données : erreur ${r.status}`);
  return (await r.json()).map((x) => x.result);
}

// Chaque pseudo : wl:<pseudo> = { t: date de synchro, films }, plus deux index triés
// par date de synchro (« synced ») et de dernière visite (« seen »).
// visit=false : lecture par la synchro de nuit, qui ne compte pas comme une visite
async function load(user, visit = true) {
  if (!URL_) return memory.get(user) || null;
  const cmds = [["GET", `wl:${user}`]];
  if (visit) cmds.push(["ZADD", "seen", Date.now(), user]);
  const [v] = await redis(...cmds);
  return v ? JSON.parse(v) : null;
}

// t : dernière synchro ; full : dernière relecture complète
async function save(user, films, full = Date.now()) {
  const rec = { t: Date.now(), full, films };
  if (!URL_) return memory.set(user, rec), rec;
  await redis(
    ["SET", `wl:${user}`, JSON.stringify(rec)],
    ["ZADD", "synced", rec.t, user],
    ["ZADD", "seen", rec.t, user],
  );
  return rec;
}

// Pseudos dont la dernière synchro est antérieure à `before`, les plus anciens d'abord
async function staleUsers(before, limit) {
  if (!URL_) return [...memory].filter(([, r]) => r.t < before).map(([u]) => u).slice(0, limit);
  const [list] = await redis(["ZRANGE", "synced", "-inf", before, "BYSCORE", "LIMIT", 0, limit]);
  return list || [];
}

// Oublie les pseudos qui ne sont pas revenus depuis `before`
async function forgetInactive(before) {
  if (!URL_) return 0;
  const [list] = await redis(["ZRANGE", "seen", "-inf", before, "BYSCORE"]);
  if (!list || !list.length) return 0;
  await redis(["DEL", ...list.map((u) => `wl:${u}`)], ["ZREM", "synced", ...list], ["ZREM", "seen", ...list]);
  return list.length;
}

// Limite globale : au plus `max` lectures de watchlist sur Letterboxd par minute, pour tout le site
async function allowFetch(max = 20) {
  const key = `lbfetch:${Math.floor(Date.now() / 60e3)}`;
  if (!URL_) {
    memory.set(key, (memory.get(key) || 0) + 1);
    return memory.get(key) <= max;
  }
  const [n] = await redis(["INCR", key], ["EXPIRE", key, 120]);
  return n <= max;
}

// Limite par visiteur : au plus `max` lectures sur Letterboxd par heure depuis une même adresse,
// pour qu'on ne puisse pas remplir la base avec des pseudos au hasard.
// L'adresse n'est pas gardée en clair : seule une empreinte courte sert de compteur, effacé après deux heures.
async function allowVisitor(ip, max = 10) {
  const id = require("crypto").createHash("sha256").update("cine-rio:" + ip).digest("hex").slice(0, 16);
  const key = `ip:${id}:${Math.floor(Date.now() / 3600e3)}`;
  if (!URL_) {
    memory.set(key, (memory.get(key) || 0) + 1);
    return memory.get(key) <= max;
  }
  const [n] = await redis(["INCR", key], ["EXPIRE", key, 7200]);
  return n <= max;
}

module.exports = { load, save, staleUsers, forgetInactive, allowFetch, allowVisitor, hasDatabase: !!URL_ };

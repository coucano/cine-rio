// Lancé chaque nuit par Vercel (voir vercel.json) : resynchronise les watchlists
// vieilles de plus d'une semaine, quelques-unes à la fois pour ménager Letterboxd,
// et oublie les pseudos qui ne sont pas revenus depuis six mois.

const { getWatchlist } = require("./_letterboxd");
const store = require("./_store");

const WEEK = 7 * 864e5;
const BUDGET_MS = 50e3;

module.exports = async function handler(req, res) {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    res.statusCode = 401;
    return res.end("non autorisé");
  }
  const start = Date.now();
  const forgotten = await store.forgetInactive(Date.now() - 180 * 864e5);
  const users = await store.staleUsers(Date.now() - WEEK, 40);
  const done = [];
  for (const user of users) {
    if (Date.now() - start > BUDGET_MS) break;
    try {
      const films = await getWatchlist(user);
      if (films) await store.save(user, films);
      done.push(user);
    } catch (e) {
      console.log(`échec ${user}: ${e.message}`);
    }
  }
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ synced: done.length, waiting: users.length - done.length, forgotten }));
};

// Lancé chaque nuit par Vercel (voir vercel.json) : resynchronise les watchlists
// qui ne l'ont pas été depuis 20 h, quatre à la fois, dans la limite de 50 secondes,
// et oublie les pseudos qui ne sont pas revenus depuis six mois.

const { syncUser } = require("./_sync");
const store = require("./_store");

const BUDGET_MS = 50e3;
const PARALLEL = 4;

module.exports = async function handler(req, res) {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    res.statusCode = 401;
    return res.end("non autorisé");
  }
  const start = Date.now();
  const forgotten = await store.forgetInactive(Date.now() - 180 * 864e5);
  const users = await store.staleUsers(Date.now() - 20 * 3600e3, 2000);
  let synced = 0, i = 0;
  while (i < users.length && Date.now() - start < BUDGET_MS) {
    const batch = users.slice(i, i + PARALLEL);
    i += batch.length;
    await Promise.all(batch.map(async (user) => {
      try {
        await syncUser(user, await store.load(user, false));
        synced++;
      } catch (e) {
        console.log(`échec ${user}: ${e.message}`);
      }
    }));
  }
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ synced, waiting: users.length - i, forgotten }));
};

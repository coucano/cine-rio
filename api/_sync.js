// Synchronise la watchlist d'un pseudo : par petits bouts d'habitude,
// en entier la première fois puis une fois par semaine (pour voir les films retirés).

const { getWatchlist, getNewEntries } = require("./_letterboxd");
const store = require("./_store");

const FULL_EVERY = 7 * 864e5;

async function syncUser(user, rec) {
  let films, full = false;
  if (rec && rec.full && Date.now() - rec.full < FULL_EVERY) {
    films = await getNewEntries(user, rec.films);
  }
  if (films === undefined) {
    films = await getWatchlist(user);
    full = true;
  }
  if (films === null) return null;
  return store.save(user, films, full ? Date.now() : rec.full);
}

module.exports = { syncUser };

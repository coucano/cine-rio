# Ciné Rio

Les séances de cinéma de la semaine à Rio de Janeiro (source : AdoroCinema), avec les films
de ta watchlist Letterboxd mis en évidence et un filtre VO / dublado.

- `scripts/scrape.py` récupère les séances et écrit `site/data/showtimes.json`.
  Il tourne chaque nuit grâce à GitHub Actions (`.github/workflows/refresh.yml`).
- `site/index.html` est la page du site.
- `api/watchlist.js` renvoie la watchlist d'un pseudo Letterboxd. Elle est lue sur Letterboxd
  la première fois, puis gardée dans une base Redis Upstash (branchée depuis Vercel, onglet Storage).
  Le bouton « Synchroniser » la relit au plus une fois par heure par pseudo, et le site ne fait
  jamais plus de 20 lectures Letterboxd par minute au total.
- `api/cron-sync.js` tourne chaque nuit (Vercel Cron) : il resynchronise les watchlists vieilles
  d'une semaine et oublie les pseudos absents depuis six mois.

Hébergement : Vercel, branché sur ce dépôt. Chaque mise à jour des séances redéploie le site.

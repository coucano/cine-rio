# Ciné Rio

Les séances de cinéma de la semaine à Rio de Janeiro (source : AdoroCinema), avec les films
de ta watchlist Letterboxd mis en évidence et un filtre VO / dublado.

- `scripts/scrape.py` récupère les séances et écrit `site/data/showtimes.json`.
  Il tourne chaque nuit grâce à GitHub Actions (`.github/workflows/refresh.yml`).
- `site/index.html` est la page du site.
- `api/watchlist.js` lit la watchlist publique d'un pseudo Letterboxd (fonction Vercel).

Hébergement : Vercel, branché sur ce dépôt. Chaque mise à jour des séances redéploie le site.

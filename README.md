# Ciné Rio

Les séances de cinéma de la semaine à Rio de Janeiro (source : AdoroCinema), avec les films
de ta watchlist Letterboxd mis en évidence et un filtre VO / dublado.

- `scripts/scrape.py` récupère les séances et écrit `site/data/showtimes.json`.
  Il tourne deux fois par jour (5h et 14h à Rio) grâce à GitHub Actions (`.github/workflows/refresh.yml`).
  S'il trouve moins de la moitié des séances ou des cinémas du passage précédent (AdoroCinema en panne
  ou modifié), il n'enregistre rien et la tâche échoue, ce qui envoie un e-mail de GitHub.
  `python3 scripts/scrape.py --force` enregistre malgré tout.
- `site/index.html` est la page du site.
- `api/watchlist.js` renvoie la watchlist d'un pseudo Letterboxd. Elle est lue sur Letterboxd
  la première fois, puis gardée dans une base Redis Upstash (branchée depuis Vercel, onglet Storage).
  Le bouton « Synchroniser » la met à jour au plus une fois toutes les 10 minutes par pseudo, et le
  site ne fait jamais plus de 20 synchros à la demande par minute au total, ni plus de 10 par heure
  depuis une même connexion. Une watchlist est limitée à ses 5 040 derniers ajouts. La page garde aussi
  la watchlist dans le navigateur pour la mettre en évidence dès l'ouverture.
- `api/_sync.js` : la synchro ne relit d'habitude que les premières pages (derniers ajouts) jusqu'à
  retrouver un film connu, et relit la watchlist en entier une fois par semaine.
- `api/cron-sync.js` tourne chaque nuit (Vercel Cron) : il resynchronise les watchlists qui ne
  l'ont pas été depuis 20 h et oublie les pseudos absents depuis six mois.

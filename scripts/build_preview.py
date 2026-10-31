#!/usr/bin/env python3
"""Fabrique un aperçu autonome (une seule page HTML, données incluses)."""
import json, sys
site = sys.argv[1]; wl = sys.argv[2]; out = sys.argv[3]
html = open(f"{site}/index.html").read()
data = open(f"{site}/data/showtimes.json").read()
inject = ("<style>.poster{display:none}</style><script>window.EMBED_DATA=" + data +
          ";window.EMBED_WATCHLIST=" + open(wl).read() + ";</script>\n<script>")
html = html.replace("<script>", inject, 1)
open(out, "w").write(html)

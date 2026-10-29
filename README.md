# Mijn Voeding
Statische PWA, geen build-stap. Bestanden: index.html, style.css, app.js, sw.js, manifest.webmanifest.
- Openen in Visual Studio: Bestand > Openen > Map.
- Starten: `npm start` (opent een lokale server) en ga naar het getoonde adres. Een service worker werkt niet via file://.
- Tests: `npm test` (Node.js nodig).
- Na wijzigingen: verhoog `C` in sw.js, anders blijft de oude versie in de cache.
- Installeren op telefoon: zet de map op HTTPS-hosting (Netlify, Cloudflare Pages, GitHub Pages).

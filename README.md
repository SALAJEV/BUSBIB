# BUSBIB

BUSBIB is een mobile-first webapp voor het opzoeken van voertuigen van De Lijn. De applicatie combineert statische voertuigdata, realtime voertuigposities, halte-opzoekingen, weerinformatie, voertuigfoto's en een PWA/offline laag in een project.

De app is gemaakt voor spotters en reizigers die snel een voertuig willen terugvinden op nummer, nummerplaat of intern nummer, en daarna live willen volgen waar het zich bevindt.

## Inhoud

- [Projectoverzicht](#projectoverzicht)
- [Belangrijkste functies](#belangrijkste-functies)
- [Technische architectuur](#technische-architectuur)
- [Projectstructuur](#projectstructuur)
- [Databronnen](#databronnen)
- [Lokale ontwikkeling](#lokale-ontwikkeling)
- [Deploy en hosting](#deploy-en-hosting)
- [Configuratie](#configuratie)
- [Caching en offline gedrag](#caching-en-offline-gedrag)
- [Talen en themas](#talen-en-themas)
- [Privacy en aandachtspunten](#privacy-en-aandachtspunten)
- [Bekende beperkingen](#bekende-beperkingen)
- [Onderhoud](#onderhoud)

## Projectoverzicht

BUSBIB bestaat uit twee hoofdonderdelen:

1. Een statische frontend in plain HTML, CSS en JavaScript.
2. Een serverless API-laag in `functions/api.js` die requests naar externe bronnen proxyt en beveiligt.

De webapp draait als PWA, ondersteunt installatie op mobiele toestellen en heeft een service worker voor caching en offline gebruik.

## Belangrijkste functies

- Zoeken op voertuignummer, nummerplaat of intern nummer.
- Lijnen zoeken op lijnnummer, routenaam, `route_id` of halte/station, met suggesties en actuele ritten en bussen.
- Live voertuigtracking via De Lijn realtime data.
- Realtime kaartweergave met Leaflet en OpenStreetMap/CARTO tiles.
- De realtime kaart kan op voertuigmodel gefilterd worden; bus- en trammodellen staan apart en onbekende voertuigen blijven als aparte categorie zichtbaar.
- Weerkaart op basis van de huidige voertuiglocatie via Open-Meteo.
- Halte zoeken op code of naam, plus optioneel nabije haltes op basis van browserlocatie met beschikbare realtime vertrekken.
- Voertuig-, lijn- en haltefavorieten bewaren in `localStorage`.
- De startpagina toont actieve GTFS-meldingen die expliciet aan een favoriete lijn gekoppeld zijn. Als de meldingenfeed niet bereikbaar is, wordt dat vermeld in plaats van te melden dat er geen verstoringen zijn.
- Vergelijken van voertuigen.
- Voertuigfoto's tonen uit lokale `media/` assets.
- EXIF- en locatieverrijking voor foto's.
- PWA-installatie en offline fallback.
- Meertalige interface: Nederlands, Frans, Engels, Duits, Pools, Spaans en Russisch.

## Technische architectuur

### Frontend

De frontend wordt rechtstreeks geladen vanuit de rootbestanden:

- `index.html`: markup, shell, modals en basis bootstrap.
- `style.css`: volledige styling, responsive layouts en themas.
- `app.js`: alle clientlogica.
- `translations.js`: vertalingen en locale-configuratie.
- `sw.js`: service worker voor caching en offline gedrag.
- `manifest.json`: PWA manifest.

Er wordt bewust geen framework zoals React, Vue of Angular gebruikt. De app is volledig geschreven in vanilla JavaScript en werkt met DOM-manipulatie, lokale state, `localStorage`, `fetch`, `history` en een service worker.

De hoofdnavigatie gebruikt de deelbare URL's `/`, `/line`, `/stop` en `/menu`. De pagina's delen dezelfde frontend-shell en navigeren via de browsergeschiedenis. Oude links met `?view=lijn`, `?view=halte` of `?view=menu` blijven werken en worden omgezet naar de nieuwe paden. Voertuiglinks blijven beschikbaar via `/?bus=<nummer>` en optioneel `&compare=<nummer>`. Deelknoppen bij lijnresultaten en haltes maken links in de vorm `/line?route=<route_id>` en `/stop?stop=<haltecode>`.

### API-laag

`functions/api.js` fungeert als proxy tussen de frontend en externe APIs. Dat doet drie belangrijke dingen:

- de De Lijn API-key afschermen;
- requests valideren en limiteren;
- caching en fallbackgedrag voorzien voor realtime data.

De API ondersteunt drie resources via queryparameter `resource`:

- `realtime`
- `haltes`
- `weather`

## Projectstructuur

```text
.
|- index.html              # hoofd-HTML van de webapp
|- style.css               # alle styling
|- app.js                  # hoofdlogica van de frontend
|- translations.js         # vertalingen en locale mapping
|- sw.js                   # service worker
|- manifest.json           # PWA manifest
|- functions/
|  |- api.js               # serverless realtime API/proxy
|  `- dataset/[filename].js # same-origin proxy voor GTFS-datasets
|- media/
|  |- logo.png
|  |- favicon.ico
|  |- hansea.png
|  `- bus/                 # voertuigfoto's
`- python/
   `- script.py            # downloadscript / hulpscript
```

## Databronnen

De app gebruikt verschillende bronnen:

- De Lijn GTFS realtime API voor voertuigposities en vertragingen.
- De Lijn halte-zoek API voor halte-opzoekingen.
- Open-Meteo voor huidig weer op voertuiglocatie.
- OpenStreetMap/CARTO als kaarttiles.
- Voertuigdatasets (`buses.txt`, `trams.txt`, `trips.txt`, `routes.txt`, `stops.txt` en `feed_info.txt`) uit publieke R2-opslag, via de same-origin Pages-route `/dataset/<bestandsnaam>`. Bussen en trams worden samen doorzocht en onderscheiden met hun eigen pictogram.
- Foto-assets in het project of via externe statische hosting.
- Externe formulieren voor meldingen en feedback; foto-inzendingen lopen na configuratie via een eigen Pages Function.

Belangrijke URL-patronen die in de code gebruikt worden:

- `https://api.delijn.be/gtfs/v3/realtime`
- `https://api.delijn.be/DLZoekOpenData/v1/zoek/haltes/...`
- `https://api.open-meteo.com/v1/forecast`
- `https://unpkg.com/leaflet/dist/leaflet.css`
- `https://unpkg.com/leaflet/dist/leaflet.js`
- `https://busbibliotheek95.pages.dev/`

## Lokale ontwikkeling

Omdat dit project geen bundler of npm-config gebruikt, kun je de webapp lokaal relatief eenvoudig draaien met een statische server.

### Vereisten

- Een lokale HTTP-server.
- Optioneel Node.js, Python of een andere tool om statische bestanden te serveren.
- Voor de API-functie een omgeving die `functions/api.js` als serverless function ondersteunt.

### Eenvoudig lokaal serveren

Met Python:

```bash
python -m http.server 8000
```

Open daarna:

```text
http://localhost:8000
```

### Belangrijk bij lokaal testen

- Realtime data wordt opgehaald via `https://busbib.be/api`.
- Open de app via een lokale HTTP-server of de gedeployde website; rechtstreeks openen als `file:///.../index.html` werkt niet.
- Datasetbestanden worden via `/dataset/<bestandsnaam>` door een Cloudflare Pages Function opgehaald. Dit voorkomt browser-CORS-problemen met de R2-bucket.
- Een eenvoudige server zoals `python -m http.server` serveert alleen de frontendbestanden; datasets vereisen nog steeds de Cloudflare Pages-route of lokaal Cloudflare Pages/Wrangler Functions.
- Voor rechtstreeks openen of herladen van `/line`, `/stop` en `/menu` is een server nodig die deze paden naar `index.html` herschrijft; Cloudflare Pages gebruikt hiervoor `_redirects`. De eenvoudige Python-server ondersteunt deze herschrijvingen niet.
- Zonder geldige `DELIJN_API_KEY` werken realtime-, halte- en GTFS-waarschuwingsverzoeken niet.
- De service worker kan browsercache agressief vasthouden. Gebruik bij twijfel een harde refresh of verwijder de site data.

## Deploy en hosting

De codebase is duidelijk opgezet voor statische hosting plus serverless functies. In de huidige vorm lijkt het project afgestemd op Cloudflare Pages of een vergelijkbare omgeving.

### Weblaag

De frontendbestanden in de root kunnen als statische site gedeployed worden:

- `index.html`
- `style.css`
- `app.js`
- `translations.js`
- `manifest.json`
- `sw.js`
- `_redirects` voor het rechtstreeks openen van de navigatiepagina's
- `media/`

### API-laag

`functions/api.js` verwacht een environment variable:

```text
DELIJN_API_KEY
```

Zonder deze key falen realtime-, halte- en GTFS-waarschuwingsverzoeken. De sleutel staat uitsluitend in de serveromgeving; voeg hem nooit toe aan frontendcode.

### Foto's insturen configureren

De upload is standaard uitgeschakeld. Maak in Cloudflare een **privé** R2-bucket aan zonder publieke toegang en koppel die aan het Pages-project als R2-binding `PHOTO_UPLOADS`. Maak een Turnstile-widget voor de domeinen waarop de site draait, zet de publieke site key in `photoUploadTurnstileSiteKey` in `site-config.js` en stel de bijbehorende geheime sleutel als Pages-secret `TURNSTILE_SECRET` in. Configureer dezelfde bindings en secrets afzonderlijk voor de juiste productie- en previewomgeving en deploy opnieuw. Stel ook een Cloudflare WAF-rate-limitingregel in voor `POST /photo-upload` om kosten en misbruik te beperken. Zonder binding of sleutel werkt insturen niet.

De Pages Function accepteert alleen JPEG, PNG en WebP tot 8 MB, controleert de bestandssignatuur, toestemming en Turnstile, en schrijft uitsluitend naar `pending/` in de privébucket. Deze controle is geen volledige bestands- of malwarecontrole. Bekijk inzendingen zelf via het R2-dashboard; publicatie gebeurt niet automatisch. Voertuignummer en fotografennaam staan in de custom metadata als URL-gecodeerde tekst. Controleer de inhoud en rechten, verwijder ongewenste inzendingen en voeg goedgekeurde foto's handmatig toe aan de bestaande fotobibliotheek met de juiste naamsvermelding. De beheerder blijft verantwoordelijk voor toegangsbeheer, bewaartermijn en privacy van ingestuurde foto's en eventuele EXIF-gegevens.

### Versiebeheer van assets

De site gebruikt handmatige versiebumping voor cache-busting:

- `window.BB_ASSET_VERSION` in `index.html`
- `APP_VERSION` in `app.js`
- `CACHE_NAME` en versie-querystrings in `sw.js`

Bij een release moeten deze waarden synchroon blijven om te voorkomen dat oude assets in cache blijven hangen.

## Configuratie

Belangrijke configuratie zit verspreid over de frontend en API.

### In `app.js`

- `BASE_URL`: basis voor externe assets of datasets.
- `API_URL`: endpoint voor proxied data via `https://busbib.be/api`.
- `PYTHON_MAIN_DOWNLOAD_URL`
- `PHOTO_UPLOAD_FORM_URL`
- `REPORT_FORM_URL`
- `DE_LIJN_VEHICLE_TRACKING_URL`
- update-interval en cache-instellingen.

### In `functions/api.js`

- `UPSTREAM_TIMEOUT_MS`
- `REALTIME_EDGE_CACHE_TTL_SECONDS`
- `REALTIME_EDGE_STALE_WINDOW_SECONDS`
- `MAX_RESPONSE_SIZE_BYTES`

## Caching en offline gedrag

De app heeft caching op meerdere niveaus.

### Browser / PWA

`sw.js` cachet core assets zoals:

- `/`
- `/index.html`
- `/app.js`
- `/style.css`
- `/translations.js`
- de PWA-installatie-iconen

De service worker gebruikt een mix van:

- cache-first/stale-while-revalidate voor statische assets;
- network-first voor HTML navigatie;
- no-store voor API-calls en niet-gecachete voertuigfoto's.

De installatiecache wordt alleen geactiveerd als alle core assets beschikbaar zijn. Bij een mislukte download blijft de vorige service worker actief. Bijwerken van de shell vereist een nieuwe `CACHE_NAME` in `sw.js`; houd ook de assetversies in `index.html` en `sw.js` gelijk.

### Frontend runtime caching

De frontend bewaart onder meer:

- favorieten;
- instellingen;
- tijdelijke realtime feed cache.

### Edge caching in de API

Voor `realtime` gebruikt `functions/api.js` extra caching in `caches.default`, inclusief stale fallback wanneer upstream tijdelijk faalt.

## Talen en themas

### Talen

De interface ondersteunt:

- Nederlands
- Frans
- Engels
- Duits
- Pools
- Spaans
- Russisch

Vertalingen zitten in `translations.js`. Datum- en tijdformattering gebruikt locale mapping per taal.

### Themas

De app ondersteunt:

- automatisch licht/donker;
- aparte kleurthemas zoals classic, yellow, green, blue, orange, red en purple.

De UI is mobile-first en heeft aparte platformklassen voor onder meer:

- iOS
- Android
- Android WebView
- Android TV
- tablet
- phone
- standalone/PWA

## Privacy en aandachtspunten

Dit project verwerkt of gebruikt mogelijk:

- voertuigzoekopdrachten van gebruikers;
- favoriete voertuigen en instellingen in `localStorage`;
- locatiegerelateerde gegevens wanneer de app voertuig- of fotolocaties toont;
- externe requests naar De Lijn, Open-Meteo, Leaflet CDN en kaarttile-providers.

Let op:

- favorieten en instellingen worden lokaal in de browser bewaard;
- browserlocatie wordt alleen op expliciete vraag gebruikt om haltes in de buurt te rangschikken; BUSBIB stuurt deze locatie niet door naar de API;
- realtime data en weerdata komen van externe bronnen;
- voertuigfoto's kunnen EXIF-metadata bevatten;

Als je dit project publiek deployt, is het verstandig om ook een expliciete privacyverklaring en gebruiksvoorwaarden te onderhouden.

## Bekende beperkingen

- De app is sterk afhankelijk van externe APIs en tile servers.
- Zonder `DELIJN_API_KEY` werken belangrijke functies niet.
- Assetversies worden handmatig beheerd.
- De frontend is groot en gecentraliseerd in een `app.js` en een `style.css`, wat onderhoud uitdagender maakt.
- Leaflet en andere externe assets worden via CDN geladen.
- Grote lokale mediacollecties kunnen repositorygrootte en deploytijd verhogen.

## Onderhoud

### Aanbevolen releasechecklist

1. Werk code en assets bij.
2. Verhoog de websiteversie in `index.html`, `app.js` en `sw.js`.
3. Controleer of de service worker cacheversie mee verhoogd is.
4. Test zoekfunctie, realtime data, weerkaart en foto-overzicht.
5. Test PWA-installatie en harde refresh na update.

### Aanbevolen verbeteringen op termijn

- opsplitsen van `app.js` in modules;
- opsplitsen van `style.css` in thematische bestanden;
- automatische release/versioning;
- formele CI/CD pipeline;
- geautomatiseerde tests voor kernflows;
- documentatie van datasetformaat voor voertuigen en foto's.

## Credits

Het project is gemaakt door Busspotter 95.

Kaart- en databronnen die in de app genoemd worden:

- OpenStreetMap
- CARTO
- Open-Meteo
- De Lijn

## Licentie

Er is momenteel geen expliciet licentiebestand aanwezig in deze repository. Voeg een `LICENSE` toe als je duidelijk wilt maken onder welke voorwaarden anderen de code, data of media mogen gebruiken.

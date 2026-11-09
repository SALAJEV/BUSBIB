# Foto-upload configureren

De Cloudflare Pages Function `/photo-upload` vereist in elke gebruikte
omgeving (productie en eventueel preview):

- Een R2-bucketbinding `PHOTO_UPLOADS`.
- Een D1-databasebinding `PHOTO_UPLOAD_QUOTA`. Voer
  [photo-upload-quota.sql](photo-upload-quota.sql) uit op die database voordat
  uploads worden ingeschakeld.
- Het Turnstile-secret `TURNSTILE_SECRET` dat hoort bij de sitekey in
  [site-config.js](../site-config.js).
- Een afzonderlijk, willekeurig en geheim `PHOTO_UPLOAD_QUOTA_SECRET` voor het
  hashen van IP-adressen. Bewaar secrets als Cloudflare-secrets, niet in de
  repository.

Bij HTTP 503: controleer de Pages Function-logs voor ontbrekende configuratie,
een ontbrekende `CF-Connecting-IP`-header, een fout van Turnstile, D1 of R2.
De response onderscheidt `verification` (Turnstile kon niet worden bereikt of
gaf een HTTP-fout) van `unavailable` (configuratie of andere serverfout).
Gebruik voor lokale tests een Cloudflare-omgeving met de bindings en de
benodigde IP-header; een gewone statische server levert die niet.

Een ontbrekende quotaconfiguratie wordt bewust niet omzeild: zonder die
configuratie zijn uploads niet beschikbaar.

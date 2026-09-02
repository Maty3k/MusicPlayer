# Music Player

A vinyl-room music player — YouTube, MP3, and Spotify playback with playlists,
a records-conveyor collection view, a Song Scanner (ID3 tags + Gemini
album-cover identification), a Vinyl GIF Maker, and crackle SFX — rebuilt as a
multi-user **Laravel 13** app.

- **Accounts**: registration, login, email verification (Resend in
  production, `log` mailer locally).
- **Per-user libraries**: playlists and songs live in the database (SQLite
  locally, Postgres on Laravel Cloud) — nothing is written to disk at runtime.
- **Spotify**: per-user OAuth (tokens encrypted at rest), playlist import,
  one-click whole-library import (Liked Songs + every playlist, re-runnable
  to sync), Web Playback SDK streaming for Premium, and automatic
  Spotify→YouTube resolution so non-Premium accounts can play imports too.
- **Frontend**: the original hand-built vinyl UI (plain CSS/JS, no build
  step) served from `public/`, driven by Blade + JSON endpoints.

## Local development

```bash
composer install
cp .env.example .env && php artisan key:generate
touch database/database.sqlite
php artisan migrate
php artisan serve
```

Register at `http://localhost:8000/register`; the verification link lands in
`storage/logs/laravel.log` (local mailer is `log`). To load the pre-rewrite
library snapshot into your account:

```bash
php artisan music:import you@example.com
```

## Deployment

See [DEPLOY.md](DEPLOY.md) for the Laravel Cloud walkthrough (Postgres,
Resend, Spotify/Gemini keys).

## Repo layout

- `app/Http/Controllers` — player page + JSON endpoints (`/save-music`,
  `/spotify`, `/spotify-library`, `/spotify-resolve`, `/search-youtube`, `/scan-cover`).
- `public/css`, `public/js`, `public/vendor/gif.js` — the vinyl UI assets.
- `database/legacy/music.json` — library snapshot used by `music:import`.
- `MusicPlayerMobile/` — Expo/React Native shell (targets the legacy API;
  needs a Sanctum flow before it works against this backend).
- The original vanilla-PHP implementation lives in git history on `main`.

# Deploying to Laravel Cloud

This app is a standard Laravel 13 application: database-backed (no runtime
file storage), no Node build step (plain CSS/JS in `public/`), sessions/cache/
queue on the `database` drivers. That makes it a clean fit for Laravel Cloud's
ephemeral containers.

## One-time setup

1. **Create the app** at [cloud.laravel.com](https://cloud.laravel.com):
   *New Application* → connect the `Maty3k/MusicPlayer` GitHub repo → pick the
   branch to deploy (`laravel`, or `main` once merged). Runtime: **PHP 8.4**.

2. **Attach a database**: add a **Postgres** database to the environment.
   Laravel Cloud injects the `DB_*` connection variables automatically —
   no manual config needed. (The app uses SQLite locally, Postgres in prod;
   migrations are driver-agnostic.)

3. **Environment variables** (Environment → Variables):

   | Variable | Value |
   |---|---|
   | `MAIL_MAILER` | `resend` |
   | `RESEND_API_KEY` | your key from [resend.com/api-keys](https://resend.com/api-keys) |
   | `MAIL_FROM_ADDRESS` | a sender on a domain you verified in Resend |
   | `MAIL_FROM_NAME` | `Music Player` |
   | `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | optional — from the [Spotify dashboard](https://developer.spotify.com/dashboard) |
   | `SPOTIFY_REDIRECT_URI` | `https://<your-app-domain>/spotify?action=callback` — must ALSO be registered on the Spotify app |
   | `GEMINI_API_KEY` | optional — enables Song Scanner cover identification |

   `APP_KEY`, `APP_URL`, and the `DB_*` vars are managed by Cloud.

4. **Deploy commands**: ensure the deployment runs
   ```
   php artisan migrate --force
   ```
   (Cloud's default Laravel pipeline includes composer install + config cache.)

5. **Deploy.** The health check endpoint is `/up`.

## Import your existing library

After the first deploy and registering your account, run in a Cloud command
session (Commands → `php artisan ...`):

```
php artisan music:import you@example.com database/legacy/music.json
```

This loads the snapshot of the pre-rewrite library into your account.

## Email verification flow

Registration sends a signed verification link through Resend. Users can't
reach the player until verified (`verified` middleware). The resend button on
the verify page is throttled (6/min). Locally, `MAIL_MAILER=log` writes the
mail (with its link) to `storage/logs/laravel.log` so you can test without
Resend.

## Notes / limitations

- **Local dev**: `php artisan serve` + SQLite works out of the box
  (`database/database.sqlite`).
- **MusicPlayerMobile** is not yet compatible with the Laravel backend — it
  still targets the legacy endpoints with a shared-secret header. It needs a
  Sanctum token flow before it works against this version.
- User-added music is by URL (YouTube ID / MP3 URL / Spotify import) — nothing
  is stored on disk, so no object storage is required.

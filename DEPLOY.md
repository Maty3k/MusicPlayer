# Deploying to Laravel Cloud

This app is a standard Laravel 13 application: database-backed, no Node build
step (plain CSS/JS in `public/`), sessions/cache/queue on the `database`
drivers. That makes it a clean fit for Laravel Cloud's ephemeral containers —
with one exception:

> **⚠ Song uploads need a bucket in production.** The upload feature
> (`POST /upload-song`, served back via `GET /media/{file}`) follows the
> default filesystem disk. Laravel Cloud's container filesystem is
> **ephemeral**, so on the `local` driver uploaded songs are wiped on every
> deploy. Fix: in the environment, **Resources → create/attach a Bucket**,
> then redeploy — Cloud injects `FILESYSTEM_DISK=s3` plus the `AWS_*`
> credentials and uploads become persistent automatically (playback then
> redirects to short-lived signed bucket URLs). `/setup-check` has an
> "Uploads storage" line that confirms it. To pin uploads to a different
> disk than the app default, set `UPLOADS_DISK`. Local/dev and self-hosted
> deployments are fine on the `local` driver as-is.

## One-time setup

1. **Create the app** at [cloud.laravel.com](https://cloud.laravel.com):
   *New Application* → connect the `Maty3k/MusicPlayer` GitHub repo → pick
   `main` as the branch to deploy. Runtime: **PHP 8.4**.

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

## Custom domain (music4u.online)

The production app runs on **https://music4u.online** (registered at GoDaddy).

1. **App DNS** — Laravel Cloud: *production → Domains → Add domain*
   (`music4u.online`). Add the records it shows in GoDaddy → domain → DNS.
   The apex can't take a CNAME at GoDaddy, so Cloud provides A records for
   `@`; `www` gets a CNAME. TLS is issued automatically after propagation.
2. **Email DNS** — Resend: *Domains → Add domain* (`music4u.online`), add the
   TXT (SPF + DKIM) and MX records in GoDaddy, then Verify. Until this is
   done Resend is in test mode and only delivers to the account owner.
3. **Env vars** (then redeploy):
   - `APP_URL=https://music4u.online` (overrides Cloud's default)
   - `MAIL_FROM_ADDRESS=noreply@music4u.online`
   - `SPOTIFY_REDIRECT_URI=https://music4u.online/spotify?action=callback`
     (register the same URI on the Spotify app)

## Import your existing library

After the first deploy and registering your account, run in a Cloud command
session (Commands → `php artisan ...`):

```
php artisan music:import you@example.com database/legacy/music.json
```

This loads the snapshot of the pre-rewrite library into your account.

Other snapshots in `database/legacy/` (e.g. `my-playlist-1.json`, the Spotify
"My playlist #1" export) can be imported the same way. Add `--add` to append
the file's playlists to an account without touching its existing library
(plain import replaces everything and refuses if the account already has
songs; `--force` replaces).

## Email verification flow

Registration sends a signed verification link through Resend. Users can't
reach the player until verified (`verified` middleware). The resend button on
the verify page allows 3 mails a minute and 10 a day. The links in the
verification and password-reset mails are built from `APP_URL`, so it must be
the site's real address (`https://music4u.online`). Locally, `MAIL_MAILER=log`
writes the mail (with its link) to `storage/logs/laravel.log` so you can test
without Resend.

While the Resend domain is unverified (test mode delivers only to the account
owner), `php artisan user:verify user@example.com` (Cloud → Commands) marks an
account verified manually.

## Notes / limitations

- **Local dev**: `php artisan serve` + SQLite works out of the box
  (`database/database.sqlite`).
- **MusicPlayerMobile** is not yet compatible with the Laravel backend — it
  still targets the legacy endpoints with a shared-secret header. It needs a
  Sanctum token flow before it works against this version.
- Most music is added by link (a YouTube ID, an MP3 URL, a Spotify import) and
  stores nothing. Uploaded audio files are the exception: they need the bucket
  described at the top of this page.
- **Sessions end when a password changes.** Every session and "stay signed in"
  cookie carries a fingerprint of the account's password, keyed with `APP_KEY`.
  So changing `APP_KEY` (even with `APP_PREVIOUS_KEYS`) signs everybody out
  once, and so does changing `BCRYPT_ROUNDS` for each account as it next signs
  in. Members who never noted their PIN cannot come back after that: avoid
  both unless there is no other way.

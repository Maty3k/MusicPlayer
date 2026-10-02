# Phone browser suites

Playwright scripts that drive the player in Chrome at phone sizes (390×844,
landscape, desktop and app-shell checks too) and print `PASS`/`FAIL` per check
and an `N/M passed` line. They were written during the phone redesign and used
to live in a session scratchpad; only their plumbing (base URL, saved logins,
screenshot paths) changed when they moved here.

```
lib.js          base URL, saved logins (.state/), Chrome launch, login, fix-active
login.js        log the five test accounts in and save their sessions
fix-active.js   put demo/few/mid/many back on Favorites
run-all.js      run every suite (reset before each), print N/M per suite, gate
suites/         the suites (+ v11-a11y-lib.js for the axe scan)
```

The accounts come from `database/seeders/BrowserTestSeeder.php`:
`demo`, `few`, `mid`, `many` and `empty` `@example.com`, all verified, password
`demo-pass-123` (override with `BROWSER_TEST_PASSWORD` for both the seeder and
the suites). The seeder can be re-run at any time; accounts keep their ids, so
saved logins stay valid.

## In CI

`.github/workflows/browser.yml` runs on every push and pull request:

1. PHP 8.4, `composer install`, a fresh `.env` pointing at a SQLite file,
   `migrate`, `db:seed --class=BrowserTestSeeder`.
2. Starts `php -S 127.0.0.1:8123` with Laravel's `server.php` router from
   inside `public/` and waits for `/up`.
3. `npm ci` here, then `node run-all.js` with
   `RESET_CMD="php artisan db:seed --class=BrowserTestSeeder --force"`, so every
   suite starts from the seeded data. Chrome is the runner's preinstalled
   Google Chrome (`channel: 'chrome'`).
4. On failure it uploads `browser-artifacts/` (per-suite logs, screenshots,
   the axe report, `summary.json`, the PHP server log and `laravel.log`).

The job fails if any suite prints a `FAIL` line, exits non-zero, or never
prints its `N/M passed` line. `back-check`, `keys-check` and `v11-a11y-axe`
print reports instead; `run-all.js` checks them against their known-good
output (documented next to `verifyBack`, `verifyKeys` and `verifyAxe`).

## Locally (needs PHP; not possible on the ThreatLocker laptop)

```sh
php artisan migrate
php artisan db:seed --class=BrowserTestSeeder
php artisan serve --port=8123            # or: cd public && php -S 127.0.0.1:8123 ../vendor/laravel/framework/src/Illuminate/Foundation/resources/server.php

cd tests/browser
npm ci
node run-all.js                          # logs in first if .state/ has no sessions
node run-all.js step12-check back-check  # just these
node suites/step5-check.js               # one suite, no reset
```

Useful environment variables: `BASE_URL` (default `http://127.0.0.1:8123/`),
`RESET_CMD` (re-seed between suites), `FORCE_LOGIN=1` (redo the logins),
`HEADED=1`, `CHROME_CHANNEL` / `CHROME_PATH`, `ARTIFACTS_DIR` (default
`.state/artifacts`), `SUITE_TIMEOUT_MS`.

The suites abort YouTube, Spotify and the player SDKs, and fake most writes to
`/save-music`, so they reach no outside service except cover art (i.ytimg.com) and fonts, and change the accounts little;
the reset is there for the few writes that do go through.

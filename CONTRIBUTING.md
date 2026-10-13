# Contributing

Thanks for looking. This is a hobby project with one maintainer, so small,
focused changes are the easiest to take in.

## Run it locally

You need PHP 8.4 and Composer. There is no JavaScript build step.

```bash
composer install
cp .env.example .env && php artisan key:generate
touch database/database.sqlite
php artisan migrate
php artisan serve
```

Open `http://localhost:8000/login` and press **Start listening**: that makes an
account on the spot. For accounts that already hold playlists and plays:

```bash
php artisan db:seed --class=BrowserTestSeeder   # demo, few, mid, many, empty @example.com
```

Their password is written in the seeder, so it refuses to run in production.

## Tests

```bash
php artisan test                 # PHP feature tests
```

The browser suites live in `tests/browser` (Playwright against a local server;
see its README). Both run on GitHub for every pull request: `tests` is quick,
`browser` takes 30 to 45 minutes. The browser suites block YouTube, Spotify and
every other outside service, so anything that talks to another server needs PHP
tests with `Http::fake` (see `tests/Feature/SpotifyLibraryImportTest.php`).

## Sending a change

1. Fork the repo and make a branch from `main`.
2. Keep it to one thing. Add or adjust tests for what you changed.
3. Open a pull request against `main` and say what changes for the user.
4. No keys, tokens or personal data in commits, fixtures or screenshots.

## Where things are

| Part | Where |
|---|---|
| The page | `resources/views/music/player.blade.php` |
| All client code | `public/js/script.js` (one file; desktop code is prefixed `dv`, phone code `m`) |
| Styles | `public/css/styles.css` |
| Playlists and songs API | `app/Http/Controllers/MusicController.php` (`POST /save-music`, one `action` per call) |
| Other endpoints | `routes/web.php`, the rest of `app/Http/Controllers` |
| Uploaded files | `UploadSongController`, `MediaController` |
| Public page of a shared playlist | `resources/views/shared.blade.php`, `SharedPlaylistController` |

Three layouts share that code: the phone (up to 600px wide), the desktop
(`html.dv2`), and an older layout kept for phones held sideways.

## Adding a music source

A source is anywhere songs can play from. Today there are three: YouTube, an
audio address, and Spotify. This section is for adding a fourth, such as your
own Navidrome, Jellyfin or other music server.

### How a song is stored and played

A song is a row with `title`, `artist`, `album`, `cover` and up to three places
to play from: `youtube_id`, `spotify_id`, `mp3_url` (`Song::toFrontend()`).
`mp3_url` and `cover` take an `https://` address or a path on this site
(`MusicController::sanitizeUrl()`).

In `script.js`, `getPlaybackSource()` picks the source and
`activatePlayerForSong()` picks the player. A song with an `mp3_url` and no
`youtube_id` plays through one shared `<audio>` element wrapped by
`createMp3Player()`. Play, pause, seeking, the lock-screen buttons, the sleep
timer and the queue all work for it already. **A new source that ends in an
audio address needs no new player.**

Two things depend on the exact text of `mp3_url`: the song's identity
(`songPlayKey()` in `script.js` and `Song::keyFor()` must agree; it is
`mp3:` plus the address) and "is this in my Favorites". So the address has to
stay the same for the same song.

### The pattern to copy

Uploaded files already work like this:

- the song's `mp3_url` is a path on this site, `/media/{file}`;
- `MediaController` checks who is signed in, then answers with the file, or
  with a redirect to a short-lived signed address in the bucket.

A server source can do the same:

- the song's `mp3_url` is `/remote/{server}/{track}` and its `cover` is
  `/remote/{server}/cover/{id}`;
- a small controller finds the signed-in user's saved connection to that
  server, builds the real stream address with the login token, and redirects.

The audio then flows straight from the music server to the listener. The login
is never written into a song, sent to the page, or carried along when a
playlist is shared, and the path stays stable when the login changes.

Calling the server from the page instead is possible where the server allows
requests from other sites (Navidrome and Jellyfin do by default). It is less
safe: the token then lives in the page, and in the copy of the page that the
service worker keeps for offline use.

### Pieces

1. **A table for connections**, one row per user and server: kind, name, base
   address, user name, and the token in an `encrypted` cast, the way
   `App\Models\SpotifyToken` stores Spotify's.
2. **One adapter per kind of server** behind a small interface: recognise the
   server, sign in, search, list an album or playlist, build a stream address,
   build a cover address.
3. **Endpoints under `/settings/servers`** to connect, list and remove a
   server, and to search it. Paths under `/settings/` already get JSON error
   answers (`bootstrap/app.php`), and the `fetch` wrapper at the top of
   `script.js` already adds the CSRF token for them.
4. **The two redirect routes** above, inside the `auth` group in
   `routes/web.php`.
5. **The interface**: a "Music servers" block in Settings → Account, and a
   third group of results on the Search page next to "In your library" and
   "From YouTube" (`libraryHtml()`, `youtubeHtml()` and `runPageSearch()` in
   `script.js`). `playRadioSong(song)` previews any song object, and
   `addFoundSong()` saves one through the `add` action, which already accepts
   an `mp3_url`. `addBatch` takes up to 200 songs for a whole album or
   playlist.

### Rules

These are the parts a review will look at first.

- **HTTPS only.** This site is served over HTTPS, so browsers refuse audio and
  requests to `http://`. Refuse such an address when it is typed, with a
  sentence that says why. Also refuse addresses with `user:password@`.
- **The backend must not become a way to reach private machines.** If it calls
  the server (to recognise it, sign in or search), it is fetching an address a
  user typed. Allow only `https`, resolve the host and refuse private,
  loopback and link-local addresses, connect to the address you checked, do
  not follow redirects, use short timeouts and a size limit, and throttle per
  user. Answer with your own messages, never the other server's body.
- **Keep a token, not the password.** For the Subsonic family that is the salt
  and `md5(password + salt)`; for Jellyfin the access token of a normal user,
  never an administrator's API key.
- **Never store or log a finished stream or cover address.** It contains the
  login. Build it at the moment of the redirect.
- **Stop on a sign-in error.** Navidrome blocks further tries after a few
  failures, and every cover or stream request with a stale login counts as
  one. Mark the connection as needing a new sign-in and stop calling.
- **Shared playlists.** `SharedPlaylistCopier` drops `mp3_url` when someone
  copies a shared playlist, and the copy then finds a YouTube video by title
  the first time it plays. Keep that, or decide deliberately what a person
  without access to the server should get.

### Notes on the servers

Checked against documentation and source in October 2026. Check them against
your own server before relying on them.

**Subsonic family** (Navidrome, gonic, LMS, Ampache, Nextcloud Music):

- Recognise: `GET {base}/rest/ping.view?f=json&v=1.16.1&c=music4u` answers
  JSON with a top-level `subsonic-response`, even without a login.
- Sign in: every call carries `u`, `t` (lower-case hex MD5 of password + salt)
  and `s` (the salt), plus `v`, `c` and `f=json`.
- Errors come back as HTTP 200 with `"status":"failed"` in the body. Check the
  body, not the status code. Empty results are missing keys, not empty arrays.
- Search: `search3.view?query=...`. Albums: `getAlbum.view?id=...`. Playlists:
  `getPlaylists.view`, `getPlaylist.view?id=...`.
- Stream: `stream.view?id=...&format=raw` is the original file with byte
  ranges, so seeking and iPhones work. `format=mp3&maxBitRate=320` is a
  transcode; on a first play it cannot be seeked. `maxBitRate` without
  `format` makes Navidrome send Opus.
- Covers: `getCoverArt.view?id=...&size=300` with the song's `coverArt` value,
  not its id.
- Song ids can change (Navidrome 0.64.0 changed most of them). Keep title,
  artist, album and duration next to the id so a song can be found again.

**Jellyfin** (12.x):

- Recognise: `GET {base}/System/Info/Public` answers JSON with
  `ProductName: "Jellyfin Server"`.
- Sign in: `POST {base}/Users/AuthenticateByName` with the `Authorization:
  MediaBrowser Client=..., Device=..., DeviceId=..., Version=...` header. Use
  one stable `DeviceId` per browser and user.
- An `<audio>` element cannot send headers, so the token goes in the address
  as `ApiKey=`. The older `api_key=` is switched off by default since 12.0.
- Search: `GET /Items?userId=...&searchTerm=...&includeItemTypes=Audio&recursive=true`.
- Original files answer byte ranges; transcodes cannot be seeked.

**What browsers allow:**

- MP3, AAC (M4A) and FLAC play everywhere. ALAC plays only in Safari, WMA
  nowhere, and Ogg needs iOS 18.4 on iPhones. Ask the server for the original
  file when the browser can play it (`audio.canPlayType()`), otherwise for MP3.
- Do not set `crossorigin` on the audio element: a server that sends no CORS
  headers on its streams would then not play at all.
- A home-network or VPN address works only for people on that network, makes
  Chrome ask for permission, does not work on iPhones, and cannot be reached
  by this site's backend. A public HTTPS address works everywhere.

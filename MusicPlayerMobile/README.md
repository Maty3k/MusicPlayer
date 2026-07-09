# MusicPlayerMobile

An Expo / React Native companion for the PHP Music Player. It shows your
playlists natively and opens the PHP turntable inside a WebView, with a native
YouTube player bridged in for reliable background/native playback.

## Architecture

- `App.tsx` — playlist list → player screen with native transport controls.
- `src/api/client.ts` — talks to the PHP backend (`save-music.php`), attaching
  the shared API token as a Bearer header.
- `src/components/player/WebViewPlayer.tsx` — loads `index.php?app=1` in a
  WebView, injects the API token, and bridges YouTube playback + player state.
- `src/store/usePlayerStore.ts` / `useMusicStore.ts` — Zustand state for the
  current track / playback and the loaded library + loop/shuffle modes.

## Setup

```bash
npm install
cp .env.example .env      # set EXPO_PUBLIC_API_BASE_URL and EXPO_PUBLIC_API_TOKEN
npm run start
```

Set `api_token` in the server's `config.php` to the same value as
`EXPO_PUBLIC_API_TOKEN` so the phone (which reaches the server over the LAN, not
loopback) is allowed to write. See `auth-guard.php` in the repo root.

## Status — UNVERIFIED SCAFFOLDING

This shell was reconstructed to be structurally complete (the two Zustand stores
match exactly what `WebViewPlayer.tsx` consumes), but it has **not** been built
or run against a real Expo/React Native toolchain in this environment. Before
relying on it:

- run `npm install` and reconcile dependency versions (the pinned Expo SDK 51 /
  RN 0.74 set is a reasonable default but may need `npx expo install` to align);
- run `npm run tsc` to typecheck;
- test on a device/simulator with the backend reachable.

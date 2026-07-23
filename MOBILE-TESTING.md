# Real-device checklist — Mobile v2

The phone shell was verified with Playwright at 390×844 / 844×390, but a few
behaviors can only be proven on hardware. Run this on an actual iPhone
(Safari) and Android phone (Chrome) against prod. Order matters — later items
build on earlier state.

## Lock screen & background (the big one)

- [ ] Play a song, lock the phone: does audio continue? *(YouTube-sourced
  tracks are expected to STOP — browser suspends the iframe. Local/uploaded
  MP3s should keep playing.)*
- [ ] While an MP3 plays with the screen locked: lock screen shows title,
  artist, and cover art; play/pause and next/prev buttons work; the scrubber
  shows a moving position and can seek.
- [ ] Change tracks from the lock screen twice — metadata must follow each
  change (this was the bug fixed in phase 2).
- [ ] If lock-screen controls behave well for MP3s: consider flipping
  `PREFER_LOCAL_ON_PHONE` to `true` in `public/js/script.js` so dual-source
  songs (YouTube + linked local file) play from the local file on phones and
  survive screen lock. Flip it, then re-run this section.

## Gestures (emulated pointer events ≠ real fingers)

- [ ] Dock: swipe left/right changes track; a sloppy diagonal swipe while
  scrolling the crate does NOT open Now Playing.
- [ ] Now Playing: drag down from the header dismisses; a slow half-drag
  springs back.
- [ ] Seek bar: scrub with a thumb — the knob grows, time preview follows,
  release seeks. No accidental page scroll while scrubbing.
- [ ] Android hardware back / iOS left-edge swipe: closes song sheet → Now
  Playing → playlist → crate, in that order, never exits the site mid-stack.
- [ ] iOS RIGHT-edge swipe (forward): should snap back, not corrupt the UI.

## Keyboard & safe areas

- [ ] Tap the find-in-playlist filter: keyboard opens, dock hides, filter
  works; dismiss keyboard → dock returns.
- [ ] On a notched phone: dock sits above the home indicator; Now Playing
  header clears the notch; bottom sheets pad above the indicator.
- [ ] Login page: focus the PIN field — the submit button can be scrolled to
  while the keyboard is up.

## PWA

- [ ] "Add to Home Screen" from the player page; the installed app opens in
  standalone (no browser chrome), portrait-locked, dark theme-color.
- [ ] Open the installed app while logged out: branded dark chrome (not a
  white flash) — the auth pages carry the PWA metas now.
- [ ] Offline: save a playlist for offline (download icon), enable airplane
  mode, relaunch — offline songs play, online-only songs grey out.

## Rotation

- [ ] Rotate mid-song in the browser (not the PWA — it's portrait-locked):
  landscape shows track list + compact now-playing + dock; rotating back
  restores the portrait shell; nothing gets stuck.

## Known-acceptable

- YouTube tracks stopping on screen lock (browser limitation; the RN shell
  or PREFER_LOCAL_ON_PHONE are the levers).
- Playlist create/delete still reloads the page (resets the back-button
  layer stack once).
- Vinyl GIF maker is desktop-oriented on phones.

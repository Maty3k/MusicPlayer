# Real-device checklist — Mobile v2

The phone shell was verified with Playwright at 390×844 / 844×390, but a few
behaviors can only be proven on hardware. Run this on an actual iPhone
(Safari) and Android phone (Chrome) against prod. Order matters — later items
build on earlier state.

## Lock screen & background (the big one)

- [ ] Play a song, lock the phone: does audio continue? *(Android Chrome /
  Brave: YouTube songs keep playing (confirmed on a Xiaomi in Brave's
  home-screen app). iPhone: YouTube songs are expected to STOP — WebKit
  suspends the video. Local/uploaded MP3s keep playing on both.)*

## Headset & notification controls (AirPods, Bluetooth buttons)

On Chromium (Android Chrome, Brave, Edge, Samsung Internet) a silent
`mediaSessionKeeper` track pulls these controls from YouTube's embed to our
page; on iPhone YouTube songs only get play/pause (see script.js).
Turn on `?debug=1` to watch `media key:` and `media keeper:` lines.

- [ ] Android, YouTube song playing: the notification card shows our title
  and cover with previous / play-pause / next.
- [ ] AirPods: one press pauses and resumes, two presses skip to the next
  song, three go back — with the screen on, and again with the screen off
  for 5+ minutes.
- [ ] Pause from the headset, wait a minute, resume: the same song continues.
- [ ] Skip twice quickly from the headset during a song change: no double
  skip, no restart of the loading song.
- [ ] Uploaded song (MP3): the same controls work (it never needed the keeper).
- [ ] iPhone: play/pause from the headset works for YouTube songs; skip is
  not expected to (YouTube's embed owns the controls there).
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
  Same for Search, Stats, the Up next queue, the GIF maker, a search hit and
  a Jump back in song (back returns to the crate), in portrait and landscape.
- [ ] iOS RIGHT-edge swipe (forward): should snap back, not corrupt the UI.

## Tabs (Home / Search / Library)

- [ ] Installed app, fresh launch: opens on Home. Back on Home closes the
  app; back on Search or Library goes to Home first.
- [ ] Library → open a playlist → back → Library → back → Home.
- [ ] Search: type, tap a hit (its playlist opens and plays), back →
  the same results are still there.
- [ ] Tap the mini player on each tab: Now Playing opens over that tab and
  closing it (back, chevron, drag down) shows the same tab again. The tab
  bar hides while Now Playing is up.
- [ ] Tapping the mini player never also plays the song row under it.
- [ ] While a playlist is open, tapping another tab closes it; tapping its
  own tab again goes back to the tab's top.
- [ ] Reload (pull to refresh) on a playlist opened from Library: the same
  playlist and tab come back, and each back press does something.
- [ ] Jump back in plays the song without leaving Home.
- [ ] Avatar → Your listening / Settings open, and back closes them.
- [ ] Typing in Search: the tab bar and mini player hide for the keyboard
  and come back after.
- [ ] Gesture bar / home indicator: the tab bar's labels sit above it.
- [ ] New member signup: back while the number + PIN card is up does
  nothing (and doesn't freeze); after Continue, tabs work.

## Playlist screen

- [ ] Open a playlist: the name slides into the top bar as you scroll; the
  bar stays put and the list ends above the mini player.
- [ ] Round Play starts the playlist and opens Now Playing; the shuffle
  icon cycles off → on (dot) → Smart mix (spark).
- [ ] Find (magnifier): the keyboard opens, typing filters, back closes it
  and shows every song again.
- [ ] ⋯ → Share: the phone's share sheet opens with the playlist's link.
- [ ] ⋯ → Reorder songs: drag a song by its handle past the bottom of the
  screen (the list scrolls along), let go; Done or back ends it and the
  order sticks after a reload.
- [ ] ⋯ → Save for offline (only on playlists with uploaded songs), then
  airplane mode: those songs still play.
- [ ] ⋯ → Delete playlist needs two taps; the app reloads on your library
  with a "Deleted" note.
- [ ] A song's ⋯ → Add to Favorites / Remove from Favorites (the hearts are
  gone from the rows).
- [ ] A song's ⋯ → Add to playlist… → pick one: "Copied to …"; with "Move
  instead of copy" on it leaves this playlist. Back from the playlist list
  returns to the song menu; a quick double tap never picks a playlist.
- [ ] Now Playing → ⋯ → Show in playlist: Now Playing closes and the
  playlist scrolls to the song, which lights up briefly.
- [ ] An empty playlist shows Add songs and Import; Import pre-selects
  "Add to <this playlist>".

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
- [ ] Landscape (wider than 600px — most phones) has no tab bar: the full
  crate (Search, Stats, Settings buttons) shows. Very small phones
  (568x320) keep the phone layout, tabs included. Rotating from the Search or Library tab lands on Home
  when you come back; an open playlist survives the rotation.

## Known-acceptable

- iPhone: YouTube tracks stopping on screen lock and headset skip not
  working for them (WebKit limitation; the RN shell or PREFER_LOCAL_ON_PHONE
  are the levers).
- Playlist create/delete still reloads the page; the tab and an open
  playlist come back, Now Playing and sheets don't.
- Switching tabs closes a playlist that was open on the old tab (reopening
  a playlist can switch the active one and stop the music, so tabs don't
  keep their own stack like Spotify's).
- Vinyl GIF maker is desktop-oriented on phones.

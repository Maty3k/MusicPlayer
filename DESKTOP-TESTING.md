# Desktop checklist: desktop redesign

`tests/browser/suites/desktop-bar-check.js` covers the player bar in Chrome at
1440×900 and 1024×768, and `desktop-sidebar-check.js` covers the sidebar at
1440×900, 1024×768 and 800×600. Both check that phones (390×844, 844×390)
and the app (`?app=1`) don't get them. The items below need a person at a
real desktop browser. Run them in Chrome and in Firefox or Safari.

## Scope (step 1)

- [ ] Window wider than 600px: `<html>` has the `dv2` class (DevTools).
- [ ] Drag the window narrower than 600px: `dv2` goes, the phone layout
  (tab bar, dock) shows and looks the same as before. Widen it again and
  `dv2` comes back. No flash of the wrong layout on reload at either width.
- [ ] A phone, and the app (`?app=1`), look exactly as they did before this
  work.

## Player bar (step 2)

- [ ] With a song loaded, the bar sits at the bottom of the crate and of the
  player view. Switching between the two views keeps it in place.
- [ ] A new account (empty Favorites) shows no bar. After adding and playing
  a song, the bar appears.
- [ ] Scroll the crate and the song list to the end: the last card and the
  last row sit fully above the bar.
- [ ] Left side: the cover follows each track change, and the small record
  spins only while music plays. Long titles end in "…".
- [ ] ♥ likes and unlikes the playing song. In Favorites it is on and only
  shows a hint. The heart on the song row agrees.
- [ ] Play/pause, previous and next work. The play icon follows the deck's
  own controls and media keys.
- [ ] Shuffle (off → on → smart) and repeat (all → one → off) match the
  rail's coasters both ways. Repeat-one shows a small "1".
- [ ] The seek bar moves with the song. Clicking jumps there. Dragging shows
  the time under the pointer and seeks on release. With the bar focused,
  ←/→ step 5s, PageUp/PageDown 30s, Home goes to the start and End to just
  before the end.
- [ ] The volume slider moves the deck's knob and the knob moves the slider.
  Mute goes to 0 and comes back to the last level. Arrow keys work on the
  focused slider.
- [ ] Lyrics: from the crate it opens the turntable with lyrics on. Pressed
  again, it turns lyrics off.
- [ ] Queue opens the Up next window. The number badge counts queued songs.
- [ ] Sleep: the menu opens above the button with focus on "15 minutes".
  ↑/↓ move, Esc closes and returns focus to the button, and clicking
  outside closes it. A timer shows its minutes on the button, and "Turn off"
  clears it.
- [ ] Turntable opens the player view. Pressed again, it goes back to the
  crate.
- [ ] Tab through the bar: every control shows an amber focus ring, and a
  screen reader announces names and on/off states (e.g. "Shuffle,
  toggle button, pressed").
- [ ] Toasts (e.g. "Added to Favorites") appear above the bar, not over it.
- [ ] 601–900px window: the volume slider hides (mute stays) and nothing
  overlaps.
- [ ] Each room theme (Settings → Appearance): the bar's colours follow the
  theme.

## Sidebar (step 3)

Opening a playlist on desktop now only shows it, like on the phone. Playback
changes only when you press Play or click a song.

- [ ] The sidebar runs down the left from the top of the window to the
  player bar. The page fills the rest. The sidebar's playlist list and the
  page scroll separately.
- [ ] Home and Search sit at the top. Home is highlighted on the
  collection. Search opens the search window and is highlighted while it's
  open. Home takes you back to the collection from a playlist.
- [ ] Your Library lists every playlist with its cover, name and song
  count. The one playing has an amber name and small bars, which move only
  while music plays. An empty playlist is never marked as playing.
- [ ] Click a playlist that isn't playing. Its songs show, and it's
  highlighted in the sidebar. The song in the bar, the turntable and the
  play state stay as they were.
- [ ] Click a song in that playlist. It starts, and the sidebar now marks
  that playlist as playing. Do the same with the Play button under the
  playlist's name; with shuffle on, it starts a random song.
- [ ] After Home, the turntable button in the bar opens the playing list,
  not the one you looked at before.
- [ ] The "← Crate" button and the old console on the left of the
  collection are gone. Crackle and Make GIF are at the bottom of the
  sidebar, and pitch is still on the turntable.
- [ ] Crackle in the sidebar and in Settings → Playback show the same
  state.
- [ ] All, Local and Spotify filter the sidebar and the collection
  together.
- [ ] The + menu offers New playlist and Bring your music over. Each opens
  its window. Esc closes the menu and returns focus to +.
- [ ] Rename, recolour or change the cover of a playlist (pencil on its
  card). The sidebar row follows. Adding or removing songs updates its
  count. A deleted playlist disappears from it.
- [ ] Keyboard: Tab reaches Home, Search, +, the chips, then one playlist
  row. ↑/↓/Home/End move between rows, and Enter opens one. A screen reader
  announces the open playlist as current and the playing one as "Playing".
- [ ] 601–900px window: the sidebar becomes a narrow rail of icons and
  covers. Hovering a cover shows its name, and the + menu opens to the
  right, inside the window.
- [ ] 901–1920px windows: nothing overlaps, and long playlist names end in
  "…".
- [ ] Narrow the window below 600px while a playlist is shown: the phone
  layout returns showing the playing list. Widen it again and the sidebar
  comes back.

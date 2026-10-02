# Desktop checklist: desktop redesign

`tests/browser/suites/desktop-bar-check.js` covers the player bar in Chrome at
1440×900 and 1024×768, `desktop-sidebar-check.js` covers the sidebar at
1440×900, 1024×768 and 800×600, and `desktop-home-check.js` covers Home at
the same three sizes (plus an axe scan). All three check that phones
(390×844, 844×390) and the app (`?app=1`) don't get them. The items below need a person at a
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

## Home (step 4)

Home is now a rounded panel beside the sidebar: a greeting, Stats and
Settings at the top right, "Jump back in" and "Your playlists". Clicking a
Jump back in song now plays it right there; Home stays on screen and the
bar shows the song. (It used to open the turntable.)

- [ ] The room is gone: no wall art, poster, shelf, clock, rug, lights,
  plant or cat, and no VINYLS crate. Nothing scrolls by on its own.
- [ ] The heading says "Good morning", "Good afternoon" or "Good evening"
  for the time of day. It changes when you come back to the tab later.
- [ ] Stats and Settings sit at the top right and open their windows. The
  old Search and "+ New playlist" buttons are gone (Search and + are in the
  sidebar).
- [ ] Jump back in is one row of song cards. Hovering a card shows a round
  play button. Clicking it plays the song, Home stays, and the bar shows it.
  Make the window narrower and wider: the row always fits on one line.
- [ ] Your playlists is a grid of square covers with the name and the song
  count under each, in the order you made them. A playlist without a cover
  shows a music note on its colour. Long names end in "…".
- [ ] The playing playlist has an amber name and small bars, which move
  only while music plays. An empty playlist is never marked.
- [ ] Clicking a cover opens the playlist. The song in the bar keeps
  playing.
- [ ] Hovering a card shows ⋯ on its cover. It opens the playlist's edit
  window. On a touch screen ⋯ is always there.
- [ ] Keyboard: Tab goes Stats, Settings, the Jump back in cards (each shows
  its play button and an amber ring), then each cover and its ⋯, then the
  two tiles (601–900px: the All / Local / Spotify chips come before the
  covers). Enter opens or plays.
- [ ] The New playlist and Bring your music over tiles come last in the
  grid, with dashed covers the size of the others. Each opens its window.
- [ ] A new account (demo: one empty Favorites): the "Start your
  collection" card shows with Bring your music over and Add a song. After
  you add a song, it goes away.
- [ ] An account with no playlists: the "Where's your music now?" chooser
  opens on load. Close it: the start card and the two tiles show.
- [ ] Sidebar All / Local / Spotify filter the grid too. Filtered to a
  source with no playlists, the grid says "No local playlists yet." (or
  Spotify).
- [ ] 601–900px window (icon rail): smaller cards, and All / Local /
  Spotify show next to "Your playlists" instead.
- [ ] 901–1920px windows: more columns as the window widens, nothing runs
  off the right edge, and there's no sideways scroll.
- [ ] Each room theme (Settings → Appearance): the panel and the text
  follow the theme.
- [ ] With "reduce motion" on in the OS, cards don't animate and the bars
  stand still.
- [ ] A phone, and the app (`?app=1`), show their own Home exactly as
  before.

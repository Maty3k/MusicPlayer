# Desktop checklist: desktop redesign

`tests/browser/suites/desktop-bar-check.js` covers the player bar in Chrome at
1440×900 and 1024×768, `desktop-sidebar-check.js` covers the sidebar at
1440×900, 1024×768 and 800×600, `desktop-home-check.js` covers Home and
`desktop-playlist-check.js` the playlist page,
`desktop-nowplaying-check.js` Now Playing, `desktop-search-check.js` the
Search page, `desktop-panel-check.js` the side panel and
`desktop-avatar-check.js` the avatar menu at the same three sizes (all six
with axe scans). All eight check that phones (390×844, 844×390) and the app
(`?app=1`) don't get them. The items below need a person at a
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
- [ ] Lyrics: from Home, a playlist or Search it opens the side panel's
  Lyrics tab (step 8) with lyrics on; pressed again, it closes the panel.
  On Now Playing it turns the page's lyrics off and on.
- [ ] Queue opens the side panel's Up next tab (step 8); pressed again, it
  closes it. The number badge counts queued songs.
- [ ] Sleep: the menu opens above the button with focus on "15 minutes".
  ↑/↓ move, Esc closes and returns focus to the button, and clicking
  outside closes it. A timer shows its minutes on the button, and "Turn off"
  clears it.
- [ ] Turntable opens Now Playing (step 6; it replaces the playlist page).
  Pressed again, it goes back to where you were: Home, or the playlist page
  you opened it from.
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
  collection. Search opens the Search page (step 7) and is highlighted
  while it shows. Home takes you back to the collection from a playlist.
- [ ] Your Library lists every playlist with its cover, name and song
  count. The one playing has an amber name and small bars, which move only
  while music plays. An empty playlist is never marked as playing.
- [ ] Click a playlist that isn't playing. Its songs show, and it's
  highlighted in the sidebar. The song in the bar, the turntable and the
  play state stay as they were.
- [ ] Click a song in that playlist. It starts, and the sidebar now marks
  that playlist as playing. Do the same with the Play button under the
  playlist's name; with shuffle on, it starts a random song.
- [ ] After Home, the turntable button in the bar opens the turntable with
  the playing song, and no playlist is highlighted in the sidebar.
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

Home is now a rounded panel beside the sidebar: a greeting (with the avatar
menu at its right since step 9), "Jump back in" and "Your playlists". Clicking a
Jump back in song now plays it right there; Home stays on screen and the
bar shows the song. (It used to open the turntable.)

- [ ] The room is gone: no wall art, poster, shelf, clock, rug, lights,
  plant or cat, and no VINYLS crate. Nothing scrolls by on its own.
- [ ] The heading says "Good morning", "Good afternoon" or "Good evening"
  for the time of day. It changes when you come back to the tab later.
- [ ] No Stats or Settings buttons (step 9: they're in the avatar menu at
  the top right). The old Search and "+ New playlist" buttons are gone
  (Search and + are in the sidebar).
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
- [ ] Keyboard: Tab goes the avatar, the Jump back in cards (each shows
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

## Playlist page (step 5)

Opening a playlist now shows a full-width page beside the sidebar instead
of the narrow song list and the turntable. The turntable shows only from
the bar's turntable (or lyrics) button.

- [ ] The header: a big cover (a music note on the playlist's colour when
  it has no covers), "Playlist", the name in large type (long names wrap to
  two lines and end in "…"), and the song count. The top of the page takes
  on the playlist's colour.
- [ ] The round Play: on a playlist that isn't playing it starts it at its
  saved song (a random one with shuffle on), and the sidebar marks it as
  playing. On the playing list it plays and pauses, and shows a pause icon
  only while that list plays (screen reader: "Play" / "Pause").
- [ ] Shuffle next to Play turns on (amber, a dot), smart (the dot glows),
  then off. The bar's shuffle follows, and the other way round.
- [ ] ⋯ opens a menu under it: Add songs, Import into this playlist,
  Reorder songs (2+ songs), Edit details, Share, Up next (with the queued
  count), Save for offline (only with uploaded songs) and Delete playlist.
  Each opens its window for this playlist or does its job. ↑/↓/Home/End
  move, Esc closes it and returns focus to ⋯, clicking outside closes it.
- [ ] Delete playlist: the first click changes it to "Click again to
  delete"; the second deletes. A playlist that isn't playing goes at once
  (Home, gone from the sidebar, the music plays on); the playing one
  reloads the page.
- [ ] Find in these songs (right of the buttons) hides the songs that don't
  match, says "No songs here match …" when none do, and is empty again when
  you open another playlist.
- [ ] The songs are a table: #, cover, title and artist; Album and a length
  column only appear when some songs have them. A long title ends in "…".
- [ ] Hovering a row: its number turns into a play triangle, and ♥, ⋯ and ×
  appear (a liked ♥ stays). Clicking a row plays it (a playlist that isn't
  playing becomes the playing one). The playing song is amber with moving
  bars in place of its number, only on the playing list and only while
  music plays.
- [ ] A row's ⋯ opens Play next / Add to queue / Send to … beside it, never
  under the sidebar or the bar. ↑/↓ move, Enter picks, Esc closes back onto
  the ⋯.
- [ ] Reorder: drag a row by its handle (shown on hover). The new order
  stays after a reload, for the playlist on screen, even when another one
  is playing. ⋯ → Reorder songs shows every handle, clicks don't play,
  Done (or Esc) ends it.
- [ ] Keyboard: Tab reaches one song row (amber ring), then its buttons.
  ↑/↓/Home/End move between rows, Enter or Space plays, Alt+↑/↓ moves the
  song (saved), the context-menu key (or Shift+F10) opens its ⋯.
- [ ] An empty playlist: "This playlist is empty" with Add songs and Import;
  Play is dimmed; no find field and no column labels.
- [ ] Open a playlist on a slow connection (DevTools throttling): the name
  and count show at once with "Loading songs…". Offline: "Couldn't load
  this playlist" with Retry, which loads it once you're back online.
- [ ] Discover still shows under the songs and its suggestions play.
- [ ] With the turntable showing, the bar's seek, the lyrics and the song
  changes keep working; back on the playlist page the bar's time keeps
  moving.
- [ ] 601–900px window (icon rail): a smaller cover and title, no × column,
  nothing overflows.
- [ ] Each room theme (Settings → Appearance): the page and its text follow
  the theme.
- [ ] A phone, and the app (`?app=1`), show their own playlist screen
  exactly as before.

## Now Playing (step 6)

The turntable is now a Now Playing page. The bar's cover or title, or its
turntable button, opens it. (Step 8: the lyrics button no longer opens it;
elsewhere it opens the side panel's Lyrics tab.)

- [ ] The page: a back button (‹) and "Now Playing" at the top, the big
  turntable in the middle over a blurred, darkened copy of the cover, and
  under it the song's title, "artist · album" and "Playing from
  (playlist)". A song without a cover shows the plain panel colour behind.
- [ ] The turntable is bigger than before and grows and shrinks with the
  window (try 1024px up to a full 1920px screen). Nothing runs off the
  page, and there's no sideways scroll.
- [ ] Windows about 1200px and wider: the lyrics sit right of the
  turntable, as tall as the turntable plus the song. Narrower: the lyrics
  go below the song with their top edge peeking out; scroll the page to
  read them. Synced lyrics light up line by line, clicking a line jumps
  there, and −, + and the offset still nudge the timing.
- [ ] The bar's lyrics button while Now Playing shows lyrics: the lyrics go
  and the turntable takes the room. Pressed again they come back. The
  small note button under the lyrics turns them off too, and focus moves
  to the bar's lyrics button.
- [ ] The turntable's own play/previous/next buttons, its song panel and its
  volume knob are gone (the bar has them). The bar's volume still works.
- [ ] On the turntable's right: the pitch slider, Crackle and ⋯. Drag pitch
  (double-click resets it), or Tab to it and use ↑/↓ (1%), Page Up/Down
  (5%), Home/End and 0. The record and the song's speed follow.
- [ ] Crackle on the turntable, Crackle at the bottom of the sidebar and
  Settings → Playback always show the same state, whichever you change.
- [ ] ⋯ opens Make a GIF and Show in playlist under it (above it near the
  bottom), never under the bar. ↑/↓ move, Esc closes back onto ⋯, clicking
  outside closes it.
- [ ] Make a GIF opens the GIF window. Show in playlist opens the playing
  playlist's page with the song's row lit and focused. With a smart-shuffle
  radio track it says "Radio track — not in this playlist" instead.
- [ ] "Playing from" names the playlist that's playing. Open another
  playlist, play a song from it, then open Now Playing: it names that one.
- [ ] Closing: the turntable button, Esc, or ‹ takes you back to Home or the
  playlist page you came from, and focus goes back to what opened it (the
  cover/title, the turntable or the lyrics button). Esc with the sleep menu
  or ⋯ open closes only the menu; Esc in a window (e.g. Make a GIF) leaves
  Now Playing open.
- [ ] While it's open no playlist is highlighted in the sidebar, and Home
  isn't either. Clicking a playlist in the sidebar shows its page.
- [ ] The bar's time and seek bar keep moving while Now Playing is open and
  after you leave it. Song changes update the title, the backdrop and the
  lyrics.
- [ ] Screen reader: opening it announces the "Now Playing" heading; the
  page is a "Now Playing" region; the cover/title button reads "Open Now
  Playing:" and the song; pitch reads as a slider with its percentage; the
  lyrics are a "Lyrics" region you can Tab to and scroll with the arrows.
- [ ] 601–900px window (icon rail): a smaller turntable that still fits,
  Crackle as an icon, the lyrics below.
- [ ] With "reduce motion" on in the OS, the record on the turntable doesn't
  spin (nor the bar's).
- [ ] Each room theme (Settings → Appearance), and the "Leaning" sleeve
  setting: the page and the lyrics panel look right.
- [ ] A phone, and the app (`?app=1`), show their own Now Playing exactly as
  before.

## Search (step 7)

Search is now a page in the main area (the phone's Search page), not the
old search window. The sidebar's Search, `/` or Ctrl+K (⌘K on a Mac) opens
it.

- [ ] Search, `/` (when you're not typing in a field) and Ctrl+K / ⌘K open
  the page with the cursor in the big field at the top, and Search is
  highlighted in the sidebar. Ctrl+K doesn't open the browser's own search.
  `/` typed in a field (e.g. Find in these songs) is just a slash.
- [ ] With an empty field: Recent searches as chips (× removes one, Clear
  removes all) and Your playlists as tiles. A tile opens that playlist's
  page.
- [ ] Type two letters: "In your library" with the number found, as rows
  (cover, title and artist, the playlist's coloured chip on the right). From
  three letters, "From YouTube" follows as a grid of cards, each with a + on
  its picture. Long titles end in "…" (YouTube cards wrap to two lines).
- [ ] Click a library row: it plays and Search stays. The bar shows it.
- [ ] Click a row's chip: that playlist's page opens and plays the song
  (the sidebar marks it as playing).
- [ ] Click a YouTube card: it plays as a preview and Search stays. Its +
  opens "Add to playlist" in a window. Pick a playlist: "Added to …" shows,
  and the song is in that playlist. Esc or × closes the window with focus
  back on the +.
- [ ] Paste a YouTube playlist link: "Import this YouTube playlist" opens
  the import window filled in and fetching. A Spotify playlist link offers
  the Spotify import; a video link offers Add this song.
- [ ] Enter remembers the search; it shows as a chip next time the field is
  empty. The field keeps the cursor.
- [ ] Keyboard: ↓ from the field goes to the first result; ↑/↓ move between
  rows (staying on the chip or + when you're on one), ←/→ along every
  button, Home/End to the first and last, Esc back to the field, ↑ from the
  first row back to the field. Tab still reaches everything.
- [ ] Screen reader: the field is labelled "Search your library and
  YouTube" inside a search landmark; results are announced (e.g. "7 songs
  in your library", then "3 more from YouTube").
- [ ] Switching: a playlist (sidebar, tile or chip) replaces Search; Search
  replaces a playlist page; Home closes Search. Now Playing opened from
  Search (the bar's turntable, cover or lyrics) goes back to Search when you
  close it (button, Esc or ‹).
- [ ] The results scroll under the field, which stays at the top. Nothing
  runs off the page, and there's no sideways scroll.
- [ ] The old search window never opens on the desktop.
- [ ] 601–900px window (icon rail): the field and results fit, chips and
  tiles wrap.
- [ ] Each room theme (Settings → Appearance): the page, the field and the
  chips follow the theme.
- [ ] A phone (its Search tab), a short landscape phone (the search window),
  and the app (`?app=1`, the search window) are exactly as before.

## Side panel: Up next and Lyrics (step 8)

A panel on the right of the page, from the top of the window to the player
bar, with two tabs: Up next and Lyrics. The bar's queue and lyrics buttons
open it on their tab. The page narrows to make room at every desktop width
(the panel is narrower beside the icon rail), so nothing sits under it.

- [ ] Queue in the bar: the panel opens on Up next, the button lights up,
  and focus moves to the Up next tab. Pressed again, the panel closes, the
  page widens back, and focus stays on the button. The old Up next window
  never opens on the desktop.
- [ ] Up next shows the playing song, then the queued songs with Clear. A
  song row's ⋯ → Play next / Add to queue shows up there at once.
- [ ] Drag a queued song by its handle to reorder it. With a song's play or
  × button focused, Alt+↑ / Alt+↓ move it (focus follows). The order stays
  after a reload.
- [ ] × removes a song (focus stays on the × in its place). Clicking a song
  plays it now, and the songs before it leave the queue. Clear empties it
  ("Nothing queued yet").
- [ ] "Next from (the playing playlist)": with shuffle off, its next five
  songs in order (round to the top unless repeat is off); clicking one plays
  it. With shuffle on it only says the songs are picked as they play. It
  follows song changes, shuffle and repeat, and edits to that playlist.
- [ ] A playlist's ⋯ → Up next opens the panel on Up next.
- [ ] Lyrics in the bar (from Home, a playlist or Search): the panel opens
  on Lyrics with lyrics turned on. Synced lyrics light up line by line and
  scroll to follow the song; clicking a line jumps there; −, + and the
  offset nudge the timing; the small note button turns lyrics off and on.
  Switching between Home, playlists and Search keeps them there.
- [ ] Open Now Playing with the panel on Lyrics: the lyrics show on the Now
  Playing page only (never twice), and the panel's Lyrics tab says "The
  lyrics are on the Now Playing page." Close Now Playing: they come back to
  the panel. Up next stays usable beside Now Playing.
- [ ] The tabs: click either, or with a tab focused use ←/→ (and Home/End).
  The bar's buttons light up for the tab that shows.
- [ ] Esc with focus in the panel closes it, focus back on the bar's
  button for that tab (Esc never closes Now Playing from inside the panel).
  The × in the panel's corner does the same.
- [ ] Reload: the panel comes back open on the same tab, or stays closed.
  It's per device and browser.
- [ ] Layout at 800, 1024, 1440 and 1920px wide: the panel reaches from the
  top to the bar, the page beside it has no sideways scroll, and Home, a
  playlist page, Search and Now Playing all fit (long titles end in "…").
- [ ] Screen reader: the panel is an "Up next and lyrics" complementary
  landmark with a "Side panel" tab list; each queued song's buttons say
  "Play now: (song)" and "Remove from queue: (song)"; the lyrics are a
  "Lyrics" region you can Tab to and scroll with the arrows. The panel
  itself announces nothing on its own (no live regions).
- [ ] Narrow the window below 600px with the panel open: the phone layout
  shows its own queue window and Now Playing lyrics; widen it again and the
  panel is back.
- [ ] Each room theme (Settings → Appearance): the panel follows the theme.
- [ ] A phone, a short landscape phone and the app (`?app=1`) keep the Up
  next window and their own lyrics exactly as before.

## Avatar menu (step 9)

Your initial in a round button at the top right of the page, on Home, a
playlist page, Search and Now Playing. It opens a menu: your name and
email, Your listening, Bring your music over, Settings (Playback,
Appearance, Account), Install the app (only when the browser offers it)
and Log out. Home's Stats and Settings buttons are gone.

- [ ] The initial is the same as on the phone's Home (your name's first
  letter, or your email's). Hovering shows your name (or email).
- [ ] It sits at the top right on every page, in line with Home's greeting
  and Now Playing's heading, and never covers a page's title, the Search
  field or the side panel (open the panel: the avatar moves left with the
  page). On a long playlist scrolled down it sits over the column labels'
  row without hiding a label.
- [ ] Click it: the menu opens under it with your name and email on top.
  Click it again, click anywhere else, or press Esc: it closes.
- [ ] Keyboard: Tab to the avatar, Enter (or ↓) opens the menu on its first
  item, ↑ on its last; ↑/↓ move (round the ends), Home/End jump; Enter picks;
  Esc closes with focus back on the avatar; Tab closes and moves on.
- [ ] Your listening opens the stats window; Bring your music over opens
  "Where's your music now?"; Playback, Appearance and Account open Settings
  on that tab. Closing any of them puts focus back on the avatar.
- [ ] Change your name in Settings → Account: the avatar's initial, the
  menu's name and the hover text follow without a reload.
- [ ] Chrome or Edge, not installed yet: "Install the app" shows (above
  Log out) and opens the browser's install prompt. Installed, or in Firefox
  and Safari: no such item.
- [ ] Log out logs you out and lands on the sign-in page.
- [ ] The menu fits at 800×600 (above the player bar) and at 1440 and
  1920px wide, with or without the side panel.
- [ ] Screen reader: the avatar says "Account: (your name)", a menu button,
  collapsed/expanded; the menu is "Account" with a "Settings" group.
- [ ] Narrow the window below 600px with the menu open: it closes and the
  phone's own avatar (top right of Home) opens the You page as before.
- [ ] Each room theme (Settings → Appearance): the avatar and the menu
  follow the theme.
- [ ] A phone, a short landscape phone and the app (`?app=1`) look exactly
  as before (the app keeps its Stats and Settings buttons).

## First-run setup

Browser suite: `tests/browser/suites/setup-wizard-check.js` (phone and desktop).

- [ ] A brand-new account (no playlists) opens on the setup: a centred card
  over the page, focus on "Welcome to Music Player". Tab reaches Get started;
  Enter goes on. Tab and Shift+Tab stay inside the card; Esc closes it.
- [ ] Each step's heading takes focus (a screen reader reads the step);
  Back and "Step N of 6" at the top; Enter in the name or playlist field
  submits it; the sleeve colours are one radio group (arrow keys).
- [ ] "You're all set" points at the sidebar (Home, Search, Your Library)
  and the avatar.
- [ ] 1024, 1440 and 1920px wide, and 800×600: the card fits, nothing is cut
  off (it scrolls inside on short windows).

@php
    // Render-side sanitizers ported from the legacy sanitize.php. Colors are
    // validated before being interpolated raw into style="..." attributes.
    if (!function_exists('nt_safe_css_color')) {
        function nt_safe_css_color($c, string $fallback = '#d4a574'): string
        {
            if (!is_string($c)) {
                return $fallback;
            }
            $c = trim($c);
            if (preg_match('/^#[0-9a-fA-F]{3,8}$/', $c)) {
                return $c;
            }
            if (preg_match('/^(rgb|rgba|hsl|hsla)\(\s*[0-9.,%\s]+\)$/i', $c)) {
                return $c;
            }
            if (preg_match('/^[a-zA-Z]{1,30}$/', $c)) {
                return $c;
            }
            return $fallback;
        }
    }
@endphp<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <title>Music Player</title>
    <link rel="manifest" href="/manifest.webmanifest">
    <meta name="theme-color" content="#14262b">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <link rel="apple-touch-icon" href="/icons/icon-192.png">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="{{ asset('css/styles.css') }}?v={{ filemtime(public_path('css/styles.css')) }}">
    <script>
        /* Room theme, applied before first paint so no default-color flash.
           Kept in sync with ROOM_THEMES in script.js. */
        (function () {
            try {
                window.__roomThemeColors = { 'blue-hour': '#14262b', 'golden-hour': '#211a16', 'after-hours': '#14171e', 'velvet': '#201318', 'greenroom': '#171d13' };
                var t = localStorage.getItem('musicTheme');
                if (t && t !== 'blue-hour' && window.__roomThemeColors[t]) {
                    document.documentElement.setAttribute('data-theme', t);
                    var m = document.querySelector('meta[name="theme-color"]');
                    if (m) m.setAttribute('content', window.__roomThemeColors[t]);
                }
                if (localStorage.getItem('sleeveStyle') === 'lean') {
                    document.documentElement.setAttribute('data-sleeve', 'lean');
                }
            } catch (e) { /* private mode etc. — default theme */ }
        })();
        /* Phone shell, before first paint: the React Native app (?app=1) gets
           none of the tab bar (the phone CSS can't tell it apart otherwise),
           and a reload reopens the tab its history entry was on. */
        (function () {
            var root = document.documentElement;
            if (window.ReactNativeWebView || new URLSearchParams(location.search).has('app')) {
                root.classList.add('app-shell');
                return;
            }
            // Desktop redesign scope (html.dv2): wider than 600px and not a
            // short landscape touch phone, i.e. outside both phone shells.
            // Same query as script.js's shellMq, which keeps it in sync.
            if (!window.matchMedia('(max-width: 600px), (min-width: 601px) and (max-height: 500px) and (pointer: coarse)').matches) {
                root.classList.add('dv2');
            }
            var tab = 'home';
            try {
                var st = history.state;
                if (st && st.mDepth > 0 && (st.mTab === 'search' || st.mTab === 'library')) tab = st.mTab;
                // The You page over Home (script.js drops this if it doesn't adopt it)
                else if (st && st.mDepth > 0 && st.mStack && st.mStack[0] && st.mStack[0].n === 'you') root.classList.add('m-you');
            } catch (e) {}
            root.setAttribute('data-m-tab', tab);
            // The browser's install prompt can fire before script.js runs:
            // keep it for the phone You page's Install row. Only phone-width
            // pages swap the browser's own install UI for that row.
            window.addEventListener('beforeinstallprompt', function (e) {
                if (window.matchMedia('(max-width: 600px)').matches) e.preventDefault();
                window.__installPrompt = e;
            });
        })();
    </script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jsmediatags/3.9.5/jsmediatags.min.js" defer></script>
</head>
<body>

    {{-- Desktop sidebar: Home, Search, Your Library, + (html.dv2 only;
         display:none everywhere else). script.js (desktopSidebar) fills the
         playlist rows from playlistsMeta and keeps them in step. --}}
    <nav id="dvSide" aria-label="Library and navigation">
        <ul class="dv-side-nav">
            <li>
                <button type="button" class="dv-side-link" id="dvSideHome" aria-current="page" title="Home">
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M4 10.2 12 4l8 6.2V19a1 1 0 0 1-1 1h-4.6v-5.6H9.6V20H5a1 1 0 0 1-1-1z"/></svg>
                    <span class="dv-side-label">Home</span>
                </button>
            </li>
            <li>
                <button type="button" class="dv-side-link" id="dvSideSearch" aria-keyshortcuts="/ Control+K" title="Search (/)">
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.6"/><path d="m20 20-4.4-4.4"/></svg>
                    <span class="dv-side-label">Search</span>
                </button>
            </li>
        </ul>
        <section class="dv-side-lib" aria-labelledby="dvSideLibTitle">
            <div class="dv-side-lib-head">
                <h2 class="dv-side-lib-title" id="dvSideLibTitle">
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4v16M9.5 4v16"/><path d="m14 4.6 4.6 15"/></svg>
                    <span class="dv-side-label">Your Library</span>
                </h2>
                <div class="dv-side-add-wrap">
                    <button type="button" class="dv-side-icon-btn" id="dvSideAdd" aria-haspopup="menu" aria-expanded="false" aria-controls="dvSideAddMenu" aria-label="Add to your library" title="Add to your library">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
                    </button>
                    <div class="dv-side-menu" id="dvSideAddMenu" role="menu" aria-label="Add to your library" hidden>
                        <button type="button" role="menuitem" data-dv-add="new">New playlist</button>
                        <button type="button" role="menuitem" data-dv-add="bring" aria-haspopup="dialog">Bring your music over</button>
                    </div>
                </div>
            </div>
            <div class="dv-side-chips" role="group" aria-label="Show playlists from">
                <button type="button" class="dv-side-chip" data-dv-source="all" aria-pressed="true">All</button>
                <button type="button" class="dv-side-chip" data-dv-source="user" aria-pressed="false">Local</button>
                <button type="button" class="dv-side-chip" data-dv-source="spotify" aria-pressed="false">Spotify</button>
            </div>
            <ul class="dv-side-list" id="dvSideList" aria-labelledby="dvSideLibTitle"></ul>
            <p class="dv-side-empty" id="dvSideEmpty" hidden>No playlists yet. Use + to make one or bring your music over.</p>
        </section>
        {{-- The deck extras the old crate rail held (pitch stays on the deck) --}}
        <div class="dv-side-foot" role="group" aria-label="Turntable extras">
            <button type="button" class="dv-side-extra" id="dvSideCrackle" aria-pressed="false" title="Vinyl crackle between songs">
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/></svg>
                <span class="dv-side-label">Crackle</span>
            </button>
            <button type="button" class="dv-side-extra" id="dvSideGif" aria-haspopup="dialog" title="Make a spinning vinyl GIF">
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M12 3a9 9 0 0 1 9 9" stroke-width="2.4"/></svg>
                <span class="dv-side-label">Make GIF</span>
            </button>
        </div>
    </nav>

    <main id="music-section">
        <!-- Vinyl Collection Room -->
        @if (session('status'))
        <div class="app-flash" id="appFlash">{{ session('status') }}</div>
        <script>setTimeout(function () { var f = document.getElementById('appFlash'); if (f) f.remove(); }, 4200);</script>
        @endif
        @if (!empty($pendingShare))
        {{-- Saved from a share page before signing in: offered, never copied without a click --}}
        <form class="app-flash app-flash-offer" id="pendingShareOffer" method="POST" action="{{ route('shared.add', $pendingShare['token']) }}">
            @csrf
            <span>Save “{{ $pendingShare['name'] }}” ({{ $pendingShare['count'] }} {{ Str::plural('song', $pendingShare['count']) }}) to your library?</span>
            <span class="app-flash-actions">
                <button type="submit" class="app-flash-btn">Save</button>
                <button type="button" class="app-flash-btn app-flash-btn-quiet" onclick="this.closest('form').remove()">No thanks</button>
            </span>
        </form>
        @endif
        <div class="vinyl-crate-view" id="vinylCrateView">
            <!-- Room Background -->
            <div class="room-bg">
                <div class="room-wall"></div>
                <div class="room-floor"></div>

                <!-- Floor rug -->
                <div class="floor-rug"></div>

                <!-- Wall decorations -->
                <div class="wall-art">
                    <div class="art-frame">
                        <div class="art-content">&#9834;</div>
                    </div>
                </div>

                <div class="wall-poster">
                    <div class="poster-content">
                        <div class="poster-text">LIVE<br>MUSIC</div>
                    </div>
                </div>

                <div class="wall-shelf">
                    <div class="shelf-board"></div>
                    <div class="shelf-items">
                        <div class="shelf-book"></div>
                        <div class="shelf-book b2"></div>
                        <div class="shelf-headphones"></div>
                    </div>
                </div>

                <div class="wall-clock">
                    <div class="clock-face">
                        <div class="clock-marks">
                            <div class="clock-mark major" style="transform:rotate(0deg)"></div>
                            <div class="clock-mark" style="transform:rotate(30deg)"></div>
                            <div class="clock-mark" style="transform:rotate(60deg)"></div>
                            <div class="clock-mark major" style="transform:rotate(90deg)"></div>
                            <div class="clock-mark" style="transform:rotate(120deg)"></div>
                            <div class="clock-mark" style="transform:rotate(150deg)"></div>
                            <div class="clock-mark major" style="transform:rotate(180deg)"></div>
                            <div class="clock-mark" style="transform:rotate(210deg)"></div>
                            <div class="clock-mark" style="transform:rotate(240deg)"></div>
                            <div class="clock-mark major" style="transform:rotate(270deg)"></div>
                            <div class="clock-mark" style="transform:rotate(300deg)"></div>
                            <div class="clock-mark" style="transform:rotate(330deg)"></div>
                        </div>
                        <div class="clock-hand hour"></div>
                        <div class="clock-hand minute"></div>
                        <div class="clock-center"></div>
                    </div>
                </div>

                <!-- String lights -->
                <div class="string-lights">
                    <svg class="string-wire" viewBox="0 0 800 60" preserveAspectRatio="none">
                        <path d="M0,10 Q200,50 400,20 T800,30" fill="none" stroke="#333" stroke-width="2"/>
                    </svg>
                    <div class="string-bulb" style="left: 10%;"></div>
                    <div class="string-bulb" style="left: 25%;"></div>
                    <div class="string-bulb" style="left: 40%;"></div>
                    <div class="string-bulb" style="left: 55%;"></div>
                    <div class="string-bulb" style="left: 70%;"></div>
                    <div class="string-bulb" style="left: 85%;"></div>
                </div>

                <!-- Hanging main lights -->
                <div class="hanging-lights">
                    <div class="light-bulb"><div class="bulb-glow"></div></div>
                    <div class="light-bulb"><div class="bulb-glow"></div></div>
                    <div class="light-bulb"><div class="bulb-glow"></div></div>
                </div>

                <!-- Floating dust particles -->
                <div class="dust-particles">
                    <span></span><span></span><span></span><span></span><span></span>
                </div>

                <!-- Ambient overlay -->
                <div class="ambient-overlay"></div>

                <!-- Floor decorations -->
                <div class="floor-speaker left-speaker">
                    <div class="speaker-body">
                        <div class="speaker-cone large"></div>
                        <div class="speaker-cone small"></div>
                        <div class="speaker-led"></div>
                    </div>
                </div>
                <div class="floor-speaker right-speaker">
                    <div class="speaker-body">
                        <div class="speaker-cone large"></div>
                        <div class="speaker-cone small"></div>
                        <div class="speaker-led"></div>
                    </div>
                </div>
                <div class="floor-records">
                    <div class="floor-vinyl v1"></div>
                    <div class="floor-vinyl v2"></div>
                    <div class="floor-vinyl v3"></div>
                </div>
                <div class="floor-plant">
                    <div class="plant-pot"></div>
                    <div class="plant-stem s1"></div>
                    <div class="plant-stem s2"></div>
                    <div class="plant-stem s3"></div>
                    <div class="plant-leaf l1"></div>
                    <div class="plant-leaf l2"></div>
                    <div class="plant-leaf l3"></div>
                </div>
            </div>

            <!-- Main Content -->
            <div class="room-content">
                <!-- Left Side - Turntable setup -->
                <div class="room-left">
                    <div class="setup-stand">
                        <div class="mini-turntable" onclick="selectPlaylistFromCrate('{{ $activePlaylistId }}')" title="{{ $activePlaylist['name'] ?? 'Now Playing' }}">
                            <div class="turntable-base">
                                <div class="turntable-platter">
                                    <div class="mini-strobe-dots"></div>
                                    <div class="platter-vinyl" id="platterVinyl">
                                        <div class="platter-label" id="platterLabel" style="--label-color: {!! nt_safe_css_color($activePlaylist['color'] ?? '#d4a574') !!}">
                                            @if (!empty($current['cover']))
                                            <img src="{{ $current['cover'] }}" alt="">
                                            @endif
                                        </div>
                                    </div>
                                </div>
                                <div class="turntable-arm" id="miniTonearm"></div>
                                <div class="mini-tonearm-base"></div>
                                <div class="mini-pitch-slider" onclick="event.stopPropagation()">
                                    <div class="mini-pitch-track" id="miniPitchTrack">
                                        <div class="mini-pitch-thumb" id="miniPitchThumb"></div>
                                        <div class="mini-pitch-detent"></div>
                                    </div>
                                    <div class="mini-pitch-value" id="miniPitchValue">0%</div>
                                </div>
                                <div class="turntable-led" id="turntableLed"></div>
                            </div>
                        </div>
                        <div class="stand-shelf">
                            <div class="amp-unit">
                                <div class="amp-display"><span class="amp-display-text" id="ampDisplayText">{{ implode(' - ', array_filter([$current['artist'] ?? '', $current['title'] ?? ''])) ?: 'No song' }}</span></div>
                                <div class="amp-knobs">
                                    <span onclick="prevSong()" title="Previous"></span><span onclick="toggleMusic()" title="Play/Pause"></span><span onclick="nextSong()" title="Next"></span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="side-table">
                        <div class="loop-btn" id="loopCoaster" data-loop="playlist" onclick="toggleLoopMode()">
                            <div class="loop-btn-icon" id="loopIcon">
                                <svg class="loop-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M17 2l4 4-4 4"/>
                                    <path d="M3 11v-1a4 4 0 0 1 4-4h14"/>
                                    <path d="M7 22l-4-4 4-4"/>
                                    <path d="M21 13v1a4 4 0 0 1-4 4H3"/>
                                </svg>
                            </div>
                            <div class="loop-btn-label" id="loopLabel">loop all</div>
                        </div>
                        <div class="loop-btn shuffle-btn" id="shuffleBtn" data-shuffle="shuffle" onclick="toggleShuffle()">
                            <div class="loop-btn-icon" id="shuffleIcon">
                                <svg class="loop-svg shuffle-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M16 3h5v5"/>
                                    <path d="M4 20L21 3"/>
                                    <path d="M21 16v5h-5"/>
                                    <path d="M15 15l6 6"/>
                                    <path d="M4 4l5 5"/>
                                </svg>
                            </div>
                            <div class="loop-btn-label" id="shuffleLabel">shuffle on</div>
                        </div>
                        <div class="loop-btn make-gif-btn" id="makeGifBtn" onclick="openVinylGifModal()" title="Make a spinning vinyl GIF">
                            <div class="loop-btn-icon" id="makeGifIcon">
                                <svg class="loop-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="12" cy="12" r="9"/>
                                    <circle cx="12" cy="12" r="3.5"/>
                                    <circle cx="12" cy="12" r="0.8" fill="currentColor"/>
                                    <path d="M12 3 A9 9 0 0 1 21 12" stroke-width="2.4"/>
                                </svg>
                            </div>
                            <div class="loop-btn-label" id="makeGifLabel">make gif</div>
                        </div>
                        <div class="loop-btn crackle-btn" id="crackleBtn" data-crackle="off" onclick="toggleCrackle()">
                            <div class="loop-btn-icon" id="crackleIcon">
                                <svg class="loop-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="12" cy="12" r="10"/>
                                    <circle cx="12" cy="12" r="6"/>
                                    <circle cx="12" cy="12" r="2"/>
                                </svg>
                            </div>
                            <div class="loop-btn-label" id="crackleLabel">crackle</div>
                        </div>
                        <div class="loop-btn sleep-btn" id="sleepBtn" data-sleep="off" onclick="toggleSleepMenu(event)" title="Sleep timer">
                            <div class="loop-btn-icon" id="sleepIcon">
                                <svg class="loop-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>
                                </svg>
                            </div>
                            <div class="loop-btn-label" id="sleepLabel">sleep</div>
                            <div class="sleep-menu" id="sleepMenu" onclick="event.stopPropagation()" hidden>
                                <button type="button" onclick="setSleepTimer(15)">15 min</button>
                                <button type="button" onclick="setSleepTimer(30)">30 min</button>
                                <button type="button" onclick="setSleepTimer(45)">45 min</button>
                                <button type="button" onclick="setSleepTimer(60)">60 min</button>
                                <button type="button" onclick="setSleepTimer('end')">End of track</button>
                                <button type="button" class="sleep-off" onclick="setSleepTimer(0)">Off</button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Center - Records -->
                <div class="room-center" id="roomCenter">
                    @php
                        // Avatar initial: the display name unless it's a signup
                        // placeholder, else the email, else a note.
                        $acctName = trim((string) auth()->user()->name);
                        if (in_array($acctName, ['New member', 'Spotify listener'], true)) $acctName = '';
                        $acctInitial = mb_strtoupper(mb_substr($acctName !== '' ? $acctName : (string) auth()->user()->email, 0, 1));
                        if ($acctInitial === '') $acctInitial = '♪';
                        // Under the name on the phone You page: the email, the member
                        // number, or how a Spotify-only account signs in.
                        $acctSub = (string) auth()->user()->email;
                        if ($acctSub === '' && auth()->user()->member_number !== null) $acctSub = 'Member ' . auth()->user()->formattedMemberNumber();
                        if ($acctSub === '' && auth()->user()->spotify_user_id) $acctSub = 'Signed in with Spotify';
                        // A password (or PIN) the user knows: Spotify-only accounts
                        // have none, so Settings offers them no password forms.
                        $acctHasLogin = auth()->user()->email || auth()->user()->member_number !== null;
                        // Spotify is offered only when this server is set up for it.
                        $spotifyOn = (bool) config('services.spotify.client_id');
                        // Record-cover recognition (the Song Scanner) needs a Gemini key.
                        $geminiOn = (bool) config('services.gemini.key');
                    @endphp
                    {{-- Phone tabs: Home and Library headers over the same crate
                         (shown per tab by the phone CSS; .m-only keeps them off
                         desktop, landscape and the app) --}}
                    <header class="m-tab-head m-only" id="mHomeHead">
                        <h1 class="m-tab-title" id="mGreeting">Hello</h1>
                        {{-- Full screen on a tap, when the You page's "Button on
                             Home" is on (browser tabs only; script.js shows it) --}}
                        <button type="button" class="m-icon-btn m-fs-btn" id="mFsBtn" aria-label="Full screen" data-keeps-gesture hidden>
                            <svg class="m-fs-enter" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/></svg>
                            <svg class="m-fs-exit" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4v3.5A1.5 1.5 0 0 1 7.5 9H4M20 9h-3.5A1.5 1.5 0 0 1 15 7.5V4M15 20v-3.5a1.5 1.5 0 0 1 1.5-1.5H20M4 15h3.5A1.5 1.5 0 0 1 9 16.5V20"/></svg>
                        </button>
                        <button type="button" class="m-avatar-btn" id="mAvatarBtn" aria-label="You: your listening and settings">
                            <span class="m-avatar" id="mAvatar">{{ $acctInitial }}</span>
                        </button>
                    </header>
                    <header class="m-tab-head m-only" id="mLibraryHead">
                        <h1 class="m-tab-title">Library</h1>
                        <button type="button" class="m-icon-btn" id="mLibraryNew" aria-label="Add to your library" aria-haspopup="dialog">
                            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
                        </button>
                    </header>
                    <div class="greeting-text">
                        <h1>My Collection</h1>
                        <p>pick something to play</p>
                    </div>

                    @php
                    // ---- Conveyor precompute: gather one render-record per playlist ----
                    // NOTE: keeps $totalTracks / $usedCovers so the <div class="collection-stats">
                    // block that follows (tracks / playlists / vibes) still works unchanged.
                    $totalTracks = 0;
                    $usedCovers = [];
                    $cards = [];
                    foreach ($playlists as $playlistId => $playlist) {
                        $playlistSongs = $playlist['songs'] ?? [];
                        $songCount = count($playlistSongs);
                        $totalTracks += $songCount;
                        $playlistColor = $playlist['color'] ?? '#d4a574';

                        // Find cover for this playlist
                        $coverUrl = '';
                        $coverSong = null;
                        $coverSongIdx = $playlist['coverSongIndex'] ?? null;
                        if ($coverSongIdx !== null && isset($playlistSongs[$coverSongIdx]) && !empty($playlistSongs[$coverSongIdx]['cover'])) {
                            $coverUrl = $playlistSongs[$coverSongIdx]['cover'];
                            $coverSong = $playlistSongs[$coverSongIdx];
                        } else {
                            foreach ($playlistSongs as $song) {
                                $songCover = $song['cover'] ?? '';
                                if ($songCover && !in_array($songCover, $usedCovers)) {
                                    $coverUrl = $songCover;
                                    $coverSong = $song;
                                    $usedCovers[] = $songCover;
                                    break;
                                }
                            }
                            if (!$coverUrl && !empty($playlistSongs[0]['cover'])) {
                                $coverUrl = $playlistSongs[0]['cover'];
                                $coverSong = $playlistSongs[0];
                            }
                        }
                        $cards[] = [
                            'id'        => $playlistId,
                            'playlist'  => $playlist,
                            'songCount' => $songCount,
                            'color'     => $playlistColor,
                            'coverUrl'  => $coverUrl,
                            'firstSong' => $coverSong ?? $playlistSongs[0] ?? null,
                        ];
                    }

                    // Interleave into two rows so they stay balanced even with odd totals.
                    // The creation index rides along so the phone grid can restore
                    // true creation order via CSS order:var(--ord).
                    $row1 = $row2 = [];
                    foreach ($cards as $i => $c) {
                        $c['ord'] = $i;
                        if ($i % 2 === 0) $row1[] = $c;
                        else              $row2[] = $c;
                    }

                    $renderCard = function ($c) use ($activePlaylistId) {
                        $playlistId = $c['id'];
                        $playlist   = $c['playlist'];
                        $songCount  = $c['songCount'];
                        // Validate before it is interpolated raw into style="" attributes below.
                        $color      = nt_safe_css_color($c['color'] ?? '#d4a574');
                        $coverUrl   = $c['coverUrl'];
                        $firstSong  = $c['firstSong'];
                        // Card source for the Local/Spotify filter: an explicit
                        // 'source' field wins; otherwise a playlist is Spotify only
                        // if it has songs and every one carries a spotify_id (which
                        // survives YouTube resolution — that only ADDS youtube_id).
                        $plSongs = $playlist['songs'] ?? [];
                        if (($playlist['source'] ?? '') === 'spotify') {
                            $source = 'spotify';
                        } elseif (!empty($plSongs) && count(array_filter($plSongs, fn($s) => !empty($s['spotify_id']))) === count($plSongs)) {
                            $source = 'spotify';
                        } else {
                            $source = 'user';
                        }

                        $pid        = htmlspecialchars($playlistId);
                        $ord        = (int) ($c['ord'] ?? 0);
                        $nowPlaying = ($playlistId === $activePlaylistId ? ' now-playing' : '') . ($songCount === 0 ? ' is-empty' : '');
                        $plName     = htmlspecialchars($playlist['name']);
                        $countText  = $songCount . ($songCount === 1 ? ' song' : ' songs');
                        $vinylImg   = $coverUrl ? '<img src="' . htmlspecialchars($coverUrl) . '" alt="">' : '';
                        $coverMain  = $coverUrl ? '<img src="' . htmlspecialchars($coverUrl) . '" alt="" class="cover-main">' : '';
                        $preview    = '';
                        if ($firstSong) {
                            $preview = '<span class="preview-track">' . htmlspecialchars(substr($firstSong['title'], 0, 48)) . (strlen($firstSong['title']) > 48 ? '...' : '') . '</span>';
                        }
                        echo <<<HTML
                        <div class="record-card{$nowPlaying}"
                             data-playlist="{$pid}"
                             data-source="{$source}"
                             style="--card-color: {$color}; --ord: {$ord}"
                             onclick="selectPlaylistFromCrate('{$pid}')">
                            <div class="record-card-vinyl">
                                <div class="vinyl-peek">
                                    <div class="vinyl-grooves"></div>
                                    <div class="vinyl-shine"></div>
                                    <div class="vinyl-label">{$vinylImg}</div>
                                    <div class="vinyl-hole"></div>
                                </div>
                            </div>
                            <div class="record-card-cover" role="button" tabindex="0" aria-label="{$plName}, {$countText}">
                                <div class="cover-art" style="background: linear-gradient(135deg, {$color} 0%, {$color}99 100%);">
                                    {$coverMain}
                                    <div class="cover-overlay"></div>
                                    <div class="cover-texture"></div>
                                </div>
                                <div class="cover-badge" style="--pl-color: {$color};">{$songCount}</div>
                                <div class="cover-info">
                                    <div class="cover-title">{$plName}</div>
                                    <div class="cover-preview">{$preview}</div>
                                </div>
                                <div class="cover-glow"></div>
                            </div>
                            <div class="play-hint"><span><svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M6.4 5.6a1.1 1.1 0 0 1 1.68-.94l9.6 6.4a1.1 1.1 0 0 1 0 1.88l-9.6 6.4a1.1 1.1 0 0 1-1.68-.94z"/></svg></span></div>
                            <button class="playlist-edit-btn" onclick="event.stopPropagation(); showPlaylistEditModal('{$pid}')" title="Edit playlist">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
                                    <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                                </svg>
                            </button>
                            <div class="card-reflection"></div>
                            <div class="card-caption m-only">
                                <span class="card-caption-text">
                                    <span class="card-caption-title">{$plName}</span>
                                    <span class="card-caption-meta"><span class="card-eq" aria-hidden="true"><i></i><i></i><i></i></span><span class="card-caption-count">{$countText}</span></span>
                                </span>
                                <button type="button" class="card-more" onclick="event.stopPropagation(); showPlaylistEditModal('{$pid}')" aria-label="Edit {$plName}">
                                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>
                                </button>
                            </div>
                        </div>
                        HTML;
                    };
                    @endphp
                    <div class="collection-toolbar">
                        <div class="source-filter" id="sourceFilter">
                            <button class="source-filter-btn active" data-source-filter="all"     onclick="setSourceFilter('all')">All</button>
                            <button class="source-filter-btn"        data-source-filter="user"    onclick="setSourceFilter('user')">Local</button>
                            <button class="source-filter-btn"        data-source-filter="spotify" onclick="setSourceFilter('spotify')">Spotify</button>
                        </div>
                        <button class="new-playlist-btn" onclick="showPlaylistCreateModal()" title="New playlist">+ New<span class="new-playlist-word"> playlist</span></button>
                        <button class="new-playlist-btn crate-search-btn" onclick="showSearchModal()" title="Search your whole library"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true" style="vertical-align:-2px;margin-right:6px"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>Search</button>
                        <button class="new-playlist-btn crate-stats-btn" onclick="showStatsModal()" title="Your listening stats"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px;margin-right:6px"><path d="M4 20V13"/><path d="M10 20V6"/><path d="M16 20V10"/><path d="M3 20h18"/></svg>Stats</button>
                        <button class="new-playlist-btn crate-settings-btn" onclick="showSettingsModal()" title="Settings"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" style="vertical-align:-2px;margin-right:6px"><path d="M4 7.5h7M17.5 7.5H20M4 16.5h2.5M11.5 16.5H20"/><circle cx="14.5" cy="7.5" r="2.2"/><circle cx="8" cy="16.5" r="2.2"/></svg>Settings</button>
                    </div>
                    @if ($totalTracks === 0)
                    {{-- Desktop only (hidden elsewhere by CSS): first-run nudge while the crate has no songs --}}
                    <div class="crate-empty-hint" id="crateEmptyHint">
                        <div class="crate-empty-disc" aria-hidden="true"></div>
                        <div class="crate-empty-copy">
                            <p class="crate-empty-title">Start your collection</p>
                            <p class="crate-empty-text">Where&rsquo;s your music now? Bring it over from Spotify, Apple Music, YouTube or your files, or add songs one by one.</p>
                        </div>
                        <div class="crate-empty-actions">
                            {{-- "Where's your music now?" (script.js showBringMusicModal) --}}
                            <button type="button" class="is-primary" id="crateEmptyBring" onclick="showBringMusicModal()" aria-haspopup="dialog">Bring your music over</button>
                            <button type="button" onclick="showAddSongModal()">Add a song</button>
                        </div>
                    </div>
                    @endif
                    {{-- Recently played songs — a Spotify-style "jump back in"
                         shelf. Filled + shown by updateRecentSongs() from the
                         injected `recentSongs`; stays hidden when empty. --}}
                    <div class="recent-songs hidden" id="recentSongsShelf">
                        <div class="recent-songs-label">Jump back in</div>
                        <div class="recent-songs-track" id="recentSongsTrack"></div>
                    </div>
                    {{-- Phone Home: recently opened playlists, filled by the phone shell --}}
                    <div class="m-recent-playlists m-only" id="mRecentPlaylists"></div>
                    <section class="crate-shelf">
                    <div class="recent-songs-label">Your playlists</div>
                    <div class="records-conveyor" id="recordsConveyor">
                        <div class="conveyor-rows">
                            <div class="conveyor-row" data-row="1">
                                <div class="conveyor-track">
                                    @php foreach ($row1 as $c) $renderCard($c); @endphp
                                    {{-- Marquee loop clones: display:contents on desktop, hidden on phones --}}
                                    <div class="conveyor-dupes" aria-hidden="true">
                                        @php foreach ($row1 as $c) $renderCard($c); @endphp
                                    </div>
                                </div>
                            </div>
                            <div class="conveyor-row" data-row="2">
                                <div class="conveyor-track">
                                    @php foreach ($row2 as $c) $renderCard($c); @endphp
                                    <div class="conveyor-dupes" aria-hidden="true">
                                        @php foreach ($row2 as $c) $renderCard($c); @endphp
                                    </div>
                                </div>
                            </div>
                            {{-- Desktop only (hidden elsewhere by CSS): an empty sleeve at the end of the grid --}}
                            <button type="button" class="crate-new-tile" onclick="showPlaylistCreateModal()">
                                <span class="crate-new-tile-icon" aria-hidden="true">+</span>
                                <span class="crate-new-tile-label">New playlist</span>
                            </button>
                            {{-- Desktop only, next to it: "Where's your music now?" any time --}}
                            <button type="button" class="crate-new-tile crate-bring-tile" id="crateBringTile" onclick="showBringMusicModal()" aria-haspopup="dialog">
                                <span class="crate-new-tile-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16"/></svg></span>
                                <span class="crate-new-tile-label">Bring your music over</span>
                            </button>
                        </div>
                    </div>
                    </section>

                    <div class="collection-stats">
                        <div class="stat-item">
                            <span class="stat-icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.6"/><circle cx="12" cy="12" r="0.8" fill="currentColor" stroke="none"/></svg></span>
                            <span class="stat-num">{{ $totalTracks }}</span>
                            <span class="stat-text">{{ Str::plural('track', $totalTracks) }}</span>
                        </div>
                        <div class="stat-divider"></div>
                        <div class="stat-item">
                            <span class="stat-icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3.5" y="6" width="17" height="13" rx="1.5"/><path d="M7 6v13M12 6v13M17 6v13" opacity="0.65"/></svg></span>
                            <span class="stat-num">{{ count($playlists) }}</span>
                            <span class="stat-text">{{ Str::plural('playlist', count($playlists)) }}</span>
                        </div>
                        <div class="stat-divider"></div>
                        <div class="stat-item">
                            <span class="stat-icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M12 3.5c.7 4.6 2.9 6.8 7.5 7.5-4.6.7-6.8 2.9-7.5 7.5-.7-4.6-2.9-6.8-7.5-7.5 4.6-.7 6.8-2.9 7.5-7.5z"/><path d="M18.5 15.5c.3 1.9 1.2 2.8 3 3-1.8.3-2.7 1.2-3 3-.3-1.8-1.2-2.7-3-3 1.8-.2 2.7-1.1 3-3z" opacity="0.65"/></svg></span>
                            <span class="stat-num stat-num-infinity">&#8734;</span>
                            <span class="stat-text">vibes</span>
                        </div>
                    </div>
                </div>

                <!-- Right Side - Decorations -->
                <div class="room-right">
                    <div class="vinyl-crate-decor">
                        <div class="crate-box">
                            <div class="crate-records" id="crateRecords">
                                @foreach ($recentlyPlayed as $crateId)
                                    @continue(!isset($playlists[$crateId]))
                                    @php
                                        $cratePlaylist = $playlists[$crateId];
                                        $crateColor = nt_safe_css_color($cratePlaylist['color'] ?? '#d4a574');
                                        $crateName = $cratePlaylist['name'] ?? $crateId;
                                    @endphp
                                <div class="crate-record" data-crate-playlist="{{ $crateId }}" style="--r-color: {{ $crateColor }};" onclick="selectPlaylistFromCrate('{{ $crateId }}')" title="{{ $crateName }}"></div>
                                @endforeach
                            </div>
                        </div>
                        <div class="crate-label">VINYLS</div>
                    </div>
                    <div class="cat-silhouette">
                        <div class="cat-body"></div>
                        <div class="cat-head">
                            <div class="cat-ear left"></div>
                            <div class="cat-ear right"></div>
                        </div>
                        <div class="cat-tail"></div>
                    </div>
                </div>
            </div>
        </div>

        {{-- Phone Search tab: a page inside #music-section (under the Now
             Playing sheet, over the crate). Its own field and results, so the
             landscape search modal can't clear them. The desktop redesign
             shows it too, as its Search page (html.dv2.dv-search). --}}
        <section class="m-search-page m-only" id="mSearchPage" aria-label="Search">
            <header class="m-tab-head m-search-head">
                <h1 class="m-tab-title">Search</h1>
            </header>
            <div class="m-search-field" role="search">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.6"/><path d="m20 20-4.4-4.4"/></svg>
                <input type="search" id="mSearchInput" placeholder="Songs, artists or a link" autocomplete="off" enterkeyhint="search" aria-label="Search your library and YouTube">
                <button type="button" class="m-search-clear" id="mSearchClear" aria-label="Clear search" hidden>
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
                </button>
            </div>
            <div class="m-search-results" id="mSearchResults" tabindex="-1"></div>
            <div class="m-sr-only" id="mSearchStatus" role="status" aria-live="polite"></div>
        </section>

        {{-- Phone You page, opened from the Home avatar: who you are, your
             listening, the doors into Settings, log out. A layer over Home
             (script.js registers it for back), under the Now Playing sheet. --}}
        <section class="m-you-page m-only" id="mYouPage" aria-labelledby="mAccountName" tabindex="-1">
            <div class="m-you-bar">
                <button type="button" class="m-icon-btn" id="mYouBack" aria-label="Back to Home">
                    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14.5 5.5-6.5 6.5 6.5 6.5"/></svg>
                </button>
            </div>
            <header class="m-you-head">
                <span class="m-avatar m-avatar-xl" aria-hidden="true">{{ $acctInitial }}</span>
                <div class="m-you-id">
                    <h1 class="m-you-name"><b id="mAccountName">{{ $acctName !== '' ? $acctName : 'Your account' }}</b></h1>
                    <p class="m-you-sub" id="mYouSub"@if ($acctSub === '') hidden @endif>{{ $acctSub }}</p>
                    <p class="m-you-counts" id="mYouCounts"></p>
                </div>
            </header>
            <section class="m-you-card" aria-labelledby="mYouListenTitle">
                <div class="m-you-card-head">
                    <h2 class="m-you-h2" id="mYouListenTitle">Your listening</h2>
                    <button type="button" class="m-you-link" id="mYouSeeAll" hidden>See all</button>
                </div>
                <div class="m-you-listen" id="mYouListen"></div>
            </section>
            {{-- "Where's your music now?" any time (script.js opens it) --}}
            <h2 class="m-you-group">Your music</h2>
            <div class="m-you-list">
                <button type="button" class="m-you-row" id="mYouBring" aria-haspopup="dialog">
                    <span class="m-you-ic"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16"/></svg></span>
                    <span class="m-you-text"><b>Bring your music over</b><small>From Spotify, Apple Music, YouTube or files</small></span>
                    <svg class="m-you-chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9.5 5.5 6.5 6.5-6.5 6.5"/></svg>
                </button>
            </div>
            <h2 class="m-you-group">Settings</h2>
            <div class="m-you-list">
                <button type="button" class="m-you-row" data-m-you="playback">
                    <span class="m-you-ic"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg></span>
                    <span class="m-you-text"><b>Playback</b><small>Crossfade, lyrics, record crackle</small></span>
                    <svg class="m-you-chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9.5 5.5 6.5 6.5-6.5 6.5"/></svg>
                </button>
                <button type="button" class="m-you-row" data-m-you="appearance">
                    <span class="m-you-ic"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/></svg></span>
                    <span class="m-you-text"><b>Appearance</b><small>Room colors</small></span>
                    <svg class="m-you-chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9.5 5.5 6.5 6.5-6.5 6.5"/></svg>
                </button>
                <button type="button" class="m-you-row" data-m-you="account">
                    <span class="m-you-ic"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/></svg></span>
                    <span class="m-you-text"><b>Account</b><small>{{ $acctHasLogin ? 'Name and password' : 'Your name' }}{{ $spotifyOn ? ', Spotify' : '' }}</small></span>
                    <svg class="m-you-chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9.5 5.5 6.5 6.5-6.5 6.5"/></svg>
                </button>
            </div>
            {{-- Only in a browser tab (script.js shows them): the whole screen,
                 now or by installing the app --}}
            <div class="m-you-device" id="mYouDevice" hidden>
                <h2 class="m-you-group">This phone</h2>
                <div class="m-you-list">
                    <button type="button" class="m-you-row" id="mYouFullscreen" data-keeps-gesture hidden>
                        <span class="m-you-ic"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/></svg></span>
                        <span class="m-you-text"><b>Full screen</b><small>Hide the browser bars · back exits</small></span>
                    </button>
                    <button type="button" class="m-you-row m-you-subrow" id="mYouFsAuto" role="switch" aria-checked="false" data-keeps-gesture hidden>
                        <span class="m-you-text"><b>Open in full screen</b><small>Starts with your first tap</small></span>
                        <span class="m-you-switch" aria-hidden="true"></span>
                    </button>
                    <button type="button" class="m-you-row m-you-subrow" id="mYouFsButton" role="switch" aria-checked="false" data-keeps-gesture hidden>
                        <span class="m-you-text"><b>Button on Home</b><small>Full screen next to your avatar</small></span>
                        <span class="m-you-switch" aria-hidden="true"></span>
                    </button>
                    <button type="button" class="m-you-row" id="mYouInstall" hidden>
                        <span class="m-you-ic"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M12 7.5v6.5M9.2 11.4 12 14.2l2.8-2.8"/></svg></span>
                        <span class="m-you-text"><b>Install the app</b><small>Opens without the address bar</small></span>
                    </button>
                </div>
            </div>
            <form method="POST" action="{{ route('logout') }}" class="m-you-logout-form">
                @csrf
                <button type="submit" class="m-you-logout">Log out</button>
            </form>
        </section>

        <!-- Music Player View (hidden initially) -->
        <div class="music-player-view" id="musicPlayerView">
            <!-- Sidebar with song list -->
            <div class="music-sidebar" id="musicSidebar">
            <div class="sidebar-resize-handle" id="sidebarResizeHandle"></div>
            <button class="sidebar-collapse-btn" id="sidebarCollapseBtn" title="Collapse sidebar">&#8249;</button>

            {{-- Phone playlist screen: a compact top bar (portrait web shell only,
                 wired by the phone shell in script.js). The title slides in once
                 the big one scrolls away; Done ends reorder mode. --}}
            <div class="m-pl-bar m-only" id="mPlBar">
                <button type="button" class="m-icon-btn m-pl-back" id="mPlBack" aria-label="Back">
                    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14.5 5.5-6.5 6.5 6.5 6.5"/></svg>
                </button>
                <span class="m-pl-bar-title" id="mPlBarTitle" aria-hidden="true"></span>
                <button type="button" class="m-icon-btn m-pl-find" id="mPlFind" aria-label="Find in this playlist" aria-expanded="false">
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.6"/><path d="m20 20-4.4-4.4"/></svg>
                </button>
                <button type="button" class="m-icon-btn m-pl-more" id="mPlMore" aria-label="Playlist options" aria-haspopup="dialog">
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/></svg>
                </button>
                <button type="button" class="m-pl-done" id="mPlDone">Done</button>
            </div>

            <button class="back-to-crate" id="backToCrate" onclick="showPlaylistPicker()">
                <span class="back-arrow">&#8592;</span>
                <span class="back-text">Crate</span>
            </button>

            <div class="sidebar-header-area">
                {{-- Desktop (html.dv2) playlist page header: cover, name, count
                     (display:none everywhere else; script.js desktopPlaylist
                     fills it from #playlistTitle and the list on screen) --}}
                <div class="dv-pl-head" id="dvPlHead">
                    <div class="dv-pl-cover" id="dvPlCover" aria-hidden="true"></div>
                    <div class="dv-pl-info">
                        <p class="dv-pl-kicker">Playlist</p>
                        <h1 class="dv-pl-name" id="dvPlName">{{ $activePlaylist['name'] ?? 'My Records' }}</h1>
                        <p class="dv-pl-meta" id="dvPlMeta"></p>
                    </div>
                </div>
                <div class="sidebar-header-row">
                    <div class="music-sidebar-title" id="playlistTitle">{{ $activePlaylist['name'] ?? 'My Records' }}</div>
                    <button class="add-song-btn queue-btn" onclick="openQueueModal()" title="Up next queue">
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h11M4 12h11M4 18h7"/><path d="M17 15l4 3-4 3"/><path d="M21 18h-6"/></svg>
                        <span class="queue-count-badge" id="queueCountBadge" style="display:none">0</span>
                    </button>
                    <button class="add-song-btn settings-gear-btn" onclick="showSettingsModal()" title="Settings &amp; Spotify"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7.5h7M17.5 7.5H20M4 16.5h2.5M11.5 16.5H20"/><circle cx="14.5" cy="7.5" r="2.2"/><circle cx="8" cy="16.5" r="2.2"/></svg></button>
                        <button class="scan-songs-btn" onclick="showScanModal()" title="Scan for songs">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12">
                                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                            </svg>
                        </button>
                    <button class="scan-songs-btn offline-toggle-btn" id="offlineBtn" onclick="toggleOfflinePlaylist()" title="Save playlist for offline">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                    </button>
                    <button class="add-song-btn" onclick="showAddSongModal()" title="Add a song">+</button>
                </div>
                <div class="sidebar-track-count">{{ count($songs) }} {{ count($songs) === 1 ? 'song' : 'songs' }}</div>
                {{-- Desktop (html.dv2) only: plays the list on screen; one that's
                     only being shown becomes the playing one (script.js) --}}
                <button type="button" class="dv-pl-play" id="dvPlPlay">
                    <svg class="dv-pl-ic-play" viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M6.4 5.6a1.1 1.1 0 0 1 1.68-.94l9.6 6.4a1.1 1.1 0 0 1 0 1.88l-9.6 6.4a1.1 1.1 0 0 1-1.68-.94z"/></svg>
                    <svg class="dv-pl-ic-pause" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><rect x="6.6" y="5" width="3.6" height="14" rx="1.5"/><rect x="13.8" y="5" width="3.6" height="14" rx="1.5"/></svg>
                    <span class="dv-pl-play-label">Play</span>
                </button>
                {{-- Desktop (html.dv2) only, beside Play: shuffle (the global
                     mode), the playlist's ⋯ menu, and Done for reorder mode --}}
                <button type="button" class="dv-pl-tool" id="dvPlShuffle" aria-pressed="false" aria-label="Shuffle" title="Shuffle">
                    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 4h4v4"/><path d="M4 20 20 4"/><path d="M20 16v4h-4"/><path d="m15 15 5 5"/><path d="m4 4 5 5"/></svg>
                    <span class="dv-pl-dot" aria-hidden="true"></span>
                </button>
                <div class="dv-pl-more-wrap" id="dvPlMoreWrap">
                    <button type="button" class="dv-pl-tool" id="dvPlMore" aria-haspopup="menu" aria-expanded="false" aria-controls="dvPlMenu" aria-label="More options for this playlist" title="More options">
                        <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/></svg>
                    </button>
                    <div class="dv-pl-menu" id="dvPlMenu" role="menu" aria-label="Playlist options" hidden>
                        <button type="button" role="menuitem" data-dv-pl="add" aria-haspopup="dialog">Add songs</button>
                        <button type="button" role="menuitem" data-dv-pl="import" aria-haspopup="dialog">Import into this playlist</button>
                        <button type="button" role="menuitem" data-dv-pl="reorder">Reorder songs</button>
                        <button type="button" role="menuitem" data-dv-pl="edit" aria-haspopup="dialog">Edit details</button>
                        <button type="button" role="menuitem" data-dv-pl="share">Share</button>
                        <button type="button" role="menuitem" data-dv-pl="queue" aria-haspopup="dialog">Up next</button>
                        <button type="button" role="menuitem" data-dv-pl="offline">Save for offline</button>
                        <div class="dv-pl-menu-sep" role="separator"></div>
                        <button type="button" role="menuitem" data-dv-pl="delete" class="dv-pl-menu-danger">Delete playlist</button>
                    </div>
                </div>
                <button type="button" class="dv-pl-done" id="dvPlDone" hidden>Done</button>
                {{-- Phone-only hero actions + find-in-playlist (hidden by .m-only off-phone) --}}
                <div class="m-hero-actions m-only">
                    <button type="button" class="m-pl-add" id="mPlAdd">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
                        Add songs
                    </button>
                    <button type="button" id="mShuffleChip" aria-pressed="false">
                        <svg class="m-shuffle-ic" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 4h4v4"/><path d="M4 20 20 4"/><path d="M20 16v4h-4"/><path d="m15 15 5 5"/><path d="m4 4 5 5"/></svg>
                        <span class="m-shuffle-label">Shuffle</span>
                    </button>
                    <button type="button" id="mPlayAll">
                        <span class="m-when-paused"><svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M6.4 5.6a1.1 1.1 0 0 1 1.68-.94l9.6 6.4a1.1 1.1 0 0 1 0 1.88l-9.6 6.4a1.1 1.1 0 0 1-1.68-.94z"/></svg><span class="m-play-label">Play</span></span>
                        <span class="m-when-playing"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><rect x="6.6" y="5" width="3.6" height="14" rx="1.5"/><rect x="13.8" y="5" width="3.6" height="14" rx="1.5"/></svg><span class="m-play-label">Pause</span></span>
                    </button>
                </div>
                <input class="crate-filter" type="search" id="mFilterInput" placeholder="Find in these songs" autocomplete="off" aria-label="Find in these songs">
                <div class="m-filter-empty m-only" id="mFilterEmpty" role="status"></div>
            </div>
            {{-- Desktop (html.dv2) only: the song table's column labels --}}
            <div class="dv-pl-cols" id="dvPlCols" aria-hidden="true">
                <span class="dv-col-num">#</span>
                <span class="dv-col-title">Title</span>
                <span class="dv-col-album">Album</span>
                <span class="dv-col-dur"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg></span>
            </div>
            <ul class="song-list" id="songList">
                @if (count($songs) === 0)
                <li class="song-list-empty">
                    <div class="song-list-empty-icon">&#9834;</div>
                    <div class="song-list-empty-text">This playlist is empty</div>
                    <div class="song-list-empty-sub">Search for songs to add, or bring some over from Spotify or YouTube.</div>
                    <div class="song-list-empty-actions">
                        <button class="song-list-empty-add" onclick="showAddSongModal()">+ Add songs</button>
                        <button class="song-list-empty-import" onclick="showSpotifyImportModal({ into: 'current' })">Import</button>
                    </div>
                </li>
                @endif
                @foreach ($songs as $index => $song)
                <li class="song-list-item {{ $index === $currentIndex ? 'active' : '' }}"
                    data-index="{{ $index }}"
                    data-src="{{ !empty($song['mp3_url']) ? 'mp3' : (!empty($song['youtube_id']) ? 'yt' : 'spotify') }}"
                    onclick="switchSong({{ $index }})">
                    <div class="song-list-vinyl">
                        <div class="song-list-vinyl-groove"></div>
                        @if (!empty($song['cover']))
                        <img class="song-list-cover" src="{{ $song['cover'] }}" alt="">
                        @else
                        <div class="song-list-cover song-list-cover-empty">&#9834;</div>
                        @endif
                        <div class="song-list-vinyl-hole"></div>
                    </div>
                    <div class="song-list-info">
                        <div class="song-list-title">{{ $song['title'] }}</div>
                        <div class="song-list-artist">{{ $song['artist'] }}</div>
                        <div class="song-list-playing-indicator">
                            <span></span><span></span><span></span><span></span>
                        </div>
                    </div>
                    <span class="song-list-num">{{ str_pad($index + 1, 2, '0', STR_PAD_LEFT) }}</span>
                    <div class="song-actions">
                        <button class="song-send-btn" onclick="event.stopPropagation(); showSendMenu(this, {{ $index }})" title="Send to playlist">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13">
                                <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
                            </svg>
                        </button>
                        <button class="song-delete-btn" onclick="event.stopPropagation(); deleteSong({{ $index }})" title="Remove song">&times;</button>
                    </div>
                </li>
                @endforeach
            </ul>
        </div>

        <!-- Main record player area -->
        <div class="music-main">
            {{-- Phone-only Now Playing header: grab bar, collapse chevron,
                 "PLAYING FROM" context, song-options kebab --}}
            <div id="mNpHeader" class="m-only">
                <button type="button" id="mNpCollapse" aria-label="Close now playing"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9.5 6 6 6-6"/></svg></button>
                <div class="m-np-from">
                    <span class="m-np-from-label">Playing from</span>
                    <span id="mNpFromName"></span>
                </div>
                <button type="button" id="mNpKebab" aria-label="Song options"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg></button>
                <div class="m-grab"></div>
            </div>
            {{-- Desktop Now Playing header (html.dv2, the player view's deck
                 mode; display:none everywhere else): back, the page heading --}}
            <div id="dvNpHead">
                <button type="button" class="dv-np-back" id="dvNpBack" aria-label="Back" title="Back (Esc)"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14.5 6-6 6 6 6"/></svg></button>
                <h1 class="dv-np-heading" id="dvNpHeading" tabindex="-1">Now Playing</h1>
            </div>
            <div class="music-main-backdrop" id="musicBackdrop">
                @if (!empty($current['cover']))
                <img src="{{ $current['cover'] }}" alt="" id="backdropImg">
                @else
                <img src="" alt="" id="backdropImg" style="display:none;">
                @endif
            </div>
            <div class="player-eq-visualizer" id="playerEqVis">
                <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
                <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
                <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
                <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
                <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
                <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
                <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
                <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
                <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
                <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
                <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
                <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
                <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
                <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
                <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
            </div>
            <div class="aurora-orbs">
                <div class="aurora-orb aurora-orb-1"></div>
                <div class="aurora-orb aurora-orb-2"></div>
                <div class="aurora-orb aurora-orb-3"></div>
                <div class="aurora-orb aurora-orb-4"></div>
                <div class="aurora-orb aurora-orb-5"></div>
            </div>
            <div class="vinyl-groove-bg"></div>
            <div class="turntable-area">
            <!-- Vinyl Sleeve - Song Info -->
            <div class="vinyl-sleeve" id="vinylSleeve">
                <div class="sleeve-art">
                    @if (!empty($current['cover']))
                        <img src="{{ $current['cover'] }}" alt="Album Cover" id="sleeveArtImg">
                    @else
                        <img src="" alt="" id="sleeveArtImg" style="display:none;">
                        <div class="sleeve-art-placeholder" id="sleeveArtPlaceholder">&#9834;</div>
                    @endif
                </div>
                <div class="sleeve-lyrics-zone">
                    <div class="sleeve-lyrics" id="sleeveLyrics">
                        <div class="lyrics-placeholder">Play a song to see lyrics</div>
                    </div>
                    <div class="lyrics-controls" id="lyricsControls">
                        <button type="button" class="lyrics-ctrl-btn" id="lyricsOffsetMinus" title="Lyrics show later (fix lyrics that run ahead)">&minus;</button>
                        <button type="button" class="lyrics-ctrl-sync" id="lyricsOffsetValue" title="Sync offset for this song — click to reset">0s</button>
                        <button type="button" class="lyrics-ctrl-btn" id="lyricsOffsetPlus" title="Lyrics show sooner (fix lyrics that lag behind)">+</button>
                        <button type="button" class="lyrics-ctrl-btn lyrics-ctrl-toggle" id="lyricsToggleBtn" title="Lyrics on/off"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 17.4V6.2l8-1.7v11.2"/><circle cx="7.2" cy="17.4" r="2.3"/><circle cx="15.2" cy="15.7" r="2.3"/></svg></button>
                        <button type="button" class="lyrics-ctrl-btn m-only" id="mLyricsExpand" aria-label="Expand lyrics"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 14.5 6-6 6 6"/></svg></button>
                    </div>
                </div>
                {{-- Phone-only now-playing line (desktop shows this in the control bay) --}}
                <div class="sleeve-mobile-nowplaying" aria-hidden="true">
                    <span class="song-title">{{ $current['title'] ?? 'No song playing' }}</span>
                    <span class="song-artist">{{ $current['artist'] ?? '' }}</span>
                </div>
                <div class="sleeve-progress">
                    <div class="sleeve-progress-times">
                        <span id="sleeveTimeElapsed">0:00</span>
                        <span id="sleeveTimeTotal">0:00</span>
                    </div>
                    <div class="sleeve-progress-bar" id="sleeveProgressBar">
                        <div class="sleeve-progress-fill" id="sleeveProgressFill"></div>
                        <div class="sleeve-progress-knob" id="sleeveProgressKnob"></div>
                    </div>
                </div>
                <div class="sleeve-catalog">
                    <span class="sleeve-side">SIDE A</span>
                    <span class="sleeve-track-num" id="sleeveTrackNum">TRACK {{ str_pad($currentIndex + 1, 2, '0', STR_PAD_LEFT) }}</span>
                </div>
            </div>

            {{-- Phone-only flat transport + volume for the Now Playing sheet
                 (the desktop control bay is mouse-sized and hidden on phones) --}}
            <div id="mTransport" class="m-only">
                <button type="button" id="mShuffleBtn" aria-pressed="false" aria-label="Shuffle">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22">
                        <path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/>
                    </svg>
                </button>
                <button type="button" id="mPrevBtn" aria-label="Previous">
                    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><rect x="5" y="5.4" width="2.4" height="13.2" rx="1.1"/><path d="M18.6 6.3a1.1 1.1 0 0 0-1.7-.93l-8 5.7a1.1 1.1 0 0 0 0 1.86l8 5.7a1.1 1.1 0 0 0 1.7-.93z"/></svg>
                </button>
                <button type="button" id="mPlayBtn" aria-label="Play or pause">
                    <span class="m-ic-play"><svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true"><path d="M6.4 5.6a1.1 1.1 0 0 1 1.68-.94l9.6 6.4a1.1 1.1 0 0 1 0 1.88l-9.6 6.4a1.1 1.1 0 0 1-1.68-.94z"/></svg></span><span class="m-ic-pause"><svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true"><rect x="6.6" y="5" width="3.6" height="14" rx="1.5"/><rect x="13.8" y="5" width="3.6" height="14" rx="1.5"/></svg></span>
                </button>
                <button type="button" id="mNextBtn" aria-label="Next">
                    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M5.4 6.3a1.1 1.1 0 0 1 1.7-.93l8 5.7a1.1 1.1 0 0 1 0 1.86l-8 5.7a1.1 1.1 0 0 1-1.7-.93z"/><rect x="16.6" y="5.4" width="2.4" height="13.2" rx="1.1"/></svg>
                </button>
                <button type="button" id="mLoopBtn" data-mode="playlist" aria-pressed="true" aria-label="Loop mode">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22">
                        <path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>
                    </svg>
                    <span class="m-loop-one">1</span>
                </button>
            </div>
            {{-- Phone Now Playing: like, sleep timer, the queue, and the volume
                 slider on demand (portrait web shell; wired in script.js) --}}
            <div id="mNpTools" class="m-only" role="group" aria-label="More for this song">
                <button type="button" id="mNpLike" aria-pressed="false" aria-label="Add to Favorites">
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.07a5.5 5.5 0 1 0-7.78 7.78L12 21.23l8.8-8.85a5.5 5.5 0 0 0 0-7.78z"/></svg>
                </button>
                <button type="button" id="mNpSleep" aria-haspopup="dialog" aria-label="Sleep timer">
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 13.2A8.5 8.5 0 1 1 10.8 3.5a6.6 6.6 0 0 0 9.7 9.7z"/></svg>
                    <span class="m-np-tool-label" id="mNpSleepLabel"></span>
                </button>
                <button type="button" id="mNpQueue" aria-label="Up next">
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h11M4 12h11M4 18h7"/><path d="M17 15l4 3-4 3"/></svg>
                    <span class="m-np-tool-badge" id="mNpQueueCount" hidden>0</span>
                </button>
                <button type="button" id="mNpVolume" aria-expanded="false" aria-controls="mVolume" aria-label="Volume">
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>
                </button>
            </div>
            <div id="mVolume" class="m-only">
                <input type="range" id="mVolumeRange" min="0" max="100" value="100" aria-label="Volume">
            </div>

            <div class="record-player">
                <div class="record-player-body">
                    <div class="record-player-platter">
                        <div class="strobe-dots"></div>
                        <div class="record" id="vinyl">
                            <div class="record-label">
                                @if (!empty($current['cover']))
                                    <img src="{{ $current['cover'] }}" alt="Album Cover">
                                @else
                                    <div class="record-label-placeholder">&#9834;</div>
                                @endif
                            </div>
                            <div class="record-hole"></div>
                            <div class="rubber-mat"></div>
                        </div>
                    </div>
                    <div class="tonearm" id="tonearm"></div>
                    <div class="tonearm-base"></div>
                    <div class="tonearm-rest" onclick="restartSong()" title="Restart song"></div>
                    <div class="tonearm-counterweight"></div>
                    <div class="record-player-right">
                        <div class="rp-song-info song-info">
                            <div class="sleeve-now-playing">NOW PLAYING</div>
                            <div class="song-title">{{ $current['title'] ?? 'No song playing' }}</div>
                            <div class="song-artist">{{ $current['artist'] ?? '' }}</div>
                            <div class="song-album">{{ $current['album'] ?? '' }}</div>
                        </div>
                        <div class="record-player-controls">
                            <button class="rp-btn" onclick="prevSong()" title="Previous"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><rect x="5" y="5.4" width="2.4" height="13.2" rx="1.1"/><path d="M18.6 6.3a1.1 1.1 0 0 0-1.7-.93l-8 5.7a1.1 1.1 0 0 0 0 1.86l8 5.7a1.1 1.1 0 0 0 1.7-.93z"/></svg></button>
                            <button class="rp-btn rp-play" id="playBtn" onclick="toggleMusic()" aria-label="Play/Pause"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M6.4 5.6a1.1 1.1 0 0 1 1.68-.94l9.6 6.4a1.1 1.1 0 0 1 0 1.88l-9.6 6.4a1.1 1.1 0 0 1-1.68-.94z"/></svg></button>
                            <button class="rp-btn" onclick="nextSong()" title="Next"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M5.4 6.3a1.1 1.1 0 0 1 1.7-.93l8 5.7a1.1 1.1 0 0 1 0 1.86l-8 5.7a1.1 1.1 0 0 1-1.7-.93z"/><rect x="16.6" y="5.4" width="2.4" height="13.2" rx="1.1"/></svg></button>
                        </div>
                        <div class="pitch-slider" id="pitchSlider">
                            <div class="pitch-track" id="pitchTrack">
                                <div class="pitch-thumb" id="pitchThumb"></div>
                                <div class="pitch-detent"></div>
                            </div>
                            <div class="pitch-value" id="pitchValue">0%</div>
                            <div class="pitch-label">PITCH</div>
                        </div>
                        {{-- Desktop Now Playing: the turntable extras beside pitch
                             (html.dv2 only; the ⋯ menu is #dvNpMenu, in #dvBar) --}}
                        <div class="dv-np-extras" id="dvNpExtras" role="group" aria-label="Turntable extras">
                            <button type="button" class="dv-np-x" id="dvNpCrackle" aria-pressed="false" title="Vinyl crackle between songs">
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/></svg>
                                <span>Crackle</span>
                            </button>
                            <button type="button" class="dv-np-x dv-np-more" id="dvNpMore" aria-haspopup="menu" aria-expanded="false" aria-controls="dvNpMenu" aria-label="More" title="More">
                                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>
                            </button>
                        </div>
                        <div class="record-player-volume">
                            <div class="volume-knob-wrapper" id="volumeKnobWrapper" title="Drag to adjust volume">
                                <div class="volume-knob" id="volumeKnob">
                                    <div class="knob-indicator"></div>
                                </div>
                                <div class="knob-ring"></div>
                            </div>
                            <span class="volume-label" id="volumeLabel">100</span>
                        </div>
                    </div>
                    <div class="deck-foot deck-foot-tl"></div>
                    <div class="deck-foot deck-foot-tr"></div>
                    <div class="deck-foot deck-foot-bl"></div>
                    <div class="deck-foot deck-foot-br"></div>
                    <input type="range" class="volume-slider" id="volumeSlider" min="0" max="100" value="100" style="display:none;">
                    <div class="record-player-led" id="bigPlayerLed"></div>
                </div>
            </div>

            {{-- Desktop Now Playing: the song under the turntable (html.dv2
                 only). The .song-* spans ride setNowPlayingText's fan-out. --}}
            <div id="dvNpInfo">
                <h2 class="dv-np-song"><span class="song-title">{{ $current['title'] ?? '' }}</span></h2>
                <p class="dv-np-by"><span class="song-artist">{{ $current['artist'] ?? '' }}</span><span class="song-album">{{ $current['album'] ?? '' }}</span></p>
                <p class="dv-np-from">Playing from <span id="dvNpFromName"></span></p>
            </div>

            </div><!-- End turntable-area -->

            <!-- Hidden YouTube Player -->
            <div class="youtube-player-container" id="youtubeContainer">
                <div id="youtubePlayer"></div>
            </div>
        </div>
        </div><!-- End music-player-view -->
    </main>

    <!-- Mobile dock: persistent bottom transport (phones only; .m-only is
         display:none outside the mobile media query). The .song-title /
         .song-artist spans ride setNowPlayingText's querySelectorAll fan-out,
         so every track change updates the dock with no extra wiring. -->
    <div role="region" aria-label="Player">
        <div id="mDock" class="m-only" role="toolbar" aria-label="Playback">
            <div id="mDockProgress"></div>
            <button type="button" id="mDockInfo">
                <span id="mDockArtWrap">
                    @if (!empty($current['cover']))
                    <img id="mDockArt" src="{{ $current['cover'] }}" alt="">
                    @else
                    <img id="mDockArt" src="" alt="" style="display:none;">
                    @endif
                    <span class="m-dock-hole"></span>
                </span>
                <span class="m-dock-meta">
                    <span class="song-title">{{ $current['title'] ?? 'Nothing playing' }}</span>
                    <span class="song-artist">{{ $current['artist'] ?? '' }}</span>
                </span>
            </button>
            <button type="button" id="mDockPlay" aria-label="Play or pause">
                <span class="m-ic-play"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M6.4 5.6a1.1 1.1 0 0 1 1.68-.94l9.6 6.4a1.1 1.1 0 0 1 0 1.88l-9.6 6.4a1.1 1.1 0 0 1-1.68-.94z"/></svg></span><span class="m-ic-pause"><svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden="true"><rect x="6.6" y="5" width="3.6" height="14" rx="1.5"/><rect x="13.8" y="5" width="3.6" height="14" rx="1.5"/></svg></span>
            </button>
            <button type="button" id="mDockNext" aria-label="Next">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M5.4 6.3a1.1 1.1 0 0 1 1.7-.93l8 5.7a1.1 1.1 0 0 1 0 1.86l-8 5.7a1.1 1.1 0 0 1-1.7-.93z"/><rect x="16.6" y="5.4" width="2.4" height="13.2" rx="1.1"/></svg>
            </button>
        </div>
    </div>

    {{-- Desktop player bar: wider than 600px, outside the phone shells and
         the app (html.dv2; display:none everywhere else). Hidden like the
         phone dock while nothing is loaded (html.dv2-bar, script.js). The
         .song-title / .song-artist spans ride setNowPlayingText's fan-out. --}}
    <div id="dvBar" role="region" aria-label="Player">
        <div class="dv-bar-now">
            {{-- The cover and the title open Now Playing (desktop step 6); the
                 button is named by its text: "Open Now Playing: <title> <artist>" --}}
            <button type="button" class="dv-bar-open" id="dvBarOpen" title="Open Now Playing">
            <span class="dv-vh">Open Now Playing: </span>
            <span class="dv-bar-disc" aria-hidden="true">
                @if (!empty($current['cover']))
                <img id="dvBarArt" src="{{ $current['cover'] }}" alt="">
                @else
                <img id="dvBarArt" src="" alt="" style="display:none;">
                @endif
                <span class="dv-bar-hole"></span>
            </span>
            <span class="dv-bar-meta">
                <span class="song-title">{{ $current['title'] ?? 'Nothing playing' }}</span>
                <span class="song-artist">{{ $current['artist'] ?? '' }}</span>
            </span>
            </button>
            <button type="button" class="dv-bar-btn dv-bar-like" id="dvBarLike" aria-pressed="false" aria-label="Favorite">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.07a5.5 5.5 0 1 0-7.78 7.78L12 21.23l8.8-8.85a5.5 5.5 0 0 0 0-7.78z"/></svg>
            </button>
        </div>
        <div class="dv-bar-center">
            <div class="dv-bar-transport" role="toolbar" aria-label="Playback">
                <button type="button" class="dv-bar-btn dv-bar-mode" id="dvBarShuffle" data-mode="off" aria-pressed="false" aria-label="Shuffle">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></svg>
                    <span class="dv-bar-dot" aria-hidden="true"></span>
                </button>
                <button type="button" class="dv-bar-btn" id="dvBarPrev" aria-label="Previous">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><rect x="5" y="5.4" width="2.4" height="13.2" rx="1.1"/><path d="M18.6 6.3a1.1 1.1 0 0 0-1.7-.93l-8 5.7a1.1 1.1 0 0 0 0 1.86l8 5.7a1.1 1.1 0 0 0 1.7-.93z"/></svg>
                </button>
                <button type="button" class="dv-bar-play" id="dvBarPlay" aria-label="Play">
                    <span class="dv-ic-play"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M6.4 5.6a1.1 1.1 0 0 1 1.68-.94l9.6 6.4a1.1 1.1 0 0 1 0 1.88l-9.6 6.4a1.1 1.1 0 0 1-1.68-.94z"/></svg></span><span class="dv-ic-pause"><svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden="true"><rect x="6.6" y="5" width="3.6" height="14" rx="1.5"/><rect x="13.8" y="5" width="3.6" height="14" rx="1.5"/></svg></span>
                </button>
                <button type="button" class="dv-bar-btn" id="dvBarNext" aria-label="Next">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M5.4 6.3a1.1 1.1 0 0 1 1.7-.93l8 5.7a1.1 1.1 0 0 1 0 1.86l-8 5.7a1.1 1.1 0 0 1-1.7-.93z"/><rect x="16.6" y="5.4" width="2.4" height="13.2" rx="1.1"/></svg>
                </button>
                <button type="button" class="dv-bar-btn dv-bar-mode" id="dvBarLoop" data-mode="off" aria-pressed="false" aria-label="Repeat">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>
                    <span class="dv-bar-loop-one" aria-hidden="true">1</span>
                    <span class="dv-bar-dot" aria-hidden="true"></span>
                </button>
            </div>
            <div class="dv-bar-seek">
                <span class="dv-bar-time" id="dvBarElapsed">0:00</span>
                <div class="dv-bar-track" id="dvBarSeek" role="slider" tabindex="0" aria-label="Seek" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0" aria-valuetext="0:00 of 0:00">
                    <div class="dv-bar-rail"><div class="dv-bar-fill" id="dvBarFill"></div></div>
                    <div class="dv-bar-knob" id="dvBarKnob"></div>
                </div>
                <span class="dv-bar-time" id="dvBarTotal">0:00</span>
            </div>
        </div>
        <div class="dv-bar-extras" role="group" aria-label="More controls">
            <button type="button" class="dv-bar-btn" id="dvBarLyrics" aria-pressed="false" aria-label="Lyrics">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 17.4V6.2l8-1.7v11.2"/><circle cx="7.2" cy="17.4" r="2.3"/><circle cx="15.2" cy="15.7" r="2.3"/></svg>
            </button>
            <button type="button" class="dv-bar-btn" id="dvBarQueue" aria-pressed="false" aria-controls="dvPanel" aria-label="Up next">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h11M4 12h11M4 18h7"/><path d="M17 15l4 3-4 3"/></svg>
                <span class="dv-bar-badge" id="dvBarQueueCount" hidden>0</span>
            </button>
            <div class="dv-bar-sleep-wrap">
                <button type="button" class="dv-bar-btn" id="dvBarSleep" aria-haspopup="menu" aria-expanded="false" aria-controls="dvBarSleepMenu" aria-label="Sleep timer">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 13.2A8.5 8.5 0 1 1 10.8 3.5a6.6 6.6 0 0 0 9.7 9.7z"/></svg>
                    <span class="dv-bar-sleep-label" id="dvBarSleepLabel"></span>
                </button>
                <div class="dv-bar-menu" id="dvBarSleepMenu" role="menu" aria-label="Sleep timer" hidden>
                    <button type="button" role="menuitem" data-dv-sleep="15">15 minutes</button>
                    <button type="button" role="menuitem" data-dv-sleep="30">30 minutes</button>
                    <button type="button" role="menuitem" data-dv-sleep="45">45 minutes</button>
                    <button type="button" role="menuitem" data-dv-sleep="60">1 hour</button>
                    <button type="button" role="menuitem" data-dv-sleep="end">End of this song</button>
                    <button type="button" role="menuitem" data-dv-sleep="0" class="dv-bar-menu-off" id="dvBarSleepOff" hidden>Turn off</button>
                </div>
            </div>
            <div class="dv-bar-volume">
                <button type="button" class="dv-bar-btn" id="dvBarMute" aria-pressed="false" aria-label="Mute">
                    <svg class="dv-ic-vol" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>
                    <svg class="dv-ic-muted" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/></svg>
                </button>
                <input type="range" class="dv-bar-range" id="dvBarVolume" min="0" max="100" step="1" value="100" aria-label="Volume" aria-valuetext="100%">
            </div>
            <button type="button" class="dv-bar-btn" id="dvBarDeck" aria-pressed="false" aria-label="Turntable">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="4" width="19" height="16" rx="2.5"/><circle cx="10.5" cy="12" r="5"/><circle cx="10.5" cy="12" r="1.2" fill="currentColor"/><path d="M18.5 7v6.5l-2.5 2"/></svg>
            </button>
        </div>
        {{-- Now Playing's ⋯ menu (desktop step 6): a fixed popover kept in
             the Player region, so the turntable's clipped, scaled body can't
             cut it off (script.js places it under the deck's ⋯) --}}
        <div class="dv-np-menu" id="dvNpMenu" role="menu" aria-label="More for this song" hidden>
            <button type="button" role="menuitem" data-dv-np="gif">Make a GIF</button>
            <button type="button" role="menuitem" data-dv-np="show">Show in playlist</button>
        </div>
    </div>
    {{-- Desktop side panel (desktop step 8): Up next and Lyrics on the right
         of the page, above the bar (html.dv2 only; display:none everywhere
         else). The bar's queue and lyrics buttons open it on their tab.
         script.js (desktopPanel) moves #queueBody in here on the desktop
         and the sleeve's lyrics (.sleeve-lyrics-zone) while the Lyrics tab
         shows and Now Playing doesn't. --}}
    <aside id="dvPanel" aria-label="Up next and lyrics" data-tab="queue">
        <div class="dv-panel-box">
            <div class="dv-panel-head">
                <div class="dv-panel-tabs" role="tablist" aria-label="Side panel">
                    <button type="button" role="tab" class="dv-panel-tab" id="dvPanelTabQueue" aria-controls="dvPanelQueue" aria-selected="true">Up next</button>
                    <button type="button" role="tab" class="dv-panel-tab" id="dvPanelTabLyrics" aria-controls="dvPanelLyrics" aria-selected="false" tabindex="-1">Lyrics</button>
                </div>
                <button type="button" class="dv-panel-close" id="dvPanelClose" aria-label="Close side panel" title="Close">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
                </button>
            </div>
            <div class="dv-panel-body" id="dvPanelQueue" role="tabpanel" aria-labelledby="dvPanelTabQueue" tabindex="-1"></div>
            <div class="dv-panel-body" id="dvPanelLyrics" role="tabpanel" aria-labelledby="dvPanelTabLyrics" tabindex="-1" hidden>
                <p class="dv-panel-note" id="dvPanelLyricsNote" hidden>The lyrics are on the Now Playing page.</p>
            </div>
        </div>
    </aside>
    {{-- Show the bar from the first paint when the playing list has songs
         (script.js's dvSyncBarVisibility owns it from then on), and the side
         panel when it was left open on this device (desktopPanel) --}}
    <script>
        (function () {
            var root = document.documentElement;
            if (root.classList.contains('dv2') && {{ count($songs) > 0 ? 'true' : 'false' }}) root.classList.add('dv2-bar');
            try {
                var tab = localStorage.getItem('dvPanel');
                if (root.classList.contains('dv2') && (tab === 'queue' || tab === 'lyrics')) root.classList.add('dv-panel');
            } catch (e) {}
        })();
    </script>

    <!-- Phone tab bar (portrait phones; wired in script.js's phone shell,
         hidden in the app and during Now Playing / typing) -->
    <nav id="mTabs" class="m-only" aria-label="Main">
        <button type="button" class="m-tab" data-tab="home">
            <span class="m-tab-ic"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path class="m-tab-fill" d="M4 10.2 12 4l8 6.2V19a1 1 0 0 1-1 1h-4.6v-5.6H9.6V20H5a1 1 0 0 1-1-1z"/></svg></span>
            <span class="m-tab-label">Home</span>
        </button>
        <button type="button" class="m-tab" data-tab="search">
            <span class="m-tab-ic"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.6"/><path d="m20 20-4.4-4.4"/></svg></span>
            <span class="m-tab-label">Search</span>
        </button>
        <button type="button" class="m-tab" data-tab="library">
            <span class="m-tab-ic"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><circle cx="14.6" cy="12" r="7.4"/><circle cx="14.6" cy="12" r="2.5"/><rect class="m-tab-sleeve" x="2.6" y="4.6" width="9.4" height="14.8" rx="1.8"/></svg></span>
            <span class="m-tab-label">Library</span>
        </button>
    </nav>

    <!-- Add Song Modal -->
    <div class="add-song-modal m-menu-sheet" id="addSongModal" role="dialog" aria-modal="true" aria-labelledby="addSongModalTitle">
        <div class="add-song-modal-backdrop" onclick="hideAddSongModal()"></div>
        <div class="add-song-modal-panel">
            <button type="button" class="add-song-modal-close" onclick="hideAddSongModal()" aria-label="Close">&times;</button>
            <div class="add-song-modal-header">
                <div class="add-song-modal-icon">&#9834;</div>
                <h2 class="add-song-modal-title" id="addSongModalTitle">Add songs</h2>
            </div>
            {{-- Phone: where the songs go. Starts on the open playlist; the
                 picker (script.js) can send them anywhere without opening it. --}}
            <div class="m-add-to m-only" id="mAddTo">
                <span class="m-add-to-label" id="mAddToLabel">To</span>
                <button type="button" class="m-add-to-btn" id="mAddToBtn" aria-haspopup="dialog" aria-describedby="mAddToLabel">
                    <span class="m-add-to-name" id="mAddToName">Favorites</span>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6.5 9.5 5.5 5.5 5.5-5.5"/></svg>
                </button>
            </div>
            <div class="wizard-step-chip" id="addSongWizardStep" style="display:none">Step 3 of 3 &middot; Your first song</div>
            <p class="playlist-wizard-hint" id="addSongWizardHint" style="display:none">
                What do you love? Search it, tap it, and the needle drops.
            </p>
            <div class="add-song-form-group">
                <label for="addSongSearch">Search</label>
                <input type="text" id="addSongSearch" placeholder="Search songs or paste a link" autocomplete="off" oninput="onAddSearchInput()" onkeydown="onAddSearchKeydown(event)">
            </div>
            <div class="add-song-search-results" id="addSongSearchResults"></div>
            <div class="m-sr-only" id="mAddStatus" role="status" aria-live="polite"></div>
            {{-- Bulk import: paste a whole list or a Spotify playlist link
                 instead of searching one song at a time. --}}
            <button type="button" class="bulk-import-btn" onclick="hideAddSongModal(); showSpotifyImportModal();">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
                    <path d="M4 6h16M4 12h16M4 18h10"/><path d="M17 15l3 3-3 3" transform="translate(0 -3)"/>
                </svg>
                <span>Import many at once &mdash; paste a list or Spotify link</span>
            </button>
            {{-- Phone (web): the other ways in, shown while the search field
                 is empty (wired in script.js). --}}
            <div class="m-add-rows m-only" id="mAddRows">
                <button type="button" class="m-sheet-row" data-m-addsong="import">
                    <span class="m-sheet-ic"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16"/></svg></span>
                    <span class="m-sheet-text"><b>Import a playlist</b><small>{{ $spotifyOn ? 'YouTube, Spotify or a pasted list' : 'A YouTube link or a pasted list' }}</small></span>
                </button>
                <button type="button" class="m-sheet-row" data-m-addsong="files">
                    <span class="m-sheet-ic"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg></span>
                    <span class="m-sheet-text"><b>From files on this phone</b><small>MP3s and other audio files</small></span>
                </button>
                @if ($geminiOn)
                <button type="button" class="m-sheet-row" data-m-addsong="snap">
                    <span class="m-sheet-ic"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.5"/></svg></span>
                    <span class="m-sheet-text"><b>Snap a record cover</b><small>Finds the songs on the album</small></span>
                </button>
                @endif
            </div>
            {{-- The app shell's phone: a direct path to the hidden multi-file
                 input (the web phone uses "From files on this phone"). --}}
            <button type="button" id="mUploadBtn" class="m-only upload-audio-btn" onclick="document.getElementById('addSongFile').click()">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                <span>Upload audio files from this phone</span>
            </button>
            <details class="add-song-manual" id="addSongManualDetails">
                <summary>Enter details manually</summary>
            <form id="addSongForm" onsubmit="addSongToPlaylist(event)">
                <div class="add-song-form-group">
                    <label for="addSongYoutube" id="addSongSourceLabel">YouTube URL or ID</label>
                    <input type="text" id="addSongYoutube" placeholder="https://youtube.com/watch?v=... or video ID" required>
                </div>
                <div class="add-song-form-group" id="addSongUploadGroup" style="display:none">
                    <button type="button" class="upload-audio-btn" onclick="document.getElementById('addSongFile').click()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="17 8 12 3 7 8"/>
                            <line x1="12" y1="3" x2="12" y2="15"/>
                        </svg>
                        <span>Or upload audio files</span>
                    </button>
                    <p class="upload-hint">Pick several to import them all — or just drop files anywhere on the page.</p>
                    <input type="file" id="addSongFile" multiple accept="audio/*,.mp3,.m4a,.ogg,.opus,.wav,.flac" style="display:none" onchange="handleAudioUpload(this.files)">
                    <div class="upload-progress" id="uploadProgress" style="display:none">
                        <div class="upload-progress-fill" id="uploadProgressFill"></div>
                    </div>
                    <div class="upload-status" id="uploadStatus"></div>
                </div>
                <div class="add-song-form-group">
                    <label for="addSongTitle">Title</label>
                    <input type="text" id="addSongTitle" placeholder="Song title" required>
                </div>
                <div class="add-song-form-group">
                    <label for="addSongArtist">Artist</label>
                    <input type="text" id="addSongArtist" placeholder="Artist name">
                </div>
                <div class="add-song-form-group">
                    <label for="addSongAlbum">Album</label>
                    <input type="text" id="addSongAlbum" placeholder="Album name">
                </div>
                <div class="add-song-form-group">
                    <label for="addSongCover">Cover URL</label>
                    <input type="text" id="addSongCover" placeholder="https://... (optional)">
                </div>
                <div class="add-song-modal-buttons">
                    <button type="submit" class="add-song-btn-save">Add to Playlist</button>
                </div>
            </form>
            </details>
        </div>
    </div>

    <!-- Playlist Edit Modal -->
    <div class="add-song-modal" id="playlistEditModal" role="dialog" aria-modal="true" aria-labelledby="playlistEditModalTitle">
        <div class="add-song-modal-backdrop" onclick="hidePlaylistEditModal()"></div>
        <div class="add-song-modal-panel">
            <button type="button" class="add-song-modal-close" onclick="hidePlaylistEditModal()" aria-label="Close">&times;</button>
            <div class="add-song-modal-header">
                <div class="add-song-modal-icon">&#127912;</div>
                <h2 class="add-song-modal-title" id="playlistEditModalTitle">Edit Playlist</h2>
            </div>
            <input type="hidden" id="playlistEditId" value="">
            <div class="wizard-step-chip" id="playlistWizardStep" style="display:none">Step 2 of 3 &middot; Your first playlist</div>
            <p class="playlist-wizard-hint" id="playlistWizardHint" style="display:none">
                Every collection starts with one playlist — name yours and pick
                a sleeve color. You can add more from the crate anytime.
            </p>
            <div class="add-song-form-group">
                <label for="playlistEditName">Playlist Name</label>
                <input type="text" id="playlistEditName" placeholder="Playlist name" maxlength="30">
            </div>
            <div class="add-song-form-group">
                <label>Color</label>
                <div class="color-swatch-grid" id="colorSwatchGrid">
                    <div class="color-swatch" data-color="#d4a574" style="background:#d4a574" onclick="selectPlaylistColor(this)"></div>
                    <div class="color-swatch" data-color="#e85d75" style="background:#e85d75" onclick="selectPlaylistColor(this)"></div>
                    <div class="color-swatch" data-color="#7eb8da" style="background:#7eb8da" onclick="selectPlaylistColor(this)"></div>
                    <div class="color-swatch" data-color="#9b7ed9" style="background:#9b7ed9" onclick="selectPlaylistColor(this)"></div>
                    <div class="color-swatch" data-color="#5cba5c" style="background:#5cba5c" onclick="selectPlaylistColor(this)"></div>
                    <div class="color-swatch" data-color="#e8a838" style="background:#e8a838" onclick="selectPlaylistColor(this)"></div>
                    <div class="color-swatch" data-color="#e86d5e" style="background:#e86d5e" onclick="selectPlaylistColor(this)"></div>
                    <div class="color-swatch" data-color="#d474b4" style="background:#d474b4" onclick="selectPlaylistColor(this)"></div>
                    <div class="color-swatch" data-color="#5bbfbf" style="background:#5bbfbf" onclick="selectPlaylistColor(this)"></div>
                    <div class="color-swatch" data-color="#8b9dc3" style="background:#8b9dc3" onclick="selectPlaylistColor(this)"></div>
                </div>
            </div>
            <div class="add-song-form-group" id="coverArtGroup">
                <label>Cover Art</label>
                <div class="cover-picker-grid" id="coverPickerGrid"></div>
            </div>
            <div class="add-song-form-group" id="shareGroup">
                <label>Share</label>
                <button type="button" class="share-create-btn" id="shareCreateBtn" onclick="sharePlaylist()">Create a share link</button>
                <div class="share-link-row" id="shareLinkRow" style="display:none">
                    <input type="text" id="shareLinkInput" readonly onclick="this.select()">
                    <button type="button" class="share-copy-btn" onclick="copyShareLink()">Copy</button>
                    <button type="button" class="share-stop-btn" onclick="stopSharing()" title="Stop sharing">Stop</button>
                </div>
                <p class="settings-hint">Anyone with the link can view this playlist and add a copy to their own library. Your uploaded files are never shared.</p>
            </div>
            <div class="add-song-modal-buttons">
                <button type="button" class="playlist-delete-btn" id="playlistDeleteBtn" onclick="deleteCurrentPlaylist()">Delete</button>
                <button type="button" class="add-song-btn-cancel" onclick="hidePlaylistEditModal()">Cancel</button>
                <button type="button" class="add-song-btn-save" id="playlistEditSaveBtn" onclick="savePlaylistEdit()">Save Changes</button>
            </div>
        </div>
    </div>

    @if (session('member_card'))
    <!-- Member Welcome: the one page-load right after instant signup. The
         PIN is only ever visible here, so there's no backdrop-dismiss — the
         wizard chains into the first-run playlist wizard from its button. -->
    <div class="add-song-modal" id="memberWelcomeModal">
        <div class="add-song-modal-backdrop"></div>
        <div class="add-song-modal-panel">
            <div class="add-song-modal-header">
                <div class="add-song-modal-icon">&#127911;</div>
                <h2 class="add-song-modal-title">Welcome to the club</h2>
            </div>
            <div class="wizard-step-chip">Step 1 of 3 &middot; Your member card</div>
            <div class="member-card">
                <div class="member-card-label">Music Player &middot; Member card</div>
                <div class="member-card-number" id="memberCardNumber">{{ session('member_card')['number'] }}</div>
                <div class="member-card-pin">PIN <span id="memberCardPin">{{ session('member_card')['pin'] }}</span></div>
                <button type="button" class="member-card-copy" onclick="copyMemberCard(this)">Copy card details</button>
            </div>
            <ul class="member-card-notes">
                <li>Your number and PIN get you back in. They're what the login page asks for.</li>
                <li>The PIN is shown only this once, so save it somewhere safe.</li>
                <li>You can attach an email later in Settings.</li>
            </ul>
            <div class="add-song-form-group">
                <label for="memberWelcomeName">What should we call you?</label>
                <input type="text" id="memberWelcomeName" maxlength="100" placeholder="Your name" autocomplete="name">
            </div>
            <div class="add-song-modal-buttons">
                <button type="button" class="add-song-btn-save" id="memberWelcomeContinue" onclick="finishMemberWelcome()">Continue &rarr;</button>
            </div>
        </div>
    </div>
    @endif

    <!-- Song Scanner Modal (reuses .add-song-modal shell; scan-specific inner steps) -->
    <div class="add-song-modal scan-modal" id="scanModal">
        <div class="add-song-modal-backdrop" onclick="hideScanModal()"></div>
        <div class="add-song-modal-panel">
            <button class="add-song-modal-close" onclick="hideScanModal()">&times;</button>
            <div class="add-song-modal-header">
                <div class="add-song-modal-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22">
                        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                    </svg>
                </div>
                <h2 class="add-song-modal-title">Song Scanner</h2>
            </div>

            <!-- Step 1: Folder Picker -->
            <div class="scan-step" id="scanStep1">
                <p class="scan-step-desc">Select a folder with album cover images or audio files to identify and add songs.</p>
                <button class="scan-folder-btn" onclick="document.getElementById('scanFolderInput').click()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                    </svg>
                    <span>Choose Folder</span>
                </button>
                <input type="file" id="scanFolderInput" webkitdirectory multiple style="display:none" onchange="handleScanFiles(this.files)">
                <div class="scan-or-divider">or drop files</div>
                <button class="scan-files-btn" onclick="document.getElementById('scanFilesInput').click()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="18" height="18">
                        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" stroke="currentColor"/><polyline points="13 2 13 9 20 9" stroke="currentColor"/>
                    </svg>
                    <span>Select Files</span>
                </button>
                <input type="file" id="scanFilesInput" multiple accept="image/*,audio/*" style="display:none" onchange="handleScanFiles(this.files)">
                <div class="scan-or-divider">or snap a cover</div>
                <div class="scan-capture-row">
                    <button class="scan-capture-btn" onclick="document.getElementById('scanCameraInput').click()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
                            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                            <circle cx="12" cy="13" r="4"/>
                        </svg>
                        <span>Camera</span>
                    </button>
                    <button class="scan-capture-btn" onclick="document.getElementById('scanGalleryInput').click()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                            <circle cx="8.5" cy="8.5" r="1.5"/>
                            <polyline points="21 15 16 10 5 21"/>
                        </svg>
                        <span>Gallery</span>
                    </button>
                </div>
                <input type="file" id="scanCameraInput" accept="image/*" capture="environment" style="display:none" onchange="handleScanFiles(this.files)">
                <input type="file" id="scanGalleryInput" accept="image/*" multiple style="display:none" onchange="handleScanFiles(this.files)">
            </div>

            <!-- Step 2: Progress -->
            <div class="scan-step" id="scanStep2" style="display:none">
                <div class="scan-progress-label" id="scanProgressLabel">Scanning files...</div>
                <div class="scan-progress-bar">
                    <div class="scan-progress-fill" id="scanProgressFill"></div>
                </div>
                <div class="scan-progress-detail" id="scanProgressDetail"></div>
            </div>

            <!-- Step 3: Results -->
            <div class="scan-step" id="scanStep3" style="display:none">
                <div class="scan-results-header">
                    <span class="scan-results-count" id="scanResultsCount">0 songs found</span>
                    <label class="scan-select-all">
                        <input type="checkbox" id="scanSelectAll" checked onchange="toggleScanSelectAll(this.checked)">
                        Select all
                    </label>
                </div>
                <div class="scan-results-list" id="scanResultsList"></div>
                <div class="add-song-modal-buttons">
                    <button type="button" class="add-song-btn-cancel" onclick="resetScanModal()">Scan Again</button>
                    <button type="button" class="add-song-btn-save" id="scanAddBtn" onclick="scanAddSelected()">Add Selected</button>
                </div>
            </div>
        </div>
    </div>
    {{-- Phone: the playlist screen's ⋯ (everything about the playlist on
         screen, which is always the active one). Opened and registered for
         back by the phone shell in script.js; rows it can't use are hidden. --}}
    <div class="add-song-modal m-menu-sheet" id="mPlaylistSheet" role="dialog" aria-modal="true" aria-labelledby="mPlaylistSheetTitle">
        <div class="add-song-modal-backdrop" data-m-pl-close></div>
        <div class="add-song-modal-panel">
            <button type="button" class="add-song-modal-close" data-m-pl-close aria-label="Close">&times;</button>
            <h2 class="m-sheet-title" id="mPlaylistSheetTitle">Playlist</h2>
            <button type="button" class="m-sheet-row m-sheet-compact" data-m-pl="add">
                <span class="m-sheet-ic"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></span>
                <span class="m-sheet-text"><b>Add songs</b></span>
            </button>
            <button type="button" class="m-sheet-row m-sheet-compact" data-m-pl="import">
                <span class="m-sheet-ic"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16"/></svg></span>
                <span class="m-sheet-text"><b>Import into this playlist</b><small id="mPlSheetImportSub">{{ $spotifyOn ? 'From a Spotify or YouTube link, or a list' : 'From a YouTube link, or a list' }}</small></span>
            </button>
            <button type="button" class="m-sheet-row m-sheet-compact" data-m-pl="reorder">
                <span class="m-sheet-ic"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4v16"/><path d="m4 7 3-3 3 3"/><path d="M17 20V4"/><path d="m14 17 3 3 3-3"/></svg></span>
                <span class="m-sheet-text"><b>Reorder songs</b></span>
            </button>
            <button type="button" class="m-sheet-row m-sheet-compact" data-m-pl="edit">
                <span class="m-sheet-ic"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></span>
                <span class="m-sheet-text"><b>Edit details</b><small id="mPlSheetEditSub">Name, colour and cover</small></span>
            </button>
            <button type="button" class="m-sheet-row m-sheet-compact" data-m-pl="share" data-keeps-gesture>
                <span class="m-sheet-ic"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7.5 7.5 4.5-4.5 4.5 4.5"/><path d="M5 12v7.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V12"/></svg></span>
                <span class="m-sheet-text"><b>Share</b><small id="mPlSheetShareSub">A link anyone can open</small></span>
            </button>
            <button type="button" class="m-sheet-row m-sheet-compact" data-m-pl="queue">
                <span class="m-sheet-ic"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h11M4 12h11M4 18h7"/><path d="M17 15l4 3-4 3"/></svg></span>
                <span class="m-sheet-text"><b>Up next</b><small id="mPlSheetQueueSub">Nothing queued</small></span>
            </button>
            <button type="button" class="m-sheet-row m-sheet-compact" data-m-pl="offline">
                <span class="m-sheet-ic"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v8"/><path d="m8.5 12 3.5 3.5 3.5-3.5"/></svg></span>
                <span class="m-sheet-text"><b>Save for offline</b><small id="mPlSheetOfflineSub">Keep the uploaded songs on this phone</small></span>
            </button>
            <button type="button" class="m-sheet-row m-sheet-compact m-sheet-danger" data-m-pl="delete">
                <span class="m-sheet-ic"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l1 13h9l1-13"/></svg></span>
                <span class="m-sheet-text"><b>Delete playlist</b></span>
            </button>
        </div>
    </div>
    {{-- Phone Search: add a song found on YouTube to one of your playlists.
         Rows are filled by script.js when it opens. --}}
    <div class="add-song-modal m-menu-sheet" id="mAddToSheet" role="dialog" aria-modal="true" aria-labelledby="mAddToTitle">
        <div class="add-song-modal-backdrop" data-m-addto-close></div>
        <div class="add-song-modal-panel">
            <button type="button" class="add-song-modal-close" data-m-addto-close aria-label="Close">&times;</button>
            <h2 class="m-sheet-title" id="mAddToTitle">Add to playlist</h2>
            <p class="m-sleep-status m-addto-song"></p>
            <div class="m-addto-list"></div>
        </div>
    </div>
    {{-- Phone: Now Playing's sleep timer (the same timer as desktop's coaster
         and Settings). Opened and registered for back by script.js. --}}
    {{-- Phone: how to install the app when the browser offers no prompt.
         Opened and registered for back by the phone shell in script.js. --}}
    <div class="add-song-modal m-menu-sheet" id="mInstallSheet" role="dialog" aria-modal="true" aria-labelledby="mInstallSheetTitle">
        <div class="add-song-modal-backdrop" data-m-install-close></div>
        <div class="add-song-modal-panel">
            <button type="button" class="add-song-modal-close" data-m-install-close aria-label="Close">&times;</button>
            <h2 class="m-sheet-title" id="mInstallSheetTitle">Install the app</h2>
            <p class="m-sleep-status">Installed, it opens from its own icon without the browser's address bar and toolbar.</p>
            <ol class="m-install-steps" id="mInstallSteps">
                <li>Open the browser menu <b>⋮</b>.</li>
                <li>Tap <b>Install app</b>, or <b>Add to Home screen</b> and then <b>Install</b>.</li>
                <li>Open Music from the new icon. You can remove the old one.</li>
            </ol>
            <ol class="m-install-steps" id="mInstallStepsIos" hidden>
                <li>In <b>Safari</b>, tap <b>⋯</b> (or <b>Share</b>) next to the address bar, then <b>Share</b>.</li>
                <li>Scroll to <b>Add to Home Screen</b>, keep <b>Open as Web App</b> on, and tap <b>Add</b>.</li>
                <li>Open Music from the new icon.</li>
            </ol>
        </div>
    </div>
    <div class="add-song-modal m-menu-sheet" id="mSleepSheet" role="dialog" aria-modal="true" aria-labelledby="mSleepSheetTitle">
        <div class="add-song-modal-backdrop" data-m-sleep-close></div>
        <div class="add-song-modal-panel">
            <button type="button" class="add-song-modal-close" data-m-sleep-close aria-label="Close">&times;</button>
            <h2 class="m-sheet-title" id="mSleepSheetTitle">Sleep timer</h2>
            <p class="m-sleep-status" id="mSleepStatus">Fades the music out and pauses.</p>
            <button type="button" class="m-sheet-row m-sheet-compact m-sleep-opt" data-m-sleep="15"><span class="m-sheet-text"><b>15 minutes</b></span></button>
            <button type="button" class="m-sheet-row m-sheet-compact m-sleep-opt" data-m-sleep="30"><span class="m-sheet-text"><b>30 minutes</b></span></button>
            <button type="button" class="m-sheet-row m-sheet-compact m-sleep-opt" data-m-sleep="45"><span class="m-sheet-text"><b>45 minutes</b></span></button>
            <button type="button" class="m-sheet-row m-sheet-compact m-sleep-opt" data-m-sleep="60"><span class="m-sheet-text"><b>1 hour</b></span></button>
            <button type="button" class="m-sheet-row m-sheet-compact m-sleep-opt" data-m-sleep="end"><span class="m-sheet-text"><b>End of this song</b></span></button>
            <button type="button" class="m-sheet-row m-sheet-compact m-sleep-opt" data-m-sleep="0" id="mSleepOff"><span class="m-sheet-text"><b>Turn off</b></span></button>
        </div>
    </div>
    {{-- Phone: the Library "+" (a new playlist, or bring one over). Opened
         and registered for back by the phone shell in script.js. --}}
    <div class="add-song-modal m-menu-sheet" id="mAddSheet" role="dialog" aria-modal="true" aria-labelledby="mAddSheetTitle">
        <div class="add-song-modal-backdrop" data-m-add-close></div>
        <div class="add-song-modal-panel">
            <button type="button" class="add-song-modal-close" data-m-add-close aria-label="Close">&times;</button>
            <h2 class="m-sheet-title" id="mAddSheetTitle">Add to your library</h2>
            <button type="button" class="m-sheet-row" data-m-add="playlist">
                <span class="m-sheet-ic"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 6h11M4 12h11M4 18h7"/><path d="M18 14v6M15 17h6"/></svg></span>
                <span class="m-sheet-text"><b>New playlist</b><small>Start one and fill it up</small></span>
            </button>
            <button type="button" class="m-sheet-row" data-m-add="songs">
                <span class="m-sheet-ic"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg></span>
                <span class="m-sheet-text"><b>Add songs</b><small>Search, a link, or files on this phone</small></span>
            </button>
            <button type="button" class="m-sheet-row" data-m-add="import">
                <span class="m-sheet-ic"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16"/></svg></span>
                <span class="m-sheet-text"><b>Import a playlist</b><small>{{ $spotifyOn ? 'Spotify, YouTube or a pasted list' : 'A YouTube link or a pasted list' }}</small></span>
            </button>
            <button type="button" class="m-sheet-row" data-m-add="bring" aria-haspopup="dialog">
                <span class="m-sheet-ic"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7h11l-3-3M17 17H6l3 3"/></svg></span>
                <span class="m-sheet-text"><b>Bring your music over</b><small>From Spotify, Apple Music, YouTube or files</small></span>
            </button>
        </div>
    </div>
    {{-- "Where's your music now?": the ways to bring a library over from
         another app, each straight into the import path that fits it (the
         rows that need a few steps first open them here). Opens on a
         brand-new account's first load, before the first-playlist wizard
         (Start fresh leads on to it); any time from the empty Home card, the
         phone's You page and Library +, and the desktop crate's sleeve tile.
         showBringMusicModal() in script.js; the phone shell registers it
         for back. --}}
    <div class="add-song-modal m-menu-sheet bring-modal" id="bringMusicModal" role="dialog" aria-modal="true" aria-labelledby="bringMusicTitle">
        <div class="add-song-modal-backdrop" data-bring-close></div>
        <div class="add-song-modal-panel">
            <button type="button" class="add-song-modal-close" data-bring-close aria-label="Close">&times;</button>
            <h2 class="m-sheet-title" id="bringMusicTitle">Where&rsquo;s your music now?</h2>
            <div class="bring-pane" id="bringMusicList">
                <p class="bring-lede">Bring it over in a few steps, or start fresh.</p>
                <button type="button" class="m-sheet-row" data-bring="spotify">
                    <span class="m-sheet-ic"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M7.5 9.5c3-1 6.5-.7 9 .8M8 12.6c2.5-.7 5.2-.4 7.3.8M8.6 15.5c1.9-.5 3.8-.3 5.4.6"/></svg></span>
                    <span class="m-sheet-text"><b>Spotify</b><small>{{ $spotifyOn ? 'Paste a playlist link' : 'Copy it to YouTube Music first, then paste the link' }}</small></span>
                </button>
                <button type="button" class="m-sheet-row" data-bring="apple">
                    <span class="m-sheet-ic"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg></span>
                    <span class="m-sheet-text"><b>Apple Music</b><small>Through YouTube Music, or paste a list on a Mac</small></span>
                </button>
                <button type="button" class="m-sheet-row" data-bring="youtube">
                    <span class="m-sheet-ic"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="3.5"/><path d="M10.5 9.5v5l4.2-2.5z" fill="currentColor"/></svg></span>
                    <span class="m-sheet-text"><b>YouTube Music or YouTube</b><small>Paste a playlist link. It must be Public or Unlisted.</small></span>
                </button>
                <button type="button" class="m-sheet-row" data-bring="files">
                    <span class="m-sheet-ic"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg></span>
                    <span class="m-sheet-text"><b>Files on this device</b><small>MP3s and other audio files, several at once</small></span>
                </button>
                <button type="button" class="m-sheet-row" data-bring="fresh">
                    <span class="m-sheet-ic"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.6"/><path d="m20 20-4.4-4.4"/></svg></span>
                    <span class="m-sheet-text"><b>Start fresh</b><small>Search for songs and add them</small></span>
                </button>
            </div>
            <div class="bring-pane" id="bringStepSpotify" hidden>
                <button type="button" class="bring-back" data-bring-back>
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14.5 5.5-6.5 6.5 6.5 6.5"/></svg>
                    All the ways
                </button>
                <h3 class="bring-step-title" tabindex="-1">From Spotify</h3>
                <ol class="bring-steps">
                    <li>Copy the playlist to YouTube Music with a free converter: <a href="https://www.tunemymusic.com/" target="_blank" rel="noopener noreferrer">TuneMyMusic</a> or <a href="https://soundiiz.com/" target="_blank" rel="noopener noreferrer">Soundiiz</a>.</li>
                    <li>In YouTube Music, set the playlist to <b>Public</b> or <b>Unlisted</b>.</li>
                    <li>Copy its link and paste it here.</li>
                </ol>
                <button type="button" class="bring-go" data-bring="youtube">Paste the YouTube Music link</button>
            </div>
            <div class="bring-pane" id="bringStepApple" hidden>
                <button type="button" class="bring-back" data-bring-back>
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14.5 5.5-6.5 6.5 6.5 6.5"/></svg>
                    All the ways
                </button>
                <h3 class="bring-step-title" tabindex="-1">From Apple Music</h3>
                <p class="bring-how"><b>Any device:</b> copy the playlist to YouTube Music with <a href="https://www.tunemymusic.com/" target="_blank" rel="noopener noreferrer">TuneMyMusic</a> or <a href="https://soundiiz.com/" target="_blank" rel="noopener noreferrer">Soundiiz</a> (free), set it to <b>Public</b> or <b>Unlisted</b>, then paste its link.</p>
                <button type="button" class="bring-go" data-bring="youtube">Paste the YouTube Music link</button>
                <p class="bring-how"><b>On a Mac:</b> open the playlist in Music, select all its songs (&#8984;A), copy them (&#8984;C), then paste them as a list.</p>
                <button type="button" class="bring-go bring-go-quiet" data-bring="paste">Paste a list</button>
            </div>
            <input type="file" id="bringFilesInput" multiple accept="audio/*,.mp3,.m4a,.ogg,.opus,.wav,.flac" aria-label="Audio files to add" style="display:none">
        </div>
    </div>
    <!-- Settings Modal (playback source + Spotify) -->
    {{-- Global library search — searches every playlist via searchLibrary --}}
    <div class="add-song-modal" id="searchModal">
        <div class="add-song-modal-backdrop" onclick="hideSearchModal()"></div>
        <div class="add-song-modal-panel search-panel">
            <button type="button" class="add-song-modal-close" onclick="hideSearchModal()" aria-label="Close">&times;</button>
            <div class="search-modal-input-wrap">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>
                <input type="search" id="librarySearchInput" placeholder="Search your whole library" autocomplete="off" oninput="runLibrarySearch()">
            </div>
            <div id="searchResults" class="search-results"></div>
        </div>
    </div>

    {{-- Up-next queue — filled + opened by openQueueModal() --}}
    <div class="add-song-modal" id="queueModal" role="dialog" aria-modal="true" aria-labelledby="queueModalTitle">
        <div class="add-song-modal-backdrop" onclick="hideQueueModal()"></div>
        <div class="add-song-modal-panel queue-panel">
            <button type="button" class="add-song-modal-close" onclick="hideQueueModal()" aria-label="Close">&times;</button>
            <div class="add-song-modal-header">
                <div class="add-song-modal-icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h11M4 12h11M4 18h7"/><path d="M17 15l4 3-4 3"/><path d="M21 18h-6"/></svg></div>
                <h2 class="add-song-modal-title" id="queueModalTitle">Up next</h2>
            </div>
            <div id="queueBody"></div>
        </div>
    </div>

    {{-- Listening stats — filled + opened by showStatsModal() --}}
    <div class="add-song-modal" id="statsModal" role="dialog" aria-modal="true" aria-labelledby="statsModalTitle">
        <div class="add-song-modal-backdrop" onclick="hideStatsModal()"></div>
        <div class="add-song-modal-panel stats-panel">
            <button type="button" class="add-song-modal-close" onclick="hideStatsModal()" aria-label="Close">&times;</button>
            <div class="add-song-modal-header">
                <div class="add-song-modal-icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V13"/><path d="M10 20V6"/><path d="M16 20V10"/><path d="M3 20h18"/></svg></div>
                <h2 class="add-song-modal-title" id="statsModalTitle">Your listening</h2>
            </div>
            <div class="settings-source-options stats-range" id="statsRange">
                <button type="button" class="settings-source-btn" data-range="week" onclick="setStatsRange('week')">Week</button>
                <button type="button" class="settings-source-btn" data-range="month" onclick="setStatsRange('month')">Month</button>
                <button type="button" class="settings-source-btn" data-range="year" onclick="setStatsRange('year')">Year</button>
                <button type="button" class="settings-source-btn active" data-range="all" onclick="setStatsRange('all')">All time</button>
            </div>
            <div id="statsBody"></div>
        </div>
    </div>

    <div class="add-song-modal" id="settingsModal" role="dialog" aria-modal="true" aria-labelledby="settingsModalTitle">
        <div class="add-song-modal-backdrop" onclick="hideSettingsModal()"></div>
        <div class="add-song-modal-panel settings-modal-panel">
            <button type="button" class="add-song-modal-close" onclick="hideSettingsModal()" aria-label="Close">&times;</button>
            <div class="add-song-modal-header">
                <div class="add-song-modal-icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.1"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V15z"/></svg></div>
                <h2 class="add-song-modal-title" id="settingsModalTitle">Settings</h2>
            </div>

            <div class="settings-tabs" id="settingsTabs">
                <button type="button" class="settings-tab active" data-tab="playback" onclick="setSettingsTab('playback')">
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg>Playback
                </button>
                <button type="button" class="settings-tab" data-tab="appearance" onclick="setSettingsTab('appearance')">
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/></svg>Appearance
                </button>
                <button type="button" class="settings-tab" data-tab="account" onclick="setSettingsTab('account')">
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/></svg>Account
                </button>
            </div>

            <div class="settings-panel active" data-panel="playback">
            <div class="settings-panel-scroll">
            <div class="add-song-form-group">
                <label>Crossfade</label>
                <div class="settings-source-options" id="crossfadeOptions">
                    <button type="button" class="settings-source-btn active" data-xf="0" onclick="setCrossfade(0)">Off</button>
                    <button type="button" class="settings-source-btn" data-xf="3" onclick="setCrossfade(3)">3s</button>
                    <button type="button" class="settings-source-btn" data-xf="6" onclick="setCrossfade(6)">6s</button>
                    <button type="button" class="settings-source-btn" data-xf="12" onclick="setCrossfade(12)">12s</button>
                </div>
                <p class="settings-hint">Fades each song out and the next one in, so tracks blend instead of cutting.</p>
            </div>

            <div class="add-song-form-group">
                <label>Playback</label>
                <label class="settings-toggle-row">
                    <span>Live lyrics</span>
                    <input type="checkbox" id="settingsLyricsToggle" onchange="setLyricsEnabledFromSettings(this.checked)">
                    <span class="settings-switch"></span>
                </label>
                <label class="settings-toggle-row">
                    <span>Vinyl crackle between songs</span>
                    <input type="checkbox" id="settingsCrackleToggle" onchange="setCrackleEnabledFromSettings(this.checked)">
                    <span class="settings-switch"></span>
                </label>
            </div>

            <div class="add-song-form-group">
                <label>Sleep timer</label>
                <div class="settings-source-options sleep-options" id="sleepOptions">
                    <button type="button" class="settings-source-btn" onclick="setSleepTimer(15)">15m</button>
                    <button type="button" class="settings-source-btn" onclick="setSleepTimer(30)">30m</button>
                    <button type="button" class="settings-source-btn" onclick="setSleepTimer(45)">45m</button>
                    <button type="button" class="settings-source-btn" onclick="setSleepTimer(60)">60m</button>
                    <button type="button" class="settings-source-btn" onclick="setSleepTimer('end')">End of track</button>
                    <button type="button" class="settings-source-btn sleep-off" onclick="setSleepTimer(0)">Off</button>
                </div>
                <p class="settings-hint" id="sleepStatusHint">Fades the volume out and pauses when the timer ends.</p>
            </div>

            <details class="settings-password-details settings-advanced" id="settingsAdvancedDetails">
                <summary>Advanced</summary>
                <div class="add-song-form-group">
                    <label>Add-song source</label>
                    <div class="settings-source-options" id="settingsSourceOptions">
                        <button type="button" class="settings-source-btn active" data-source="youtube" onclick="setMusicSource('youtube')">YouTube</button>
                        <button type="button" class="settings-source-btn" data-source="mp3" onclick="setMusicSource('mp3')">MP3 URL</button>
                        <button type="button" class="settings-source-btn" data-source="spotify" onclick="setMusicSource('spotify')">Spotify</button>
                    </div>
                    <p class="settings-hint">What Add song asks for first. YouTube and Spotify links work whichever is picked; MP3 URL also lets you upload a file.</p>
                </div>
            </details>
            </div>
            </div>

            <div class="settings-panel" data-panel="appearance">
            <div class="settings-panel-scroll">
            <div class="add-song-form-group">
                <label>Room theme</label>
                <div class="theme-swatch-row" id="themeSwatchRow">
                    <button type="button" class="theme-swatch-btn" data-theme="blue-hour" onclick="setRoomTheme('blue-hour')" title="Deep teal walls and brass lamplight — the default">
                        <span class="theme-swatch" style="--sw-wall:#1c353b;--sw-accent:#f2b45c"></span>Blue Hour
                    </button>
                    <button type="button" class="theme-swatch-btn" data-theme="golden-hour" onclick="setRoomTheme('golden-hour')" title="Warm browns and brass — the original">
                        <span class="theme-swatch" style="--sw-wall:#2f2721;--sw-accent:#f2b45c"></span>Golden Hour
                    </button>
                    <button type="button" class="theme-swatch-btn" data-theme="after-hours" onclick="setRoomTheme('after-hours')" title="Ink-blue walls, moonlit steel accents">
                        <span class="theme-swatch" style="--sw-wall:#20242e;--sw-accent:#a8c0dc"></span>After Hours
                    </button>
                    <button type="button" class="theme-swatch-btn" data-theme="velvet" onclick="setRoomTheme('velvet')" title="Oxblood walls, rose-copper accents">
                        <span class="theme-swatch" style="--sw-wall:#2e1a1e;--sw-accent:#d89aa0"></span>Velvet
                    </button>
                    <button type="button" class="theme-swatch-btn" data-theme="greenroom" onclick="setRoomTheme('greenroom')" title="Deep moss walls, sage accents">
                        <span class="theme-swatch" style="--sw-wall:#232b21;--sw-accent:#b4c69a"></span>Greenroom
                    </button>
                </div>
            </div>

            <div class="add-song-form-group settings-sleeve-group">
                <label>Lyrics sleeve</label>
                <div class="settings-source-options" id="sleeveStyleOptions">
                    <button type="button" class="settings-source-btn active" data-sleeve="stand" onclick="setSleeveStyle('stand')">Standing</button>
                    <button type="button" class="settings-source-btn" data-sleeve="lean" onclick="setSleeveStyle('lean')">Leaning</button>
                </div>
                <p class="settings-hint">How the sleeve with the cover and lyrics sits next to the record player: upright on its own, or tipped against the deck like the original.</p>
            </div>
            </div>
            </div>

            <div class="settings-panel" data-panel="account">
            <div class="settings-panel-scroll">
            @if ($spotifyOn)
            <div class="add-song-form-group settings-spotify-group">
                <label>Spotify</label>
                <div id="spotifyNotConfigured" class="spotify-state" style="display:none">
                    <p class="settings-hint">Spotify isn't available right now.</p>
                </div>
                <div id="spotifyNotConnected" class="spotify-state" style="display:none">
                    <button type="button" class="spotify-connect-btn" onclick="connectSpotify()">
                        <span class="spotify-glyph">&#9835;</span> Connect Spotify
                    </button>
                </div>
                <div id="spotifyConnected" class="spotify-state" style="display:none">
                    <div class="spotify-user" id="spotifyUserInfo"></div>
                    <div class="spotify-connected-actions">
                        <button type="button" class="add-song-btn-save" onclick="showSpotifyImportModal()">Import playlist</button>
                        <button type="button" class="add-song-btn-cancel" onclick="disconnectSpotify()">Disconnect</button>
                    </div>
                </div>
            </div>
            @endif

            <div class="add-song-form-group settings-account-group">
                <label>Account</label>
                @if (auth()->user()->email)
                    <div class="settings-hint" id="settingsAccountEmail">{{ auth()->user()->email }}@if (auth()->user()->member_number) &middot; Member {{ auth()->user()->formattedMemberNumber() }}@endif</div>
                @elseif (auth()->user()->member_number !== null)
                    <div class="settings-hint" id="settingsAccountEmail">Member {{ auth()->user()->formattedMemberNumber() }} &middot; no email attached</div>
                @else
                    <div class="settings-hint" id="settingsAccountEmail">Signed in with Spotify</div>
                @endif

                <div class="settings-inline-form">
                    <input type="text" id="settingsNameInput" value="{{ auth()->user()->name }}" maxlength="100" placeholder="Display name" autocomplete="name">
                    <button type="button" class="add-song-btn-save" onclick="saveAccountName()">Save</button>
                </div>
                <div class="settings-status" id="settingsNameStatus"></div>

                @if (! auth()->user()->email && auth()->user()->member_number !== null)
                <details class="settings-password-details" id="settingsAttachEmailDetails">
                    <summary>Attach an email</summary>
                    <p class="settings-hint">Adds email login and password reset. Your member number and PIN keep working.</p>
                    <div class="add-song-form-group">
                        <input type="email" id="settingsAttachEmail" placeholder="you@example.com" autocomplete="email">
                    </div>
                    <div class="add-song-form-group">
                        <input type="password" id="settingsAttachEmailPin" placeholder="Current PIN or password" autocomplete="current-password">
                    </div>
                    <button type="button" class="add-song-btn-save" onclick="attachAccountEmail()">Attach email</button>
                    <div class="settings-status" id="settingsAttachEmailStatus"></div>
                </details>
                @endif

                @if ($acctHasLogin)
                <details class="settings-password-details" id="settingsPasswordDetails">
                    <summary>{{ auth()->user()->email ? 'Change password' : 'Change PIN to a password' }}</summary>
                    <div class="add-song-form-group">
                        <input type="password" id="settingsCurrentPassword" placeholder="{{ auth()->user()->email ? 'Current password' : 'Current PIN' }}" autocomplete="current-password">
                    </div>
                    <div class="add-song-form-group">
                        <input type="password" id="settingsNewPassword" placeholder="New password (at least 8 characters)" autocomplete="new-password">
                    </div>
                    <div class="add-song-form-group">
                        <input type="password" id="settingsNewPasswordConfirm" placeholder="Repeat new password" autocomplete="new-password">
                    </div>
                    <button type="button" class="add-song-btn-save" onclick="changeAccountPassword()">Update password</button>
                    <div class="settings-status" id="settingsPasswordStatus"></div>
                </details>
                @endif

                <form method="POST" action="{{ route('logout') }}" class="settings-logout-form">
                    @csrf
                    <button type="submit" class="add-song-btn-cancel">Log out</button>
                </form>
            </div>
            </div>
            </div>

            <div class="add-song-modal-buttons">
                <button type="button" class="add-song-btn-cancel" onclick="hideSettingsModal()">Close</button>
            </div>
        </div>
    </div>

    <!-- Spotify Import Modal -->
    <div class="add-song-modal" id="spotifyImportModal" role="dialog" aria-modal="true" aria-labelledby="importModalTitle">
        <div class="add-song-modal-backdrop" onclick="hideSpotifyImportModal()"></div>
        <div class="add-song-modal-panel">
            <button type="button" class="add-song-modal-close" onclick="hideSpotifyImportModal()" aria-label="Close">&times;</button>
            <div class="add-song-modal-header">
                <div class="add-song-modal-icon">&#9834;</div>
                <h2 class="add-song-modal-title" id="importModalTitle">Import songs</h2>
            </div>

            <div class="import-tabs" id="importTabs">
                <button type="button" class="import-tab active" data-tab="paste" onclick="setImportTab('paste')">Paste a list</button>
                <button type="button" class="import-tab" data-tab="youtube" onclick="setImportTab('youtube')">YouTube link</button>
                @if ($spotifyOn)
                <button type="button" class="import-tab" data-tab="spotify" onclick="setImportTab('spotify')">Spotify link</button>
                @endif
            </div>

            <div class="import-pane" id="importPastePane">
                <div class="add-song-form-group">
                    <label for="pasteImportInput">One song per line &mdash; &ldquo;Artist &ndash; Title&rdquo;</label>
                    <textarea id="pasteImportInput" class="import-textarea" rows="6" placeholder="Laufey &ndash; From the Start&#10;Don Toliver &ndash; No Pole&#10;Clairo &ndash; Pretty Girl"></textarea>
                </div>
                <p class="settings-hint">Paste from anywhere &mdash; a whole playlist is fine. Each line is matched to a YouTube video you can review before adding; a long list takes a few minutes.</p>
                <div class="add-song-modal-buttons">
                    <button type="button" class="add-song-btn-save" onclick="resolvePasteList()">Find matches</button>
                </div>
            </div>

            <div class="import-pane" id="importYoutubePane" style="display:none">
                <div class="add-song-form-group">
                    <label for="youtubeImportUrl">YouTube playlist URL</label>
                    <div class="spotify-import-url-row">
                        <input type="text" id="youtubeImportUrl" placeholder="https://youtube.com/playlist?list=...">
                        <button type="button" class="add-song-btn-save" onclick="fetchYoutubePlaylist()">Fetch</button>
                    </div>
                </div>
                <p class="settings-hint">Paste a public YouTube playlist link &mdash; every track imports with no setup. Review the list before adding.</p>
            </div>

            <div class="import-pane" id="importSpotifyPane" style="display:none">
                @if ($spotifyOn)
                <div class="add-song-form-group">
                    <label for="spotifyImportUrl">Public playlist URL</label>
                    <div class="spotify-import-url-row">
                        <input type="text" id="spotifyImportUrl" placeholder="https://open.spotify.com/playlist/...">
                        <button type="button" class="add-song-btn-save" onclick="fetchSpotifyPlaylistUrl()">Fetch</button>
                    </div>
                </div>
                <p class="settings-hint" id="spotifyImportHint">Paste any public Spotify playlist link. Songs stream from YouTube; each one resolves the first time you play it.</p>
                <details class="settings-password-details import-profile-details" id="spotifyProfileDetails">
                    <summary>Import everything from a profile</summary>
                    <div class="add-song-form-group">
                        <label for="spotifyProfileUrl">Public profile</label>
                        <div class="spotify-import-url-row">
                            <input type="text" id="spotifyProfileUrl" placeholder="https://open.spotify.com/user/...">
                            <button type="button" class="add-song-btn-save" id="spotifyProfileImportBtn" onclick="importSpotifyProfile()">Import all</button>
                        </div>
                        <p class="settings-hint">Every playlist that profile has made public, each as its own playlist here. No Spotify sign-in needed. Liked Songs and private playlists need Connect Spotify (Settings → Account) or "Continue with Spotify".</p>
                        <div class="settings-hint spotify-import-all-status" id="spotifyProfileImportStatus" style="display:none" aria-live="polite"></div>
                    </div>
                </details>
                <div id="spotifyUserPlaylists" class="add-song-form-group" style="display:none">
                    <label>Your playlists</label>
                    <div class="spotify-import-all">
                        <button type="button" class="add-song-btn-save" id="spotifyImportAllBtn" onclick="importEntireSpotifyLibrary()">Import everything</button>
                        <p class="settings-hint">Liked Songs plus every playlist, each as its own playlist here. Run it again any time to sync them with Spotify.</p>
                    </div>
                    <div class="settings-hint spotify-import-all-status" id="spotifyImportAllStatus" style="display:none" aria-live="polite"></div>
                    <div class="spotify-playlists-list" id="spotifyPlaylistsList"></div>
                </div>
                @endif
            </div>

            <div id="spotifyImportLoading" class="spotify-import-loading" style="display:none">
                <span class="spotify-spinner"></span> <span id="spotifyImportLoadingText">Loading tracks&hellip;</span>
            </div>

            <div id="spotifyImportPreview" class="spotify-import-preview" style="display:none">
                <div class="spotify-import-info" id="spotifyImportInfo"></div>
                <div class="spotify-import-tracks import-checklist" id="spotifyImportTracks"></div>
                {{-- Where the import lands: set up by setImportTarget() in script.js --}}
                <div class="import-target" role="radiogroup" aria-label="Save to">
                    <div class="import-target-label">Save to</div>
                    <div class="import-target-options">
                        <label class="import-target-option"><input type="radio" name="importTarget" value="new" onchange="updateImportTarget()"><span>New playlist</span></label>
                        <label class="import-target-option"><input type="radio" name="importTarget" value="current" onchange="updateImportTarget()"><span id="importTargetCurrent">Current playlist</span></label>
                    </div>
                    <div class="add-song-form-group import-target-name-group" id="importTargetNameGroup">
                        <input type="text" id="importTargetName" maxlength="90" placeholder="Playlist name" aria-label="New playlist name">
                    </div>
                </div>
                <div class="add-song-modal-buttons">
                    <button type="button" class="add-song-btn-cancel" onclick="resetImportPreview()">Back</button>
                    <button type="button" class="add-song-btn-save" id="importAddBtn" onclick="confirmImportSelection()">Add songs</button>
                </div>
            </div>
        </div>
    </div>

    <!-- Vinyl GIF Maker modal -->
    <div class="vgm-modal" id="vinylGifModal">
        <div class="vgm-backdrop" onclick="closeVinylGifModal()"></div>
        <div class="vgm-panel">
            <button class="vgm-close" onclick="closeVinylGifModal()" title="Close">&times;</button>
            <div class="vgm-header">
                <div class="vgm-header-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"/>
                        <circle cx="12" cy="12" r="4"/>
                        <circle cx="12" cy="12" r="1" fill="currentColor"/>
                    </svg>
                </div>
                <div class="vgm-header-text">
                    <h2>Vinyl GIF Maker</h2>
                    <p>Spin a cover into a shareable GIF</p>
                </div>
            </div>

            <div class="vgm-body">
                <!-- Left: Preview -->
                <div class="vgm-preview-side">
                    <div class="vgm-preview-stage">
                        <canvas id="vgmPreviewCanvas" width="480" height="480"></canvas>
                        <img id="vgmResultImg" class="vgm-result-img" alt="Generated vinyl GIF" style="display:none">
                        <div class="vgm-preview-empty" id="vgmPreviewEmpty">
                            <div class="vgm-preview-empty-icon">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="12" cy="12" r="9"/>
                                    <circle cx="12" cy="12" r="3"/>
                                </svg>
                            </div>
                            <p>Load a cover to start</p>
                        </div>
                    </div>
                    <div class="vgm-progress" id="vgmProgress">
                        <div class="vgm-progress-bar"><div class="vgm-progress-fill" id="vgmProgressFill"></div></div>
                        <div class="vgm-progress-text" id="vgmProgressText">Encoding 0%</div>
                    </div>
                    <div class="vgm-result-meta" id="vgmResultMeta" style="display:none"></div>
                    <div class="vgm-result-actions" id="vgmResultActions" style="display:none">
                        <a class="vgm-btn vgm-btn-primary" id="vgmDownloadLink" download>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="7 10 12 15 17 10"/>
                                <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                            Download GIF
                        </a>
                        <button class="vgm-btn vgm-btn-ghost" onclick="vgmMakeAnother()">Make another</button>
                    </div>
                </div>

                <!-- Right: Controls -->
                <div class="vgm-controls-side">
                    <!-- Source Tabs -->
                    <div class="vgm-section">
                        <div class="vgm-section-title">Cover Source</div>
                        <div class="vgm-tab-toggle">
                            <button class="vgm-tab active" data-source-tab="youtube" onclick="vgmSwitchSourceTab('youtube')">URL</button>
                            <button class="vgm-tab" data-source-tab="search"  onclick="vgmSwitchSourceTab('search')">Search</button>
                            <button class="vgm-tab" data-source-tab="upload"  onclick="vgmSwitchSourceTab('upload')">Upload</button>
                        </div>

                        <div class="vgm-source-panel" data-source-panel="youtube">
                            <div class="vgm-input-row">
                                <input type="text" id="vgmYoutubeUrl" placeholder="Paste YouTube URL or video ID" autocomplete="off">
                                <button class="vgm-btn vgm-btn-secondary" onclick="vgmLoadYoutubeThumb()">Load</button>
                            </div>
                            <div class="vgm-thumb-variants" id="vgmThumbVariants"></div>
                        </div>

                        <div class="vgm-source-panel" data-source-panel="search" style="display:none">
                            <div class="vgm-input-row">
                                <input type="text" id="vgmSearchQuery" placeholder="Search album / artist (iTunes)…" autocomplete="off" onkeydown="if(event.key==='Enter'){event.preventDefault(); vgmSearchYoutube();}">
                                <button class="vgm-btn vgm-btn-secondary" onclick="vgmSearchYoutube()">Search</button>
                            </div>
                            <div class="vgm-thumb-variants" id="vgmSearchResults"></div>
                        </div>

                        <div class="vgm-source-panel" data-source-panel="upload" style="display:none">
                            <label class="vgm-upload-drop" id="vgmUploadDrop">
                                <input type="file" id="vgmUploadInput" accept="image/*" style="display:none" onchange="vgmHandleUpload(event)">
                                <span class="vgm-upload-icon">&#8682;</span>
                                <span class="vgm-upload-text">Click to upload an image</span>
                            </label>
                            <div class="vgm-cropper" id="vgmCropper" style="display:none">
                                <div class="vgm-cropper-stage">
                                    <canvas id="vgmCropperCanvas" width="280" height="280"></canvas>
                                    <div class="vgm-cropper-overlay" id="vgmCropperOverlay"></div>
                                </div>
                                <div class="vgm-cropper-controls">
                                    <label class="vgm-slider-label">Zoom</label>
                                    <input type="range" id="vgmCropZoom" min="1" max="3" step="0.01" value="1">
                                    <button class="vgm-btn vgm-btn-secondary vgm-btn-small" onclick="vgmApplyCrop()">Use this crop</button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Vinyl Style -->
                    <div class="vgm-section">
                        <div class="vgm-section-title">Vinyl Style</div>
                        <div class="vgm-style-grid" id="vgmStyleGrid">
                            <button class="vgm-style-chip active" data-style="classic" onclick="vgmSelectStyle('classic')"><span class="vgm-chip-swatch vgm-swatch-classic"></span><span>Classic</span></button>
                            <button class="vgm-style-chip" data-style="colored" onclick="vgmSelectStyle('colored')"><span class="vgm-chip-swatch vgm-swatch-colored"></span><span>Colored</span></button>
                            <button class="vgm-style-chip" data-style="picture" onclick="vgmSelectStyle('picture')"><span class="vgm-chip-swatch vgm-swatch-picture"></span><span>Picture Disc</span></button>
                            <button class="vgm-style-chip" data-style="gold" onclick="vgmSelectStyle('gold')"><span class="vgm-chip-swatch vgm-swatch-gold"></span><span>Gold Label</span></button>
                            <button class="vgm-style-chip" data-style="translucent" onclick="vgmSelectStyle('translucent')"><span class="vgm-chip-swatch vgm-swatch-translucent"></span><span>Translucent</span></button>
                            <button class="vgm-style-chip" data-style="aura" onclick="vgmSelectStyle('aura')"><span class="vgm-chip-swatch vgm-swatch-aura"></span><span>Aura</span></button>
                        </div>
                        <label class="vgm-toggle-row" title="Toggle the small hole at the center of the vinyl">
                            <input type="checkbox" id="vgmShowHole" checked onchange="vgmSetShowHole(this.checked)">
                            <span class="vgm-toggle-switch"></span>
                            <span class="vgm-toggle-label">Center hole</span>
                        </label>
                        <div class="vgm-color-row" id="vgmColorRow" style="display:none">
                            <span class="vgm-color-row-label">Vinyl color</span>
                            <div class="vgm-color-swatches" id="vgmColorSwatches">
                                <button class="vgm-color-swatch active" data-color="#d4476b" style="background:#d4476b"></button>
                                <button class="vgm-color-swatch" data-color="#e8a838" style="background:#e8a838"></button>
                                <button class="vgm-color-swatch" data-color="#5cba5c" style="background:#5cba5c"></button>
                                <button class="vgm-color-swatch" data-color="#7eb8da" style="background:#7eb8da"></button>
                                <button class="vgm-color-swatch" data-color="#9b7ed9" style="background:#9b7ed9"></button>
                                <button class="vgm-color-swatch" data-color="#f0f0f0" style="background:#f0f0f0"></button>
                                <label class="vgm-color-wheel" title="Custom color">
                                    <input type="color" id="vgmColorPicker" value="#d4476b">
                                </label>
                            </div>
                        </div>
                    </div>

                    <!-- Caption -->
                    <div class="vgm-section">
                        <div class="vgm-section-title">Caption (optional)</div>
                        <input type="text" id="vgmCaption" class="vgm-text-input" placeholder="e.g. Late Night Mix" maxlength="60" oninput="vgmRedrawPreview()">
                    </div>

                    <!-- Spin Speed -->
                    <div class="vgm-section">
                        <div class="vgm-section-title">
                            <span>Spin Speed</span>
                            <span class="vgm-speed-value" id="vgmSpeedValue">1.0&times;</span>
                        </div>
                        <div class="vgm-speed-row">
                            <span class="vgm-speed-tick">0.5&times;</span>
                            <input type="range" id="vgmSpeed" class="vgm-speed-slider" min="0.5" max="2.5" step="0.1" value="1">
                            <span class="vgm-speed-tick">2.5&times;</span>
                        </div>
                    </div>

                    <!-- Quality -->
                    <div class="vgm-section">
                        <div class="vgm-section-title">Quality</div>
                        <div class="vgm-quality-grid">
                            <button class="vgm-quality-chip" data-quality="small" onclick="vgmSelectQuality('small')">
                                <span class="vgm-quality-name">Small</span>
                                <span class="vgm-quality-meta">320 &middot; 24 fr</span>
                            </button>
                            <button class="vgm-quality-chip active" data-quality="medium" onclick="vgmSelectQuality('medium')">
                                <span class="vgm-quality-name">Medium</span>
                                <span class="vgm-quality-meta">460 &middot; 36 fr</span>
                            </button>
                            <button class="vgm-quality-chip" data-quality="large" onclick="vgmSelectQuality('large')">
                                <span class="vgm-quality-name">Large</span>
                                <span class="vgm-quality-meta">560 &middot; 48 fr</span>
                            </button>
                        </div>
                    </div>

                    <!-- Actions -->
                    <div class="vgm-actions">
                        <button class="vgm-btn vgm-btn-ghost" onclick="closeVinylGifModal()">Cancel</button>
                        <button class="vgm-btn vgm-btn-primary" id="vgmGenerateBtn" onclick="vgmGenerateGif()" disabled>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="7 10 12 15 17 10"/>
                                <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                            Generate GIF
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>
    <!-- PHP-injected data for JavaScript -->
    @php
        $meta = [];
        foreach ($playlists as $id => $pl) {
            $covers = [];
            $seenCovers = [];
            foreach (($pl['songs'] ?? []) as $idx => $s) {
                $c = $s['cover'] ?? '';
                if ($c && !in_array($c, $seenCovers)) {
                    $seenCovers[] = $c;
                    $covers[] = ['index' => $idx, 'url' => $c, 'title' => $s['title'] ?? ''];
                }
            }
            $meta[$id] = ['name' => $pl['name'] ?? $id, 'color' => nt_safe_css_color($pl['color'] ?? '#d4a574'), 'songCount' => count($pl['songs'] ?? []), 'coverSongIndex' => $pl['coverSongIndex'] ?? null, 'covers' => $covers];
        }
    @endphp
    <script>
        let activePlaylistId = '{{ $activePlaylistId }}';
        let songsData = @json($songs);
        let currentSongIndex = {{ (int) $currentIndex }};
        let playlistsMeta = @json((object) $meta);
        // Spotify import needs this server's Spotify app (Settings, the import
        // sheet and the Search tab's link rows follow it)
        const spotifyOn = @json($spotifyOn);
        let recentlyPlayed = @json($recentlyPlayed);
        let recentSongs = @json($recentSongs);
        let favoriteKeys = new Set(@json($favoriteKeys));
        let shareTokens = @json((object) $shareTokens);
    </script>
    <!-- gif.js encoder for the Vinyl GIF Maker (client-side GIF encoding + worker) -->
    <script src="{{ asset('vendor/gif.js/gif.js') }}?v={{ filemtime(public_path('vendor/gif.js/gif.js')) }}" defer></script>
    <script src="{{ asset('js/player-debug.js') }}?v={{ filemtime(public_path('js/player-debug.js')) }}"></script>
    <script src="{{ asset('js/script.js') }}?v={{ filemtime(public_path('js/script.js')) }}"></script>
    <!-- Spotify Web Playback SDK (Premium streaming). Loaded after script.js so
         window.onSpotifyWebPlaybackSDKReady is defined before the SDK fires it. -->
    <script src="https://sdk.scdn.co/spotify-player.js"></script>
</body>
</html>

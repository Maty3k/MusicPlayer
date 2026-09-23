// ============================================================
// PLAYER DEBUG MODE — a timeline of what the YouTube player does.
// Turn on with ?debug=1 (remembered on this device), off with ?debug=0 or
// the panel's "Off" button. When off, pdbg() is a no-op and nothing else
// runs. Loaded before script.js so every hook below is defined in time.
// ============================================================
(function () {
    let on = false;
    try {
        const param = new URLSearchParams(location.search).get('debug');
        if (param === '1') localStorage.setItem('playerDebug', '1');
        if (param === '0') localStorage.removeItem('playerDebug');
        on = localStorage.getItem('playerDebug') === '1';
    } catch (e) { /* private mode — stays off */ }

    window.pdbg = function () {};
    window.__pdbgAttach = function () {};
    if (!on) return;

    const MAX = 600;
    const log = [];
    const STATES = { '-1': 'unstarted', 0: 'ended', 1: 'playing', 2: 'paused', 3: 'buffering', 5: 'cued' };
    let panelBody = null;

    const stamp = () => (performance.now() / 1000).toFixed(2) + 's';

    function pdbg(msg, data) {
        let line = stamp() + '  ' + msg;
        if (data !== undefined) {
            try { line += '  ' + (typeof data === 'string' ? data : JSON.stringify(data)); } catch (e) { /* cyclic */ }
        }
        log.push(line);
        if (log.length > MAX) log.shift();
        if (panelBody) {
            panelBody.textContent = log.slice(-10).join('\n');
            panelBody.scrollTop = panelBody.scrollHeight;
        }
    }
    window.pdbg = pdbg;

    // The app function that asked the player to do something (skips our wrapper).
    function caller() {
        const frames = (new Error().stack || '').split('\n').slice(3, 6);
        return frames.map(f => (f.match(/at (\S+)/) || [])[1]).filter(Boolean).join(' < ');
    }

    window.__pdbgAttach = function (player) {
        const posOf = () => { try { return +(player.getCurrentTime() || 0).toFixed(2); } catch (e) { return null; } };
        const vidOf = () => { try { return (player.getVideoData() || {}).video_id || ''; } catch (e) { return ''; } };

        ['loadVideoById', 'cueVideoById', 'playVideo', 'pauseVideo', 'stopVideo', 'seekTo', 'mute', 'unMute'].forEach(name => {
            const orig = player[name];
            if (typeof orig !== 'function') return;
            player[name] = function (...args) {
                pdbg('call ' + name + '(' + args.map(a => JSON.stringify(a)).join(', ') + ')', 'from ' + caller() + ' at ' + posOf());
                return orig.apply(this, args);
            };
        });

        // Volume: fades call this every 80ms, so only note big moves and silence.
        const origVol = player.setVolume;
        let lastVol = null;
        if (typeof origVol === 'function') {
            player.setVolume = function (v) {
                if (lastVol === null || Math.abs(v - lastVol) >= 25 || (v <= 2) !== (lastVol <= 2)) {
                    pdbg('volume ' + lastVol + ' → ' + v, 'from ' + caller());
                    lastVol = v;
                }
                return origVol.apply(this, arguments);
            };
        }

        let bufferingSince = null;
        pdbg('player ready');
        player.addEventListener('onStateChange', e => {
            const pos = posOf();
            if (e.data === 3) bufferingSince = performance.now();
            let extra = '';
            if (e.data !== 3 && bufferingSince !== null) {
                extra = ' (buffered ' + ((performance.now() - bufferingSince) / 1000).toFixed(1) + 's)';
                bufferingSince = null;
            }
            pdbg('state → ' + (STATES[e.data] ?? e.data) + extra, { pos, video: vidOf() });
        });
        player.addEventListener('onPlaybackQualityChange', e => pdbg('quality → ' + e.data));
        player.addEventListener('onError', e => pdbg('YouTube error ' + e.data, { video: vidOf() }));
        player.addEventListener('onAutoplayBlocked', () => pdbg('AUTOPLAY BLOCKED by the browser', { video: vidOf() }));

        // Watch the position while playing: a stall (clock runs, song doesn't)
        // or a jump (song moves more than the clock) is exactly the symptom.
        let lastPos = null, lastWall = null, lastVid = '';
        setInterval(() => {
            let state;
            try { state = player.getPlayerState(); } catch (e) { return; }
            const pos = posOf(), vid = vidOf(), wall = performance.now();
            if (state === 1 && lastPos !== null && vid === lastVid) {
                const dWall = (wall - lastWall) / 1000, dPos = pos - lastPos;
                if (dPos - dWall > 0.75) pdbg('JUMP ahead ' + (dPos - dWall).toFixed(1) + 's', { from: lastPos, to: pos });
                else if (dPos < -0.5) pdbg('JUMP back ' + (-dPos).toFixed(1) + 's', { from: lastPos, to: pos });
                else if (dWall - dPos > 0.75) pdbg('STALL ' + (dWall - dPos).toFixed(1) + 's while "playing"', { pos });
            }
            lastPos = state === 1 ? pos : null;
            lastWall = wall;
            lastVid = vid;
        }, 500);
    };

    document.addEventListener('visibilitychange', () => pdbg('page ' + document.visibilityState));
    window.addEventListener('error', e => pdbg('JS error: ' + e.message, (e.filename || '').split('/').pop() + ':' + e.lineno));

    function buildPanel() {
        const panel = document.createElement('div');
        panel.id = 'playerDebugPanel';
        panel.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483646;width:min(460px,calc(100vw - 24px));'
            + 'background:rgba(10,14,16,0.94);color:#d8f0d0;border:1px solid rgba(160,220,150,0.35);border-radius:10px;'
            + 'font:11px/1.45 ui-monospace,Menlo,Consolas,monospace;box-shadow:0 8px 30px rgba(0,0,0,0.5)';
        const head = document.createElement('div');
        head.style.cssText = 'display:flex;gap:6px;align-items:center;padding:6px 8px;border-bottom:1px solid rgba(160,220,150,0.2)';
        const title = document.createElement('strong');
        title.textContent = 'player debug';
        title.style.cssText = 'flex:1;font-weight:600';
        head.appendChild(title);
        const btn = (label, fn) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = label;
            b.style.cssText = 'font:inherit;color:inherit;background:rgba(160,220,150,0.12);border:1px solid rgba(160,220,150,0.3);border-radius:6px;padding:2px 8px;cursor:pointer';
            b.addEventListener('click', fn);
            head.appendChild(b);
            return b;
        };
        const copyBtn = btn('Copy log', async () => {
            const text = [
                'Music Player debug log',
                'page: ' + location.pathname + '  at ' + new Date().toISOString(),
                'browser: ' + navigator.userAgent,
                'network: ' + ((navigator.connection && navigator.connection.effectiveType) || 'unknown'),
                '',
                ...log,
            ].join('\n');
            try {
                await navigator.clipboard.writeText(text);
                copyBtn.textContent = 'Copied!';
            } catch (e) {
                // Clipboard blocked (http, old browser): show it for manual copy.
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.cssText = 'width:100%;height:160px;font:inherit;background:#000;color:inherit;border:0';
                panel.appendChild(ta);
                ta.select();
                copyBtn.textContent = 'Select + copy below';
            }
            setTimeout(() => { copyBtn.textContent = 'Copy log'; }, 2500);
        });
        let collapsed = false;
        const hideBtn = btn('Hide', () => {
            collapsed = !collapsed;
            panelBody.style.display = collapsed ? 'none' : '';
            hideBtn.textContent = collapsed ? 'Show' : 'Hide';
        });
        btn('Off', () => {
            try { localStorage.removeItem('playerDebug'); } catch (e) { /* ignore */ }
            panel.remove();
            panelBody = null;
        });
        panelBody = document.createElement('pre');
        panelBody.style.cssText = 'margin:0;padding:8px;max-height:170px;overflow:auto;white-space:pre-wrap;word-break:break-word';
        panel.appendChild(head);
        panel.appendChild(panelBody);
        document.body.appendChild(panel);
        panelBody.textContent = log.slice(-10).join('\n');
    }

    pdbg('debug on', { connection: (navigator.connection && navigator.connection.effectiveType) || 'unknown' });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildPanel);
    else buildPanel();
})();

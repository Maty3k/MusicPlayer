/* ============================================================
   Service worker: offline support.

   Four caches:
   - SHELL   : the last successful render of "/" (per-user HTML) so the
               app can boot with no network. Only 200 responses whose
               final URL is "/" are stored (never login redirects).
   - MEDIA   : uploaded audio + covers the user explicitly saved via a
               playlist's "available offline" toggle (page code writes
               into this cache directly with window.caches).
   - CLOUD   : Cloudflare songs the user downloaded (cloud-music.js writes
               them, keyed by each song's exact address), plus the last
               copy of the Cloudflare list for offline use.
   - RUNTIME : static assets (css/js/vendor/icons) and cover images,
               cached as they're used.

   YouTube/Spotify playback happens inside their own cross-origin
   sandboxes — this worker never sees that traffic and cannot make it
   work offline. Only uploaded/MP3 and Cloudflare audio is offline-capable.
   Logging out empties every cache (Clear-Site-Data).
   ============================================================ */

const VERSION = 'v1';
const SHELL_CACHE = 'shell-' + VERSION;
const MEDIA_CACHE = 'media-v1';       // survives version bumps — user downloads
const CLOUD_CACHE = 'cloud-v1';       // survives version bumps — Cloudflare downloads
const RUNTIME_CACHE = 'runtime-' + VERSION;
const RUNTIME_MAX_ENTRIES = 300;

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keep = [SHELL_CACHE, MEDIA_CACHE, CLOUD_CACHE, RUNTIME_CACHE];
        for (const key of await caches.keys()) {
            if (!keep.includes(key)) await caches.delete(key);
        }
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    // --- Uploaded media: cache-first with Range support ---
    if (url.origin === self.location.origin && url.pathname.startsWith('/media/')) {
        event.respondWith(serveMedia(req));
        return;
    }

    // --- Cloudflare songs: the downloaded copy first, by exact address ---
    if (url.origin === self.location.origin && url.pathname === '/cloud-music/file') {
        event.respondWith(serveCloudFile(req));
        return;
    }

    // --- The Cloudflare list: the network first, its last copy offline ---
    if (url.origin === self.location.origin && url.pathname === '/cloud-music/list') {
        event.respondWith(serveCloudList(req));
        return;
    }

    // --- Navigations: network-first, cached shell as offline fallback ---
    if (req.mode === 'navigate') {
        event.respondWith(serveNavigation(req));
        return;
    }

    // --- Same-origin static assets: stale-while-revalidate ---
    if (url.origin === self.location.origin &&
        (/^\/(css|js|vendor|icons)\//.test(url.pathname) || url.pathname === '/manifest.webmanifest')) {
        event.respondWith(staleWhileRevalidate(req));
        return;
    }

    // --- Cross-origin images (album covers) + Google fonts: cache-first ---
    if (req.destination === 'image' ||
        url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
        event.respondWith(cacheFirst(req));
        return;
    }
    // Everything else (APIs, YouTube/Spotify SDK traffic) goes to the network.
});

/* Serve /media/ audio. A full copy may sit in MEDIA_CACHE (saved for
   offline); <audio> seeks with Range requests, which cache.match can't
   answer directly — slice the cached body ourselves. */
async function serveMedia(req) {
    const cache = await caches.open(MEDIA_CACHE);
    const cached = await cache.match(req.url, { ignoreSearch: true, ignoreVary: true });

    if (!cached) {
        // Not saved for offline: plain passthrough (the browser handles ranges).
        return fetch(req);
    }

    const range = req.headers.get('range');
    if (!range) return cached.clone();

    const m = /bytes=(\d+)-(\d*)/.exec(range);
    if (!m) return cached.clone();

    const body = await cached.clone().arrayBuffer();
    const start = Number(m[1]);
    const end = m[2] ? Math.min(Number(m[2]), body.byteLength - 1) : body.byteLength - 1;
    if (start >= body.byteLength) {
        return new Response(null, { status: 416, headers: {
            'Content-Range': `bytes */${body.byteLength}`,
        }});
    }

    return new Response(body.slice(start, end + 1), {
        status: 206,
        statusText: 'Partial Content',
        headers: {
            'Content-Type': cached.headers.get('Content-Type') || 'audio/mpeg',
            'Content-Range': `bytes ${start}-${end}/${body.byteLength}`,
            'Content-Length': String(end - start + 1),
            'Accept-Ranges': 'bytes',
        },
    });
}

/* Serve a Cloudflare song. A downloaded copy sits in CLOUD_CACHE under the
   song's exact address: the song is in the query, so never ignoreSearch
   here (unlike /media/, whose file names are unique). Otherwise the
   network, which passes <audio>'s ranges on to the server itself. */
async function serveCloudFile(req) {
    const cache = await caches.open(CLOUD_CACHE);
    const cached = await cache.match(req.url, { ignoreVary: true });
    if (!cached) return fetch(req);
    return sliceForRange(cached, req.headers.get('range'));
}

/* The Cloudflare list: fresh from the network, and kept. With no network,
   or the server failing, the last copy, marked so the page knows it is
   offline and offers only the downloaded songs. */
async function serveCloudList(req) {
    const cache = await caches.open(CLOUD_CACHE);
    let res = null;
    try {
        res = await fetch(req);
        if (res.ok) {
            await cache.put('/cloud-music/list', res.clone());
            return res;
        }
        if (res.status < 500) return res; // e.g. signed out: the page must know
    } catch (e) {
        // no network: the copy below
    }
    const copy = await cache.match('/cloud-music/list', { ignoreVary: true });
    if (!copy) return res || Response.error();
    const headers = new Headers(copy.headers);
    headers.set('X-Offline-Copy', '1');
    return new Response(copy.body, { status: 200, headers });
}

/* <audio> asks for byte ranges, which cache.match can't answer: slice them
   out of the copy. A Blob slice reads only that part, never the whole song. */
async function sliceForRange(cached, range) {
    const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
    if (!m || (m[1] === '' && m[2] === '')) return cached.clone();
    const blob = await cached.clone().blob();
    const size = blob.size;
    let start;
    let end;
    if (m[1] === '') {
        // bytes=-N: the last N bytes
        start = Math.max(0, size - Number(m[2]));
        end = size - 1;
    } else {
        start = Number(m[1]);
        end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
    }
    if (start >= size || start > end) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    return new Response(blob.slice(start, end + 1), {
        status: 206,
        statusText: 'Partial Content',
        headers: {
            'Content-Type': cached.headers.get('Content-Type') || 'audio/mpeg',
            'Content-Range': `bytes ${start}-${end}/${size}`,
            'Content-Length': String(end - start + 1),
            'Accept-Ranges': 'bytes',
        },
    });
}

async function serveNavigation(req) {
    const cache = await caches.open(SHELL_CACHE);
    try {
        const res = await fetch(req);
        // Cache only the real player page — a redirect to /login lands with a
        // different final URL and must never overwrite the offline shell.
        const finalPath = new URL(res.url || req.url).pathname;
        // Nor the page marked no-store: it shows a new member their PIN.
        const keep = !/no-store/i.test(res.headers.get('Cache-Control') || '');
        if (res.ok && finalPath === '/' && keep) {
            cache.put('/', res.clone());
        }
        return res;
    } catch (e) {
        const cached = await cache.match('/');
        if (cached) return cached;
        return new Response(
            '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
            '<body style="background:#1a1510;color:#d4a574;font-family:sans-serif;display:flex;' +
            'align-items:center;justify-content:center;height:100vh;text-align:center">' +
            '<div><h2>You are offline</h2><p>Open the app once while online to enable offline mode.</p></div>',
            { status: 503, headers: { 'Content-Type': 'text/html' } }
        );
    }
}

async function staleWhileRevalidate(req) {
    const cache = await caches.open(RUNTIME_CACHE);
    const cached = await cache.match(req, { ignoreVary: true });
    const network = fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) {
            cache.put(req, res.clone()).then(() => trimCache(cache));
        }
        return res;
    }).catch(() => null);
    return cached || (await network) || Response.error();
}

async function cacheFirst(req) {
    const cache = await caches.open(RUNTIME_CACHE);
    const cached = await cache.match(req, { ignoreVary: true });
    if (cached) return cached;
    try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) {
            cache.put(req, res.clone()).then(() => trimCache(cache));
        }
        return res;
    } catch (e) {
        return Response.error();
    }
}

/* FIFO cap so cover art can't grow unbounded. */
async function trimCache(cache) {
    const keys = await cache.keys();
    if (keys.length > RUNTIME_MAX_ENTRIES) {
        await cache.delete(keys[0]);
    }
}

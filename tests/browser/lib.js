// Shared plumbing for the phone browser suites: where the app runs, where the
// saved logins live, how to launch Chrome, how to log the test accounts in and
// how to put their active playlist back between suites.
//
// Environment:
//   BASE_URL               app root (default http://127.0.0.1:8123/)
//   STATE_DIR              saved logins (default tests/browser/.state)
//   ARTIFACTS_DIR          screenshots, logs, reports (default <STATE_DIR>/artifacts)
//   BROWSER_TEST_PASSWORD  the seeded accounts' password (default demo-pass-123,
//                          the same as database/seeders/BrowserTestSeeder.php)
//   CHROME_CHANNEL         Playwright channel (default "chrome"; set it empty and
//                          CHROME_PATH to use another Chromium binary)
//   CHROME_PATH            executable path, used when CHROME_CHANNEL is empty
//   HEADED=1               show the browser
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

let base = process.env.BASE_URL || 'http://127.0.0.1:8123/';
if (!base.endsWith('/')) base += '/';

const APP = base;
const ROOT = __dirname;
const STATE_DIR = path.resolve(process.env.STATE_DIR || path.join(ROOT, '.state'));
const ARTIFACTS = path.resolve(process.env.ARTIFACTS_DIR || path.join(STATE_DIR, 'artifacts'));
const PASSWORD = process.env.BROWSER_TEST_PASSWORD || 'demo-pass-123';

// The seeded accounts (BrowserTestSeeder). "empty" has no playlists at all.
const ACCOUNTS = ['demo', 'few', 'mid', 'many', 'empty'];
const email = (acct) => `${acct}@example.com`;

/** Saved login (Playwright storageState) for an account, e.g. state('mid'). */
function state(acct) {
    return path.join(STATE_DIR, `state-${email(acct).replace(/\W/g, '_')}.json`);
}

/** A path under the artifacts dir (parent folders created), for screenshots and reports. */
function shot(...parts) {
    const p = path.join(ARTIFACTS, ...parts);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    return p;
}

function launch(extra = {}) {
    const channel = process.env.CHROME_CHANNEL === undefined ? 'chrome' : process.env.CHROME_CHANNEL;
    const opts = { headless: !process.env.HEADED, ...extra };
    if (channel) opts.channel = channel;
    else if (process.env.CHROME_PATH) opts.executablePath = process.env.CHROME_PATH;
    return chromium.launch(opts);
}

/**
 * Log one account in through the real /login form and save its session
 * (replaces the old shot.js "relogin"). Throws when the login doesn't land
 * on the player.
 */
async function login(browser, acct) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const ctx = await browser.newContext();
    try {
        const page = await ctx.newPage();
        await page.goto(APP + 'login');
        await page.evaluate(({ address, pass }) => {
            const e = document.getElementById('email');
            const p = document.getElementById('password');
            e.value = address; p.value = pass;
            e.closest('form').submit();
        }, { address: email(acct), pass: PASSWORD });
        await page.waitForURL((u) => !String(u).includes('/login'), { timeout: 15000 });
        const url = page.url();
        if (/\/email\/verify/.test(url)) throw new Error(`${acct}: landed on ${url} (account not verified?)`);
        await page.waitForLoadState('load');
        const onPlayer = await page.evaluate(() => typeof playlistsMeta === 'object').catch(() => false);
        if (!onPlayer) throw new Error(`${acct}: logged in but ${url} is not the player`);
        await ctx.storageState({ path: state(acct) });
    } finally {
        await ctx.close();
    }
}

async function loginAll(accounts = ACCOUNTS) {
    const b = await launch();
    try {
        for (const acct of accounts) {
            await login(b, acct);
            console.log(`logged in ${email(acct)} -> ${path.relative(process.cwd(), state(acct))}`);
        }
    } finally {
        await b.close();
    }
}

/**
 * The old fix-active.js: put demo/few/mid/many back on Favorites (suites that
 * open other playlists may leave the server's active playlist elsewhere).
 * Throws if a saved login no longer reaches the player.
 */
async function fixActive(accounts = ['demo', 'few', 'mid', 'many']) {
    const b = await launch();
    try {
        for (const a of accounts) {
            const ctx = await b.newContext({ storageState: state(a) });
            const p = await ctx.newPage();
            await p.route(/youtube\.com|sdk\.scdn|spotify\.com/, r => r.abort());
            await p.goto(APP); await p.waitForTimeout(500);
            if (/\/login/.test(p.url())) throw new Error(`${a}: saved login expired (got ${p.url()})`);
            const before = await p.evaluate(() => ({ active: String(activePlaylistId), n: songsData.length, recent: recentlyPlayed }));
            if (before.active !== 'favorites') {
                await p.evaluate(() => fetch('/save-music', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'switchPlaylist', playlist: 'favorites' }) }).then(r => r.json()));
            }
            await p.reload(); await p.waitForTimeout(500);
            const after = await p.evaluate(() => ({ active: String(activePlaylistId), n: songsData.length }));
            console.log(a, JSON.stringify(before), '->', JSON.stringify(after));
            await ctx.close();
        }
    } finally {
        await b.close();
    }
}

module.exports = { APP, ROOT, STATE_DIR, ARTIFACTS, PASSWORD, ACCOUNTS, email, state, shot, launch, login, loginAll, fixActive, chromium };

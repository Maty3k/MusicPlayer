// Runs the phone browser suites one after another and gates on them.
//
//   node run-all.js                  every suite
//   node run-all.js step5-check ...  only these
//
// Before each suite the accounts are reset: RESET_CMD (if set) re-seeds the
// database, e.g. "php artisan db:seed --class=BrowserTestSeeder --force" in
// CI, then fix-active puts demo/few/mid/many back on Favorites. Logins are
// made once (node login.js) and redone if a saved one stops working.
//
// Each suite's output goes to the console and to <artifacts>/logs/<suite>.txt.
// A suite fails when it prints a FAIL line; it counts as crashed when it exits
// non-zero without one, or never prints its "N/M passed" line. The run exits
// non-zero if any suite failed or crashed.
//
// back-check, keys-check and v11-a11y-axe print reports rather than PASS/FAIL;
// the checks below hold them to their known-good output (see each verify*).
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const L = require('./lib');

const SUITE_TIMEOUT = Number(process.env.SUITE_TIMEOUT_MS || 20 * 60 * 1000);

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The last {...} block a suite printed, parsed. */
function lastJson(out) {
    const start = out.indexOf('{');
    const end = out.lastIndexOf('}');
    if (start < 0 || end < start) throw new Error('no JSON report in the output');
    return JSON.parse(out.slice(start, end + 1));
}

// back-check prints {landscape: {...}}. Known-good (scratchpad runlog,
// 2026-10-02): every control was reachable by a tap (unreachable: []), no page
// errors (errs: []), and the back press from the root left the app
// (rootBack.left: true) rather than landing on another in-app layer.
function verifyBack(out) {
    const r = lastJson(out).landscape || {};
    return [
        { name: 'back-check: every control reachable by a tap (unreachable [])', ok: sameJson(r.unreachable, []), info: r.unreachable },
        { name: 'back-check: no page errors (errs [])', ok: sameJson(r.errs, []), info: r.errs },
        { name: 'back-check: back from the root leaves the app (rootBack.left)', ok: !!(r.rootBack && r.rootBack.left === true), info: r.rootBack },
    ];
}

// keys-check prints one JSON line. Known-good (scratchpad runlog, 2026-10-02):
// after "pause while buffering" then "play while paused" the stub saw exactly
// pause then play (afterResume ["pause","play"]: play while buffering did not
// reload or restart the song), with no page errors.
function verifyKeys(out) {
    const r = lastJson(out);
    return [
        { name: 'keys-check: media keys pause then resume (afterResume ["pause","play"])', ok: sameJson(r.afterResume, ['pause', 'play']), info: r.afterResume },
        { name: 'keys-check: no page errors (errs [])', ok: sameJson(r.errs, []), info: r.errs },
    ];
}

// v11-a11y-axe writes <artifacts>/v11-a11y/axe-all.json: {screen: {state, v: violations}}.
// Known-good (scratchpad v11-a11y/axe-all.json, 2026-10-02): all 19 screens
// scanned with zero violations (wcag2a/2aa/21aa + best-practice), and every
// "errs" line it prints is an empty list (no page errors).
const AXE_SCREENS = ['home', 'library', 'library-plus', 'add-songs', 'add-songs-results', 'add-songs-added', 'import', 'search-empty', 'search-results',
    'playlist', 'playlist-more', 'playlist-songs', 'now-playing', 'you', 'settings-playback', 'settings-appearance', 'settings-account', 'stats', 'empty-home'];
function verifyAxe(out) {
    const report = JSON.parse(fs.readFileSync(path.join(L.ARTIFACTS, 'v11-a11y', 'axe-all.json'), 'utf8'));
    const checks = AXE_SCREENS.map((name) => {
        const v = report[name] ? report[name].v : null;
        return { name: `axe ${name}: scanned, no violations`, ok: Array.isArray(v) && v.length === 0, info: v ? v.map(x => `${x.id}(${x.impact}) x${x.nodes.length}: ${x.nodes.map(n => n.t).slice(0, 3).join(' | ')}`) : 'not scanned' };
    });
    const errLines = out.split('\n').filter(l => l.startsWith('errs '));
    checks.push({ name: 'axe: no page errors in any section', ok: errLines.length === 4 && errLines.every(l => l.trim() === 'errs []'), info: errLines });
    return checks;
}

const SUITES = [
    { name: 'tabs-check' },
    { name: 'fixes-check' },
    { name: 'step4-check' },
    { name: 'step4-fixes-check' },
    { name: 'step5-check' },
    { name: 'step5-fixes-check' },
    { name: 'step6-check' },
    { name: 'step6-fixes-check' },
    { name: 'step7-check' },
    { name: 'step7-fixes-check' },
    { name: 'step8-check' },
    { name: 'step8-fixes-check' },
    { name: 'step9-check' },
    { name: 'step10-check' },
    { name: 'step11-check' },
    { name: 'step12-check' },
    { name: 'fs-check' },
    { name: 'fs2-check' },
    { name: 'onboarding-check' },
    { name: 'desktop-bar-check' },
    { name: 'desktop-sidebar-check' },
    { name: 'desktop-home-check' },
    { name: 'desktop-playlist-check' },
    { name: 'desktop-nowplaying-check' },
    { name: 'desktop-search-check' },
    { name: 'back-check', verify: verifyBack },
    { name: 'keys-check', verify: verifyKeys },
    { name: 'v11-a11y-axe', verify: verifyAxe, before: () => fs.rmSync(path.join(L.ARTIFACTS, 'v11-a11y', 'axe-all.json'), { force: true }) },
];

function runNode(script, args, logFile) {
    return new Promise((resolve) => {
        const out = [];
        const log = logFile ? fs.createWriteStream(logFile) : null;
        const child = spawn(process.execPath, [script, ...args], { cwd: L.ROOT, env: process.env });
        const timer = setTimeout(() => { out.push(`\n[run-all] timed out after ${SUITE_TIMEOUT} ms\n`); child.kill('SIGKILL'); }, SUITE_TIMEOUT);
        const onData = (d) => { out.push(d.toString()); process.stdout.write(d); if (log) log.write(d); };
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);
        child.on('close', (code, signal) => {
            clearTimeout(timer);
            if (log) log.end();
            resolve({ code: code === null ? 1 : code, signal, out: out.join('') });
        });
    });
}

async function reset(name) {
    if (process.env.RESET_CMD) {
        try {
            execSync(process.env.RESET_CMD, { stdio: 'inherit', shell: true, cwd: process.env.RESET_CWD || path.resolve(L.ROOT, '..', '..') });
        } catch (e) {
            return `RESET_CMD failed: ${e.message}`;
        }
    }
    const logFile = L.shot('logs', `${name}.reset.txt`);
    let r = await runNode(path.join(L.ROOT, 'fix-active.js'), [], logFile);
    if (r.code !== 0) {
        console.log('[run-all] fix-active failed; logging in again and retrying');
        try { await L.loginAll(); } catch (e) { return `login failed: ${e.message}`; }
        r = await runNode(path.join(L.ROOT, 'fix-active.js'), [], logFile);
        if (r.code !== 0) return 'fix-active failed after a fresh login';
    }
    return null;
}

async function main() {
    fs.mkdirSync(L.ARTIFACTS, { recursive: true });
    const only = process.argv.slice(2);
    const unknown = only.filter(n => !SUITES.some(s => s.name === n));
    if (unknown.length) { console.error('unknown suite(s): ' + unknown.join(', ')); process.exit(2); }
    const suites = only.length ? SUITES.filter(s => only.includes(s.name)) : SUITES;

    if (process.env.FORCE_LOGIN || !L.ACCOUNTS.every(a => fs.existsSync(L.state(a)))) {
        await L.loginAll();
    }

    const summary = [];
    for (const suite of suites) {
        console.log(`\n===== ${suite.name} =====`);
        const t0 = Date.now();
        const resetErr = await reset(suite.name);
        if (resetErr) {
            console.log(`[run-all] ${suite.name}: ${resetErr}`);
            summary.push({ name: suite.name, status: 'CRASH', passed: 0, total: 0, secs: 0, note: resetErr });
            continue;
        }
        if (suite.before) suite.before();
        const r = await runNode(path.join(L.ROOT, 'suites', `${suite.name}.js`), [], L.shot('logs', `${suite.name}.txt`));
        const secs = Math.round((Date.now() - t0) / 1000);
        let lines = r.out.split('\n');
        let passed = lines.filter(l => l.startsWith('PASS ')).length;
        let failed = lines.filter(l => l.startsWith('FAIL ')).length;
        let hasTotal = /^\s*\d+\/\d+ passed\s*$/m.test(r.out);
        let note = '';
        if (suite.verify && r.code === 0) {
            try {
                const checks = suite.verify(r.out);
                for (const c of checks) console.log((c.ok ? 'PASS ' : 'FAIL ') + c.name + (c.ok ? '' : '  ' + JSON.stringify(c.info)));
                passed = checks.filter(c => c.ok).length;
                failed = checks.length - passed;
                hasTotal = true;
                console.log(`\n${passed}/${checks.length} passed`);
                fs.appendFileSync(L.shot('logs', `${suite.name}.txt`), checks.map(c => (c.ok ? 'PASS ' : 'FAIL ') + c.name + (c.ok ? '' : '  ' + JSON.stringify(c.info))).join('\n') + `\n\n${passed}/${checks.length} passed\n`);
            } catch (e) {
                note = `report unreadable: ${e.message}`;
                hasTotal = false;
            }
        }
        let status;
        if (failed > 0) status = 'FAIL';
        else if (r.code !== 0) { status = 'CRASH'; note = note || `exit ${r.code}${r.signal ? ' ' + r.signal : ''}`; }
        else if (!hasTotal) { status = 'CRASH'; note = note || 'no "N/M passed" line'; }
        else status = 'PASS';
        summary.push({ name: suite.name, status, passed, total: passed + failed, secs, note });
    }

    console.log('\n===== summary =====');
    for (const s of summary) {
        console.log(`${s.status.padEnd(5)} ${s.name.padEnd(20)} ${String(s.passed).padStart(3)}/${String(s.total).padEnd(3)} ${String(s.secs).padStart(4)}s${s.note ? '  ' + s.note : ''}`);
    }
    const bad = summary.filter(s => s.status !== 'PASS');
    fs.writeFileSync(L.shot('summary.json'), JSON.stringify(summary, null, 1));
    console.log(bad.length ? `\n${bad.length} of ${summary.length} suites did not pass` : `\nall ${summary.length} suites passed`);
    process.exit(bad.length ? 1 : 0);
}

module.exports = { SUITES, verifyBack, verifyKeys, verifyAxe };

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

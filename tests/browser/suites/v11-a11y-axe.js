// axe-core scan of the phone screens (demo and empty accounts). Writes
// <artifacts>/v11-a11y/axe-<arg|all>.json; run-all.js checks that report.
// (Copied from the session scratchpad; plumbing lives in v11-a11y-lib.js.)
const L = require('./v11-a11y-lib');
const fs = require('fs');
const out = {};
(async () => {
  const b = await L.launch();
  const scan = async (p, name) => {
    await p.waitForTimeout(300);
    const s = await L.look(p);
    out[name] = { state: s, v: await L.axe(p, name) };
    await p.screenshot({ path: `${L.SHOTS}/${name}.png` });
    console.log('scanned', name, JSON.stringify(s), out[name].v.map(v => v.id + ':' + v.nodes.length).join(' '));
  };
  if (!process.argv[2] || process.argv[2].includes('1')) {
    const { ctx, p } = await L.open(b, { acct: 'demo' });
    await scan(p, 'home');
    await p.tap('#mTabs .m-tab[data-tab="library"]'); await p.waitForTimeout(700);
    await scan(p, 'library');
    await p.tap('#mLibraryNew'); await p.waitForTimeout(600);
    await scan(p, 'library-plus');
    await p.tap('#mAddSheet [data-m-add="songs"]'); await p.waitForTimeout(900);
    await scan(p, 'add-songs');
    await p.fill('#addSongSearch', 'first find'); await p.dispatchEvent('#addSongSearch', 'input'); await p.waitForTimeout(1200);
    await scan(p, 'add-songs-results');
    await p.tap('#addSongSearchResults [data-add-i="0"]'); await p.waitForTimeout(900);
    await scan(p, 'add-songs-added');
    await L.back(p);
    await p.tap('#mLibraryNew'); await p.waitForTimeout(600);
    await p.tap('#mAddSheet [data-m-add="import"]'); await p.waitForTimeout(900);
    await scan(p, 'import');
    await L.back(p);
    await p.tap('#mTabs .m-tab[data-tab="search"]'); await p.waitForTimeout(700);
    await scan(p, 'search-empty');
    await p.tap('#mSearchInput'); await p.keyboard.type('find'); await p.waitForTimeout(1500);
    await scan(p, 'search-results');
    console.log('errs', p.__errs);
    await ctx.close();
  }
  if (!process.argv[2] || process.argv[2].includes('2')) {
    const { ctx, p } = await L.open(b, { acct: 'demo' });
    await p.tap('.m-rp-tile[data-playlist="favorites"]'); await p.waitForTimeout(1200);
    await scan(p, 'playlist');
    await p.tap('#mPlMore'); await p.waitForTimeout(600);
    await scan(p, 'playlist-more');
    await L.back(p);
    // add a song so the list and Now Playing have something
    await p.tap('#songList .song-list-empty-add'); await p.waitForTimeout(800);
    await p.fill('#addSongSearch', 'first find'); await p.dispatchEvent('#addSongSearch', 'input'); await p.waitForTimeout(1200);
    await p.tap('#addSongSearchResults [data-add-i="0"]'); await p.waitForTimeout(900);
    await p.tap('#addSongSearchResults [data-add-i="1"]'); await p.waitForTimeout(900);
    await L.back(p);
    console.log('songs', await p.evaluate(() => songsData.length));
    await scan(p, 'playlist-songs');
    await p.evaluate(() => { window.playSongSource = function () {}; });
    await p.tap('#mDock').catch(e => console.log('dock tap', e.message)); await p.waitForTimeout(1000);
    let s = await L.look(p);
    if (!s.np) { await p.evaluate(() => window.mOpenNowPlaying && window.mOpenNowPlaying()); await p.waitForTimeout(900); }
    await scan(p, 'now-playing');
    console.log('errs', p.__errs);
    await ctx.close();
  }
  if (!process.argv[2] || process.argv[2].includes('3')) {
    const { ctx, p } = await L.open(b, { acct: 'demo' });
    await p.tap('#mAvatarBtn'); await p.waitForTimeout(900);
    await scan(p, 'you');
    await p.tap('#mYouPage [data-m-you="playback"]'); await p.waitForTimeout(800);
    await scan(p, 'settings-playback');
    for (const t of ['appearance', 'account']) {
      await p.evaluate((t) => { const el = document.querySelector(`#settingsTabs .settings-tab[data-tab="${t}"]`); el && el.click(); }, t); await p.waitForTimeout(500);
      await scan(p, 'settings-' + t);
    }
    await L.back(p);
    await p.tap('#mYouSeeAll'); await p.waitForTimeout(1000);
    await scan(p, 'stats');
    console.log('errs', p.__errs);
    await ctx.close();
  }
  if (!process.argv[2] || process.argv[2].includes('4')) {
    const { ctx, p } = await L.open(b, { acct: 'empty' });
    await scan(p, 'empty-home');
    console.log('errs', p.__errs);
    await ctx.close();
  }
  fs.writeFileSync(`${L.SHOTS}/axe-${process.argv[2]||'all'}.json`, JSON.stringify(out, null, 1));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });

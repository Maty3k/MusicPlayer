// Put demo/few/mid/many back on Favorites between suites (the old
// scratchpad fix-active.js). Exits non-zero if a saved login stopped working.
const L = require('./lib');

L.fixActive().catch((e) => { console.error(e); process.exit(1); });

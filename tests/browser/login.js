// Log the seeded accounts in and save their sessions under .state/
// (replaces the old shot.js relogin). Usage: node login.js [acct ...]
const L = require('./lib');

const accounts = process.argv.slice(2).length ? process.argv.slice(2) : L.ACCOUNTS;
L.loginAll(accounts).catch((e) => { console.error(e); process.exit(1); });

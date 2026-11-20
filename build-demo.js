// Builds the GitHub Pages demo into docs/: the same app with no server,
// sample data and everything kept in the visitor's browser.
// Run: node build-demo.js   (then commit docs/ and push)
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'docs');

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'public'), OUT, { recursive: true });
fs.mkdirSync(path.join(OUT, 'data'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'data', 'wards.json'), path.join(OUT, 'data', 'wards.json'));
fs.writeFileSync(path.join(OUT, 'js', 'mode.js'),
  '// Built by build-demo.js: GitHub Pages copy, no server.\nexport const DEMO = true;\n');
fs.writeFileSync(path.join(OUT, '.nojekyll'), ''); // serve files as they are

// The demo backend must be available offline too.
const sw = path.join(OUT, 'sw.js');
fs.writeFileSync(sw, fs.readFileSync(sw, 'utf8')
  .replace("'js/mode.js',", "'js/mode.js', 'js/demo-backend.js', 'data/wards.json',"));

console.log('Demo built in docs/. Commit it and set GitHub Pages to: main branch, /docs folder.');

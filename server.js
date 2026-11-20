// Namma Ward - ward-wise civic outreach PWA server.
// Zero dependencies: Node 18+ only. Run with `node server.js`.
// Complaint rules live in public/js/core.js and are shared with the GitHub Pages demo.
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

const PORT = Number(process.env.PORT || 8080);
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me';
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const CONFIG = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'wards.json'), 'utf8'));
const MAX_BODY = 6 * 1024 * 1024; // 6 MB (photo is resized on the device first)

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (ADMIN_KEY === 'change-me') console.warn('WARNING: set ADMIN_KEY before going live.');

// ---------- storage: a single JSON file, written atomically ----------
// Good for a pilot ward. Move to PostgreSQL before running many wards.
const db = { counters: {}, issues: [], updates: [], meetings: [], projects: [] };
if (fs.existsSync(DB_FILE)) Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
    fs.renameSync(tmp, DB_FILE);
  }, 50);
}
function savePhoto(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), Buffer.from(m[2], 'base64'));
  return `/uploads/${name}`;
}
function isAdmin(headers) {
  const a = Buffer.from(String(headers['x-admin-key'] || '')), b = Buffer.from(ADMIN_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- rate limit for public submissions ----------
const hits = new Map();
function limiter(req) {
  return () => {
    const ip = req.socket.remoteAddress || 'x', now = Date.now();
    const arr = (hits.get(ip) || []).filter((t) => now - t < 10 * 60e3);
    arr.push(now); hits.set(ip, arr);
    return arr.length > 20; // 20 reports per 10 minutes per address
  };
}

// ---------- helpers ----------
function send(res, code, body, headers = {}) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', ...headers,
  });
  res.end(data);
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Body too large'), { status: 413 })); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

// ---------- static files ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  let base = PUBLIC_DIR;
  if (rel.startsWith('/uploads/')) { base = UPLOAD_DIR; rel = rel.slice('/uploads'.length); }
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base)) return send(res, 403, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      if (!path.extname(rel)) return serveStatic(req, res, new URL('/index.html', url)); // SPA fallback
      return send(res, 404, 'Not found');
    }
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      // App code, icons and the logo revalidate every load so a change reaches phones at once;
      // uploaded photos get unique names and never change.
      'Cache-Control': base === UPLOAD_DIR ? 'public, max-age=604800, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(file).pipe(res);
  });
}

import(pathToFileURL(path.join(PUBLIC_DIR, 'js', 'core.js')).href).then((core) => {
  http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
      if (url.pathname.startsWith('/api/')) {
        const body = ['POST', 'PATCH'].includes(req.method) ? await readJson(req) : null;
        const io = { db, config: CONFIG, save, savePhoto, isAdmin, limited: limiter(req),
          newId: () => crypto.randomBytes(6).toString('hex') };
        const out = await core.handle(io, req.method, url.pathname, url.searchParams, body, req.headers);
        if (out.csv) return send(res, 200, out.body, { 'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${out.csv}"` });
        return send(res, out.status, out.body);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
      serveStatic(req, res, url);
    } catch (e) {
      if (!e.status) console.error(e);
      if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Server error' });
    }
  }).listen(PORT, () => console.log(`Namma Ward running on http://localhost:${PORT}`));
});

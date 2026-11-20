// Namma Ward - ward-wise civic outreach PWA server.
// Zero dependencies: Node 18+ only. Run with `node server.js`.
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 8080);
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me';
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const CONFIG = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'wards.json'), 'utf8'));

const STATUSES = ['new', 'submitted', 'in_progress', 'resolved', 'pending'];
const PROJECT_STATUSES = ['completed', 'partial', 'proposed', 'follow_up', 'not_verified'];
const MAX_BODY = 6 * 1024 * 1024; // 6 MB (photo is resized on the device first)

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (ADMIN_KEY === 'change-me') console.warn('WARNING: set ADMIN_KEY before going live.');

// ---------- storage: a single JSON file, written atomically ----------
// Good for a pilot ward. Move to PostgreSQL before running many wards.
let db = { counters: {}, issues: [], updates: [], meetings: [], projects: [] };
if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
    fs.renameSync(tmp, DB_FILE);
  }, 50);
}

const wardById = (id) => CONFIG.wards.find((w) => w.id === id);
const nowIso = () => new Date().toISOString();
const id = () => crypto.randomBytes(6).toString('hex');

function nextTicket(ward) {
  db.counters[ward.id] = (db.counters[ward.id] || 0) + 1;
  return `${ward.code}-${String(db.counters[ward.id]).padStart(5, '0')}`;
}

// Public view: never expose name, phone or exact location of a resident.
function publicIssue(i) {
  return {
    ticket: i.ticket, ward: i.ward, category: i.category, zone: i.zone,
    description: i.description, landmark: i.landmark,
    lat: i.lat != null ? Math.round(i.lat * 1000) / 1000 : null, // ~100 m
    lng: i.lng != null ? Math.round(i.lng * 1000) / 1000 : null,
    photo: i.photo, afterPhoto: i.afterPhoto || null,
    status: i.status, agency: i.agency, agencyRef: i.agencyRef || '',
    pendingReason: i.pendingReason || '',
    history: i.history.map((h) => ({ at: h.at, status: h.status, note: h.note })),
    createdAt: i.createdAt, updatedAt: i.updatedAt,
  };
}

function stats(wardId) {
  const list = db.issues.filter((i) => i.ward === wardId);
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  const byCategory = {}, byAgency = {}, byZone = {};
  const ackHours = [], resolveDays = [];
  for (const i of list) {
    byStatus[i.status]++;
    byCategory[i.category] = (byCategory[i.category] || 0) + 1;
    byZone[i.zone] = (byZone[i.zone] || 0) + 1;
    byAgency[i.agency] ??= { total: 0, resolved: 0 };
    byAgency[i.agency].total++;
    if (i.status === 'resolved') byAgency[i.agency].resolved++;
    const firstMove = i.history.find((h) => h.status !== 'new');
    if (firstMove) ackHours.push((new Date(firstMove.at) - new Date(i.createdAt)) / 36e5);
    const done = i.history.find((h) => h.status === 'resolved');
    if (done) resolveDays.push((new Date(done.at) - new Date(i.createdAt)) / 864e5);
  }
  const median = (a) => {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
    return +(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2).toFixed(1);
  };
  return {
    total: list.length, byStatus, byCategory, byAgency, byZone,
    acknowledgementRate: list.length ? Math.round(((list.length - byStatus.new) / list.length) * 100) : 0,
    medianAckHours: median(ackHours), medianResolveDays: median(resolveDays),
    withPhoto: list.filter((i) => i.photo).length,
    geoTagged: list.filter((i) => i.lat != null).length,
    optInContacts: list.filter((i) => i.consent).length,
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
      if (size > MAX_BODY) { reject(Object.assign(new Error('Body too large'), { code: 413 })); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(Object.assign(new Error('Invalid JSON'), { code: 400 })); }
    });
    req.on('error', reject);
  });
}
const clean = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
function isAdmin(req) {
  const k = req.headers['x-admin-key'] || '';
  const a = Buffer.from(String(k)), b = Buffer.from(ADMIN_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function savePhoto(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  const name = `${Date.now()}-${id()}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), Buffer.from(m[2], 'base64'));
  return `/uploads/${name}`;
}
function toCsv(rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const cols = Object.keys(rows[0] || { ticket: '' });
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

// ---------- rate limit for public submissions ----------
const hits = new Map();
function limited(req) {
  const ip = req.socket.remoteAddress || 'x';
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 10 * 60e3);
  arr.push(now); hits.set(ip, arr);
  return arr.length > 20; // 20 reports per 10 minutes per address
}

// ---------- API ----------
async function api(req, res, url) {
  const p = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const m = req.method;

  if (m === 'GET' && p[1] === 'config') return send(res, 200, CONFIG);

  // /api/wards/:ward/...
  if (p[1] === 'wards' && p[2]) {
    const ward = wardById(p[2]);
    if (!ward) return send(res, 404, { error: 'Unknown ward' });
    const sub = p[3];

    if (m === 'GET' && sub === 'issues') {
      const st = url.searchParams.get('status');
      const list = db.issues.filter((i) => i.ward === ward.id && (!st || i.status === st))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 500);
      return send(res, 200, list.map(publicIssue));
    }
    if (m === 'POST' && sub === 'issues') {
      if (limited(req)) return send(res, 429, { error: 'Too many reports. Please try again later.' });
      const b = await readJson(req);
      const cat = CONFIG.categories.find((c) => c.id === b.category);
      if (!cat) return send(res, 400, { error: 'Choose a category' });
      if (!ward.zones.some((z) => z.id === b.zone)) return send(res, 400, { error: 'Choose an area' });
      const description = clean(b.description, 1000);
      if (description.length < 5) return send(res, 400, { error: 'Describe the issue' });
      const lat = Number(b.lat), lng = Number(b.lng);
      const hasGeo = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
      const consent = b.consent === true;
      const ts = nowIso();
      const issue = {
        ticket: nextTicket(ward), clientId: clean(b.clientId, 64), ward: ward.id,
        category: cat.id, zone: b.zone, description, landmark: clean(b.landmark, 200),
        lat: hasGeo ? lat : null, lng: hasGeo ? lng : null,
        photo: savePhoto(b.photo), afterPhoto: null,
        // Contact details are kept only when the resident gives consent.
        name: consent ? clean(b.name, 80) : '', phone: consent ? clean(b.phone, 20) : '',
        consent, language: b.language === 'kn' ? 'kn' : 'en',
        source: b.source === 'volunteer' ? 'volunteer' : 'resident',
        status: 'new', agency: cat.agency, agencyRef: '', pendingReason: '',
        history: [{ at: ts, status: 'new', note: 'Reported' }], createdAt: ts, updatedAt: ts,
      };
      // Offline re-sends: return the existing ticket instead of duplicating.
      const dup = issue.clientId && db.issues.find((i) => i.clientId === issue.clientId);
      if (dup) return send(res, 200, { ticket: dup.ticket });
      db.issues.push(issue); save();
      return send(res, 201, { ticket: issue.ticket });
    }
    if (m === 'GET' && sub === 'stats') return send(res, 200, stats(ward.id));
    for (const kind of ['updates', 'meetings', 'projects']) {
      if (sub !== kind) continue;
      if (m === 'GET') {
        return send(res, 200, db[kind].filter((x) => x.ward === ward.id)
          .sort((a, b) => (b.date || b.createdAt).localeCompare(a.date || a.createdAt)));
      }
      if (m === 'POST') {
        if (!isAdmin(req)) return send(res, 401, { error: 'Admin key required' });
        const b = await readJson(req);
        const rec = { id: id(), ward: ward.id, createdAt: nowIso(),
          title: clean(b.title, 200), body: clean(b.body, 2000), date: clean(b.date, 30),
          place: clean(b.place, 200), source: clean(b.source, 300) };
        if (!rec.title) return send(res, 400, { error: 'Title is required' });
        if (kind === 'projects') {
          Object.assign(rec, { workOrder: clean(b.workOrder, 80), agency: clean(b.agency, 20),
            amount: clean(b.amount, 40), location: clean(b.location, 200),
            status: PROJECT_STATUSES.includes(b.status) ? b.status : 'not_verified',
            evidence: savePhoto(b.photo) });
        }
        db[kind].push(rec); save();
        return send(res, 201, rec);
      }
    }
    if (m === 'GET' && sub === 'export.csv') {
      if (!isAdmin(req)) return send(res, 401, { error: 'Admin key required' });
      const rows = db.issues.filter((i) => i.ward === ward.id).map((i) => ({
        ticket: i.ticket, createdAt: i.createdAt, status: i.status, category: i.category, zone: i.zone,
        agency: i.agency, agencyRef: i.agencyRef, landmark: i.landmark, description: i.description,
        lat: i.lat, lng: i.lng, consent: i.consent, name: i.name, phone: i.phone, source: i.source,
        pendingReason: i.pendingReason, updatedAt: i.updatedAt }));
      return send(res, 200, toCsv(rows), { 'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${ward.id}-issues.csv"` });
    }
    if (m === 'GET' && sub === 'admin-issues') {
      if (!isAdmin(req)) return send(res, 401, { error: 'Admin key required' });
      return send(res, 200, db.issues.filter((i) => i.ward === ward.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    }
  }

  // /api/issues/:ticket  (public tracking, admin update, admin delete of records)
  if (p[1] === 'issues' && p[2]) {
    const issue = db.issues.find((i) => i.ticket.toUpperCase() === p[2].toUpperCase());
    if (!issue) return send(res, 404, { error: 'Ticket not found' });
    if (m === 'GET') return send(res, 200, publicIssue(issue));
    if (m === 'PATCH') {
      if (!isAdmin(req)) return send(res, 401, { error: 'Admin key required' });
      const b = await readJson(req);
      if (b.status && !STATUSES.includes(b.status)) return send(res, 400, { error: 'Bad status' });
      if (b.status === 'pending' && !clean(b.pendingReason) && !issue.pendingReason)
        return send(res, 400, { error: 'A reason is required for Pending' });
      if (b.agency && CONFIG.agencies.some((a) => a.id === b.agency)) issue.agency = b.agency;
      if (typeof b.agencyRef === 'string') issue.agencyRef = clean(b.agencyRef, 80);
      if (typeof b.pendingReason === 'string') issue.pendingReason = clean(b.pendingReason, 300);
      const after = savePhoto(b.afterPhoto); if (after) issue.afterPhoto = after;
      const ts = nowIso();
      if ((b.status && b.status !== issue.status) || clean(b.note)) {
        if (b.status) issue.status = b.status;
        issue.history.push({ at: ts, status: issue.status, note: clean(b.note, 300) });
      }
      issue.updatedAt = ts; save();
      return send(res, 200, issue);
    }
  }
  return send(res, 404, { error: 'Not found' });
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
      // SPA fallback for page routes
      if (!path.extname(rel)) return serveStatic(req, res, new URL('/index.html', url));
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

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, e.code >= 400 && e.code < 600 ? e.code : 500, { error: e.message || 'Server error' });
  }
}).listen(PORT, () => console.log(`Namma Ward running on http://localhost:${PORT}`));

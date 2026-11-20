// Demo backend for GitHub Pages (no server). Runs the same rules as the real
// server (core.js) but keeps data in this browser only. Admin key: "demo".
import { handle, ApiError, newIssue, applyPatch, newRecord, nextTicket } from './core.js';

const KEY = 'nw-demo-db-v1';
export const DEMO_ADMIN_KEY = 'demo';
let state = null;

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
}
function persist(db) {
  try { localStorage.setItem(KEY, JSON.stringify(db)); }
  catch { throw new ApiError(507, 'Demo storage on this phone is full. Clear site data to reset the demo.'); }
}

async function init() {
  if (state) return state;
  const config = await fetch('data/wards.json').then((r) => r.json());
  const db = load() || seed(config);
  persist(db);
  state = { db, config };
  return state;
}

export async function demoRequest(method, url, body, headers = {}) {
  const { db, config } = await init();
  const u = new URL(url, location.href);
  const io = {
    db, config,
    save: () => persist(db),
    savePhoto: (d) => (typeof d === 'string' && d.startsWith('data:image/') ? d : null),
    isAdmin: (h) => (h['x-admin-key'] || '') === DEMO_ADMIN_KEY,
    newId: () => Math.random().toString(16).slice(2, 14),
  };
  await new Promise((r) => setTimeout(r, 150)); // feel like a network call
  const out = await handle(io, method, u.pathname.slice(u.pathname.indexOf('/api/')), u.searchParams, body, headers);
  return JSON.parse(JSON.stringify(out.body)); // hand back a copy, like a real response
}

export function resetDemo() { localStorage.removeItem(KEY); state = null; }

// ---------- sample data so the map and stats are not empty ----------
function seed(config) {
  const db = { counters: {}, issues: [], updates: [], meetings: [], projects: [] };
  const day = 864e5, now = Date.now();
  const iso = (daysAgo, h = 10) => new Date(now - daysAgo * day + h * 36e5 - 12 * 36e5).toISOString();
  for (const ward of config.wards) {
    const [lat0, lng0] = ward.center;
    const z = (n) => ward.zones[n % ward.zones.length].id;
    const samples = [
      ['roads', 0, 'Deep pothole near the bus stop, two-wheelers swerving into traffic', 12, [['submitted', 11, 'Filed with the Corporation'], ['in_progress', 6, 'Patch work started'], ['resolved', 4, 'Road patched, photo taken']]],
      ['drainage', 1, 'Drain overflows on the main road after every rain', 9, [['submitted', 8, 'Filed with the Corporation'], ['in_progress', 3, 'Desilting scheduled']]],
      ['garbage', 2, 'Garbage black spot at the corner, not cleared for a week', 7, [['submitted', 7, 'Reported to waste contractor'], ['resolved', 5, 'Spot cleared']]],
      ['streetlight', 3, 'Three streetlights not working on the cross road', 6, [['submitted', 5, 'BESCOM complaint raised']]],
      ['water', 1, 'Water comes only once in three days on this street', 5, [['pending', 2, 'Waiting for BWSSB to inspect the line']]],
      ['footpath', 0, 'Broken footpath slabs, unsafe for senior citizens', 4, []],
      ['parking', 4, 'Roadside parking blocks the lane during school hours', 3, [['submitted', 2, 'Shared with traffic police']]],
      ['garbage', 3, 'Mixed waste dumped behind the park', 2, []],
      ['roads', 2, 'Road dug for a pipeline and not restored', 1, [['submitted', 1, 'Filed with the Corporation']]],
      ['safety', 4, 'Dark stretch near the playground, needs a light and patrol', 1, []],
    ];
    samples.forEach(([cat, zi, desc, ago, steps], n) => {
      const b = { category: cat, zone: z(zi), description: desc, createdAt: iso(ago),
        lat: lat0 + Math.sin(n * 2.1) * 0.004, lng: lng0 + Math.cos(n * 1.7) * 0.005, consent: false };
      const issue = newIssue(config, ward, b, nextTicket(db, ward), null);
      for (const [status, a, note] of steps) {
        applyPatch(config, issue, { status, note, pendingReason: status === 'pending' ? note : undefined }, null, iso(a, 15));
      }
      db.issues.push(issue);
    });
    const rec = (kind, b) => db[kind].push(newRecord(kind, ward, b, null, Math.random().toString(16).slice(2, 14)));
    rec('updates', { title: 'Weekly ward help desk this Saturday', date: iso(-2).slice(0, 10),
      body: 'Bring your complaint or ticket number. Volunteers will help you file it with the right agency.' });
    rec('updates', { title: 'Sample update: drain desilting drive', date: iso(3).slice(0, 10),
      body: 'This is sample text for the demo. Real updates are posted by the ward team with a source.' });
    rec('meetings', { title: 'Area meeting: roads and drains', date: iso(-5).slice(0, 16).replace('T', ' '),
      place: 'Community hall (sample)', body: 'Residents can raise road and drain issues street by street.' });
    rec('projects', { title: 'Sample record: road resurfacing', status: 'not_verified', agency: 'gba',
      location: 'Sample street', workOrder: 'SAMPLE-000', amount: 'Sample',
      source: 'Demo data only. Real records need a work order and official source.' });
  }
  return db;
}

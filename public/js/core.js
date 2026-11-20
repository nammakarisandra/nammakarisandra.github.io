// Complaint rules shared by the Node server and the in-browser demo backend,
// so both behave exactly the same. No DOM and no Node APIs in this file.

export const STATUSES = ['new', 'submitted', 'in_progress', 'resolved', 'pending'];
export const PROJECT_STATUSES = ['completed', 'partial', 'proposed', 'follow_up', 'not_verified'];

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const clean = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export const nowIso = () => new Date().toISOString();

export function nextTicket(db, ward) {
  db.counters[ward.id] = (db.counters[ward.id] || 0) + 1;
  return `${ward.code}-${String(db.counters[ward.id]).padStart(5, '0')}`;
}

// Validate a resident's report and build the stored record.
export function newIssue(config, ward, b, ticket, photo) {
  const cat = config.categories.find((c) => c.id === b.category);
  if (!cat) throw new ApiError(400, 'Choose a category');
  if (!ward.zones.some((z) => z.id === b.zone)) throw new ApiError(400, 'Choose an area');
  const description = clean(b.description, 1000);
  if (description.length < 5) throw new ApiError(400, 'Describe the issue');
  const lat = Number(b.lat), lng = Number(b.lng);
  const hasGeo = b.lat != null && b.lng != null && Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const consent = b.consent === true;
  const ts = b.createdAt || nowIso();
  return {
    ticket, clientId: clean(b.clientId, 64), ward: ward.id,
    category: cat.id, zone: b.zone, description, landmark: clean(b.landmark, 200),
    lat: hasGeo ? lat : null, lng: hasGeo ? lng : null,
    photo: photo || null, afterPhoto: null,
    // Contact details are kept only when the resident gives consent.
    name: consent ? clean(b.name, 80) : '', phone: consent ? clean(b.phone, 20) : '',
    consent, language: b.language === 'kn' ? 'kn' : 'en',
    source: b.source === 'volunteer' ? 'volunteer' : 'resident',
    status: 'new', agency: cat.agency, agencyRef: '', pendingReason: '',
    history: [{ at: ts, status: 'new', note: 'Reported' }], createdAt: ts, updatedAt: ts,
  };
}

export function validatePatch(issue, b) {
  if (b.status && !STATUSES.includes(b.status)) throw new ApiError(400, 'Bad status');
  if (b.status === 'pending' && !clean(b.pendingReason) && !issue.pendingReason)
    throw new ApiError(400, 'A reason is required for Pending');
}

// Ward team update to a complaint. Mutates and returns the issue.
export function applyPatch(config, issue, b, afterPhoto, at = nowIso()) {
  validatePatch(issue, b);
  if (b.agency && config.agencies.some((a) => a.id === b.agency)) issue.agency = b.agency;
  if (typeof b.agencyRef === 'string') issue.agencyRef = clean(b.agencyRef, 80);
  if (typeof b.pendingReason === 'string') issue.pendingReason = clean(b.pendingReason, 300);
  if (afterPhoto) issue.afterPhoto = afterPhoto;
  if ((b.status && b.status !== issue.status) || clean(b.note)) {
    if (b.status) issue.status = b.status;
    issue.history.push({ at, status: issue.status, note: clean(b.note, 300) });
  }
  issue.updatedAt = at;
  return issue;
}

// Update, meeting or verified-work record.
export function newRecord(kind, ward, b, evidence, id) {
  const rec = { id, ward: ward.id, createdAt: nowIso(),
    title: clean(b.title, 200), body: clean(b.body, 2000), date: clean(b.date, 30),
    place: clean(b.place, 200), source: clean(b.source, 300) };
  if (!rec.title) throw new ApiError(400, 'Title is required');
  if (kind === 'projects') {
    Object.assign(rec, { workOrder: clean(b.workOrder, 80), agency: clean(b.agency, 20),
      amount: clean(b.amount, 40), location: clean(b.location, 200),
      status: PROJECT_STATUSES.includes(b.status) ? b.status : 'not_verified',
      evidence: evidence || null });
  }
  return rec;
}

// Public view: never expose name, phone or exact location of a resident.
export function publicIssue(i) {
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

export function stats(issues) {
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  const byCategory = {}, byAgency = {}, byZone = {};
  const ackHours = [], resolveDays = [];
  for (const i of issues) {
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
    total: issues.length, byStatus, byCategory, byAgency, byZone,
    acknowledgementRate: issues.length ? Math.round(((issues.length - byStatus.new) / issues.length) * 100) : 0,
    medianAckHours: median(ackHours), medianResolveDays: median(resolveDays),
    withPhoto: issues.filter((i) => i.photo).length,
    geoTagged: issues.filter((i) => i.lat != null).length,
    optInContacts: issues.filter((i) => i.consent).length,
  };
}

export function issuesCsv(issues) {
  const rows = issues.map((i) => ({
    ticket: i.ticket, createdAt: i.createdAt, status: i.status, category: i.category, zone: i.zone,
    agency: i.agency, agencyRef: i.agencyRef, landmark: i.landmark, description: i.description,
    lat: i.lat, lng: i.lng, consent: i.consent, name: i.name, phone: i.phone, source: i.source,
    pendingReason: i.pendingReason, updatedAt: i.updatedAt }));
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const cols = Object.keys(rows[0] || { ticket: '' });
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

const byNewest = (a, b) => (b.date || b.createdAt).localeCompare(a.date || a.createdAt);

// One router for both backends. `io` supplies storage-specific pieces:
// { db, config, save(), savePhoto(dataUrl), newId(), isAdmin(headers), limited() }
export async function handle(io, method, pathname, query, body, headers) {
  const { db, config } = io;
  const p = pathname.split('/').filter(Boolean); // ['api', ...]
  const m = method;
  if (m === 'GET' && p[1] === 'config') return { status: 200, body: config };

  if (p[1] === 'wards' && p[2]) {
    const ward = config.wards.find((w) => w.id === p[2]);
    if (!ward) throw new ApiError(404, 'Unknown ward');
    const sub = p[3];
    const wardIssues = () => db.issues.filter((i) => i.ward === ward.id);

    if (m === 'GET' && sub === 'issues') {
      const st = query.get('status');
      return { status: 200, body: wardIssues().filter((i) => !st || i.status === st)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 500).map(publicIssue) };
    }
    if (m === 'POST' && sub === 'issues') {
      if (io.limited?.()) throw new ApiError(429, 'Too many reports. Please try again later.');
      const b = body || {};
      // Offline re-sends: return the existing ticket instead of duplicating.
      const cid = clean(b.clientId, 64);
      const dup = cid && db.issues.find((i) => i.clientId === cid);
      if (dup) return { status: 200, body: { ticket: dup.ticket } };
      newIssue(config, ward, b, 'check', null); // validate before saving any photo
      const issue = newIssue(config, ward, b, nextTicket(db, ward), await io.savePhoto(b.photo));
      db.issues.push(issue); await io.save();
      return { status: 201, body: { ticket: issue.ticket } };
    }
    if (m === 'GET' && sub === 'stats') return { status: 200, body: stats(wardIssues()) };
    if (['updates', 'meetings', 'projects'].includes(sub)) {
      if (m === 'GET') return { status: 200, body: db[sub].filter((x) => x.ward === ward.id).sort(byNewest) };
      if (m === 'POST') {
        if (!io.isAdmin(headers)) throw new ApiError(401, 'Admin key required');
        const b = body || {};
        newRecord(sub, ward, b, null, 'check');
        const rec = newRecord(sub, ward, b, sub === 'projects' ? await io.savePhoto(b.photo) : null, io.newId());
        db[sub].push(rec); await io.save();
        return { status: 201, body: rec };
      }
    }
    if (m === 'GET' && (sub === 'export.csv' || sub === 'admin-issues')) {
      if (!io.isAdmin(headers)) throw new ApiError(401, 'Admin key required');
      const list = wardIssues().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      if (sub === 'admin-issues') return { status: 200, body: list };
      return { status: 200, body: issuesCsv(list), csv: `${ward.id}-issues.csv` };
    }
  }

  if (p[1] === 'issues' && p[2]) {
    const issue = db.issues.find((i) => i.ticket.toUpperCase() === p[2].toUpperCase());
    if (!issue) throw new ApiError(404, 'Ticket not found');
    if (m === 'GET') return { status: 200, body: publicIssue(issue) };
    if (m === 'PATCH') {
      if (!io.isAdmin(headers)) throw new ApiError(401, 'Admin key required');
      const b = body || {};
      validatePatch(issue, b); // before saving any photo
      applyPatch(config, issue, b, await io.savePhoto(b.afterPhoto));
      await io.save();
      return { status: 200, body: issue };
    }
  }
  throw new ApiError(404, 'Not found');
}

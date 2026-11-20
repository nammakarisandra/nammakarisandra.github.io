import { STRINGS } from './i18n.js';
import { api, submitIssue, flushOutbox, outbox, resizeImage, DEMO } from './api.js';

// ---------- state ----------
const ls = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const S = { config: null, ward: null, lang: ls.get('lang', 'en'), map: null };
const t = (k) => STRINGS[S.lang][k] ?? STRINGS.en[k] ?? k;
const L = (o) => (o ? o[S.lang] || o.en : '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, el = document) => el.querySelector(sel);
const view = () => $('#view');
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString(S.lang === 'kn' ? 'kn-IN' : 'en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const cat = (id) => S.config.categories.find((c) => c.id === id);
const agency = (id) => S.config.agencies.find((a) => a.id === id);
const zone = (id) => S.ward.zones.find((z) => z.id === id);
const STATUS_COLORS = { new: '#6b7280', submitted: '#2563eb', in_progress: '#d97706', resolved: '#16a34a', pending: '#dc2626' };
const badge = (s) => `<span class="badge" style="--c:${STATUS_COLORS[s]}">${esc(t('status_' + s))}</span>`;

function toast(msg, ms = 5000) {
  const el = $('#toast'); el.textContent = msg; el.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => (el.hidden = true), ms);
}

// ---------- shell ----------
function renderShell() {
  document.documentElement.lang = S.lang === 'kn' ? 'kn' : 'en';
  $('#brand').textContent = S.config.app.name;
  $('#wardSelect').innerHTML = S.config.wards.map((w) =>
    `<option value="${esc(w.id)}" ${w.id === S.ward.id ? 'selected' : ''}>${esc(L(w))}</option>`).join('');
  $('#langBtn').textContent = S.lang === 'en' ? 'ಕನ್ನಡ' : 'English';
  $('#installBtn').textContent = t('install');
  $('#demo').textContent = t('demoBanner');
  document.querySelectorAll('[data-nav]').forEach((a) => {
    a.textContent = t('nav_' + a.dataset.nav);
  });
}

const TILES = [
  ['report', '📝'], ['track', '🔎'], ['map', '🗺️'], ['updates', '📢'],
  ['projects', '🏗️'], ['meetings', '📅'], ['services', '☎️'], ['dashboard', '📊'],
];

// ---------- pages ----------
const pages = {
  async home() {
    const b = S.ward.baseline;
    const stats = await api.get(`/api/wards/${S.ward.id}/stats`).catch(() => null);
    const open = stats ? stats.byStatus.new + stats.byStatus.submitted + stats.byStatus.in_progress + stats.byStatus.pending : '-';
    view().innerHTML = `
      <section class="hero">
        ${S.config.app.partyLogo ? `<div class="party">
          <img src="${esc(S.config.app.partyLogo)}" alt="${esc(L(S.config.app.partyName))} logo" onerror="this.parentElement.remove()">
          <span>${esc(L(S.config.app.partyName))}</span></div>` : ''}
        <h1>${esc(L(S.ward))}</h1>
        <p class="muted">${esc(L(S.ward.assembly))}</p>
        ${S.ward.mla ? `<div class="mla">
          ${S.ward.mla.photo ? `<img src="${esc(S.ward.mla.photo)}" alt="${esc(L(S.ward.mla))}" onerror="this.remove()">` : ''}
          <span>${esc(t('mla'))}: <b>${esc(L(S.ward.mla))}</b></span></div>` : ''}
        <p class="tagline">${esc(t('appTagline'))}</p>
        <div class="kpis">
          <div><b>${stats ? stats.total : '-'}</b><span>${esc(t('total'))}</span></div>
          <div><b>${open}</b><span>${esc(t('openIssues'))}</span></div>
          <div><b>${stats ? stats.byStatus.resolved : '-'}</b><span>${esc(t('status_resolved'))}</span></div>
        </div>
      </section>
      <nav class="tiles">
        ${TILES.map(([k, icon]) => `<a class="tile ${k === 'report' ? 'primary' : ''}" href="#/${k}">
          <span class="ti">${icon}</span><b>${esc(t(k))}</b><small>${esc(t(k + 'Sub'))}</small></a>`).join('')}
      </nav>
      ${b ? `<section class="card"><h3>${esc(t('baseline'))}</h3>
        <div class="kpis small"><div><b>${b.households.toLocaleString('en-IN')}</b><span>${esc(t('households'))}</span></div>
        <div><b>${b.population.toLocaleString('en-IN')}</b><span>${esc(t('population'))}</span></div>
        <div><b>${b.voters.toLocaleString('en-IN')}</b><span>${esc(t('voters'))}</span></div></div>
        <p class="muted small">${esc(t('source'))}: ${esc(b.source)}</p></section>` : ''}
      <p class="muted small center">${esc(t('privacyNote'))}</p>`;
  },

  report() {
    const draft = { lat: null, lng: null, photo: null };
    view().innerHTML = `
      <h2>${esc(t('report'))}</h2>
      <form id="rf" class="card form" novalidate>
        <fieldset><legend class="req">${esc(t('category'))}</legend>
          <div class="chips">${S.config.categories.map((c) => `
            <label class="chip"><input type="radio" name="category" value="${c.id}" required>
            <span>${c.icon} ${esc(L(c))}</span></label>`).join('')}</div></fieldset>
        <label class="req">${esc(t('area'))}
          <select name="zone" required><option value=""></option>
          ${S.ward.zones.map((z) => `<option value="${z.id}">${esc(L(z))}</option>`).join('')}</select></label>
        <label class="req">${esc(t('description'))}
          <textarea name="description" rows="3" minlength="5" maxlength="1000" required placeholder="${esc(t('descPh'))}"></textarea></label>
        <label>${esc(t('landmark'))}<input name="landmark" maxlength="200"></label>
        <div><span class="lbl">${esc(t('location'))}</span>
          <button type="button" class="btn ghost" id="gps">📍 ${esc(t('useGps'))}</button>
          <p class="muted small">${esc(t('tapMap'))}</p>
          <div id="pickmap" class="map small"></div></div>
        <label>${esc(t('photo'))}
          <input type="file" name="photo" accept="image/*" capture="environment"></label>
        <img id="preview" class="preview" hidden alt="">
        <fieldset><legend>${esc(t('contactTitle'))}</legend>
          <label class="check"><input type="checkbox" name="consent"> ${esc(t('consent'))}</label>
          <div id="contact" hidden>
            <label>${esc(t('name'))}<input name="name" maxlength="80" autocomplete="name"></label>
            <label>${esc(t('phone'))}<input name="phone" type="tel" maxlength="15" pattern="[0-9+ ]{10,15}" autocomplete="tel"></label>
          </div></fieldset>
        <label class="check"><input type="checkbox" name="volunteer"> ${esc(t('volunteer'))}</label>
        <p class="muted small">${esc(t('privacyNote'))}</p>
        <button class="btn primary big" id="submitBtn">${esc(t('submit'))}</button>
      </form>`;

    const f = $('#rf');
    const map = makeMap('pickmap');
    let marker = null;
    const place = (lat, lng) => {
      draft.lat = lat; draft.lng = lng;
      if (!map) return;
      marker ? marker.setLatLng([lat, lng]) : (marker = L_.marker([lat, lng]).addTo(map));
    };
    map?.on('click', (e) => place(e.latlng.lat, e.latlng.lng));
    $('#gps').onclick = () => navigator.geolocation?.getCurrentPosition(
      (p) => { place(p.coords.latitude, p.coords.longitude); map?.setView([p.coords.latitude, p.coords.longitude], 17); },
      () => toast(t('gpsFailed')), { enableHighAccuracy: true, timeout: 10000 });
    f.consent.onchange = () => ($('#contact').hidden = !f.consent.checked);
    f.photo.onchange = async () => {
      const file = f.photo.files[0]; if (!file) return;
      draft.photo = await resizeImage(file);
      $('#preview').src = draft.photo; $('#preview').hidden = false;
    };
    f.onsubmit = async (e) => {
      e.preventDefault();
      f.classList.add('touched');
      if (!f.checkValidity()) { toast(t('required')); return; }
      const btn = $('#submitBtn'); btn.disabled = true; btn.textContent = t('submitting');
      const payload = {
        category: f.category.value, zone: f.zone.value, description: f.description.value,
        landmark: f.landmark.value, lat: draft.lat, lng: draft.lng, photo: draft.photo,
        consent: f.consent.checked, name: f.consent.checked ? f.name.value : '',
        phone: f.consent.checked ? f.phone.value : '', language: S.lang,
        source: f.volunteer.checked ? 'volunteer' : 'resident',
      };
      try {
        const r = await submitIssue(S.ward.id, payload);
        if (r.queued) { view().innerHTML = `<div class="card done"><h2>📶 ${esc(t('offline'))}</h2><p>${esc(t('savedOffline'))}</p><a class="btn" href="#/">${esc(t('home'))}</a></div>`; updatePending(); return; }
        rememberTicket(r.ticket);
        view().innerHTML = `<div class="card done"><h2>✅ ${esc(t('thanks'))}</h2>
          <p>${esc(t('yourTicket'))}</p><p class="ticket">${esc(r.ticket)}</p>
          <a class="btn primary" href="#/track/${esc(r.ticket)}">${esc(t('track'))}</a>
          <a class="btn ghost" href="#/report">${esc(t('report'))}</a></div>`;
      } catch (err) { toast(err.message); btn.disabled = false; btn.textContent = t('submit'); }
    };
  },

  async track(ticket) {
    const mine = ls.get('tickets', []);
    view().innerHTML = `
      <h2>${esc(t('track'))}</h2>
      <form id="tf" class="card row"><input name="ticket" placeholder="${esc(t('ticketPh'))}" value="${esc(ticket || '')}" required>
        <button class="btn primary">${esc(t('check'))}</button></form>
      <div id="result"></div>
      ${mine.length ? `<section class="card"><h3>${esc(t('myTickets'))}</h3>
        ${mine.map((k) => `<a class="pill" href="#/track/${esc(k)}">${esc(k)}</a>`).join(' ')}</section>` : ''}`;
    $('#tf').onsubmit = (e) => { e.preventDefault(); location.hash = `#/track/${encodeURIComponent($('#tf').ticket.value.trim())}`; };
    if (!ticket) return;
    try {
      const i = await api.get(`/api/issues/${encodeURIComponent(ticket)}`);
      const c = cat(i.category);
      $('#result').innerHTML = `<article class="card">
        <div class="row between"><h3>${c?.icon || ''} ${esc(L(c))}</h3>${badge(i.status)}</div>
        <p class="ticket sm">${esc(i.ticket)}</p>
        <p>${esc(i.description)}</p>
        <dl class="meta">
          <dt>${esc(t('area'))}</dt><dd>${esc(L(zone(i.zone)))}${i.landmark ? ', ' + esc(i.landmark) : ''}</dd>
          <dt>${esc(t('agency'))}</dt><dd>${esc(L(agency(i.agency)))}${i.agencyRef ? ` (${esc(t('agencyRef'))}: ${esc(i.agencyRef)})` : ''}</dd>
          ${i.status === 'pending' && i.pendingReason ? `<dt>${esc(t('pendingReason'))}</dt><dd>${esc(i.pendingReason)}</dd>` : ''}
          <dt>${esc(t('reported'))}</dt><dd>${fmtDate(i.createdAt)}</dd>
          <dt>${esc(t('lastUpdate'))}</dt><dd>${fmtDate(i.updatedAt)}</dd></dl>
        ${i.photo || i.afterPhoto ? `<div class="ba">
          ${i.photo ? `<figure><img src="${esc(i.photo)}" alt=""><figcaption>${esc(t('before'))}</figcaption></figure>` : ''}
          ${i.afterPhoto ? `<figure><img src="${esc(i.afterPhoto)}" alt=""><figcaption>${esc(t('after'))}</figcaption></figure>` : ''}</div>` : ''}
        <h4>${esc(t('history'))}</h4>
        <ol class="timeline">${i.history.map((h) => `<li>${badge(h.status)} <small>${fmtDate(h.at)}</small>${h.note ? `<div>${esc(h.note)}</div>` : ''}</li>`).join('')}</ol>
      </article>`;
    } catch { $('#result').innerHTML = `<p class="card warn">${esc(t('notFound'))}</p>`; }
  },

  async map() {
    view().innerHTML = `<h2>${esc(t('map'))}</h2>
      <div class="row wrap" id="filters"></div>
      <div id="bigmap" class="map big"></div>
      <p class="muted small">${esc(t('mapNote'))}</p>`;
    const issues = await api.get(`/api/wards/${S.ward.id}/issues`);
    const map = makeMap('bigmap');
    if (!map) return;
    const layer = L_.layerGroup().addTo(map);
    const draw = (status) => {
      layer.clearLayers();
      issues.filter((i) => i.lat != null && (!status || i.status === status)).forEach((i) => {
        const c = cat(i.category);
        L_.circleMarker([i.lat, i.lng], { radius: 9, color: STATUS_COLORS[i.status], fillOpacity: 0.55, weight: 2 })
          .bindPopup(`<b>${c?.icon || ''} ${esc(L(c))}</b><br>${badge(i.status)}<br><a href="#/track/${esc(i.ticket)}">${esc(i.ticket)}</a>`)
          .addTo(layer);
      });
    };
    const opts = ['', 'new', 'submitted', 'in_progress', 'pending', 'resolved'];
    $('#filters').innerHTML = opts.map((s) => `<button class="pill ${s ? '' : 'on'}" data-s="${s}">${esc(s ? t('status_' + s) : t('allStatuses'))}</button>`).join('');
    $('#filters').onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      document.querySelectorAll('#filters .pill').forEach((x) => x.classList.toggle('on', x === b));
      draw(b.dataset.s);
    };
    draw('');
  },

  async updates() { await listPage('updates', 'noUpdates', (u) => `
      <article class="card"><small class="muted">${esc(u.date || fmtDate(u.createdAt))}</small>
      <h3>${esc(u.title)}</h3><p>${esc(u.body)}</p>
      ${u.source ? `<p class="muted small">${esc(t('source'))}: ${linkify(u.source)}</p>` : ''}</article>`); },

  async meetings() { await listPage('meetings', 'noMeetings', (m) => `
      <article class="card"><h3>📅 ${esc(m.title)}</h3>
      <p><b>${esc(m.date)}</b>${m.place ? ` · ${esc(m.place)}` : ''}</p><p>${esc(m.body)}</p></article>`); },

  async projects() { await listPage('projects', 'noProjects', (p) => `
      <article class="card"><div class="row between"><h3>${esc(p.title)}</h3>
      <span class="badge" style="--c:${p.status === 'completed' ? '#16a34a' : p.status === 'not_verified' ? '#6b7280' : '#d97706'}">${esc(t('project_' + p.status))}</span></div>
      <dl class="meta">
        ${p.location ? `<dt>${esc(t('location'))}</dt><dd>${esc(p.location)}</dd>` : ''}
        ${p.workOrder ? `<dt>${esc(t('workOrder'))}</dt><dd>${esc(p.workOrder)}</dd>` : ''}
        ${p.agency ? `<dt>${esc(t('agency'))}</dt><dd>${esc(L(agency(p.agency)) || p.agency)}</dd>` : ''}
        ${p.amount ? `<dt>${esc(t('amount'))}</dt><dd>${esc(p.amount)}</dd>` : ''}
        ${p.date ? `<dt>${esc(t('lastUpdate'))}</dt><dd>${esc(p.date)}</dd>` : ''}
        ${p.source ? `<dt>${esc(t('source'))}</dt><dd>${linkify(p.source)}</dd>` : ''}</dl>
      ${p.body ? `<p>${esc(p.body)}</p>` : ''}
      ${p.evidence ? `<img class="preview" src="${esc(p.evidence)}" alt="">` : ''}</article>`); },

  services() {
    view().innerHTML = `<h2>${esc(t('services'))}</h2>
      <div class="list">${S.ward.services.map((s) => `
        <div class="card row between"><span>${esc(L(s))}</span>
        <a class="btn primary" href="tel:${esc(s.phone)}">📞 ${esc(s.phone)}</a></div>`).join('')}</div>`;
  },

  async dashboard() {
    const s = await api.get(`/api/wards/${S.ward.id}/stats`);
    const max = Math.max(1, ...Object.values(s.byCategory));
    view().innerHTML = `<h2>${esc(t('dashboard'))} · ${esc(L(S.ward))}</h2>
      <section class="kpis">
        <div><b>${s.total}</b><span>${esc(t('total'))}</span></div>
        <div><b>${s.acknowledgementRate}%</b><span>${esc(t('ackRate'))}</span></div>
        <div><b>${s.medianAckHours ?? '-'}</b><span>${esc(t('medianAck'))}</span></div>
        <div><b>${s.medianResolveDays ?? '-'}</b><span>${esc(t('medianResolve'))}</span></div>
        <div><b>${s.geoTagged}</b><span>${esc(t('geoTagged'))}</span></div>
      </section>
      <section class="card"><div class="pipeline">
        ${Object.entries(s.byStatus).map(([k, v]) => `<div style="--c:${STATUS_COLORS[k]}"><b>${v}</b><span>${esc(t('status_' + k))}</span></div>`).join('')}
      </div></section>
      <section class="card"><h3>${esc(t('byCategory'))}</h3>
        ${Object.entries(s.byCategory).sort((a, b) => b[1] - a[1]).map(([k, v]) => `
          <div class="bar"><span>${cat(k)?.icon || ''} ${esc(L(cat(k)))}</span>
          <div><i style="width:${(v / max) * 100}%"></i></div><b>${v}</b></div>`).join('') || `<p class="muted">-</p>`}</section>
      <section class="card"><h3>${esc(t('byAgency'))}</h3>
        <table class="tbl">${Object.entries(s.byAgency).map(([k, v]) => `
          <tr><td>${esc(L(agency(k)))}</td><td>${v.total}</td><td>${v.resolved} ${esc(t('resolved'))}</td></tr>`).join('')}</table></section>`;
  },
};

async function listPage(kind, emptyKey, card) {
  view().innerHTML = `<h2>${esc(t(kind))}</h2><div class="list" id="list"></div>`;
  const items = await api.get(`/api/wards/${S.ward.id}/${kind}`);
  $('#list').innerHTML = items.length ? items.map(card).join('') : `<p class="card muted">${esc(t(emptyKey))}</p>`;
}
function linkify(s) {
  return /^https?:\/\//.test(s) ? `<a href="${esc(s)}" target="_blank" rel="noopener">${esc(s)}</a>` : esc(s);
}
function rememberTicket(k) { ls.set('tickets', [k, ...ls.get('tickets', []).filter((x) => x !== k)].slice(0, 20)); }

// Leaflet is loaded from a CDN; when offline and not cached the map is skipped.
const L_ = window.L;
function makeMap(elId) {
  if (!window.L) { $('#' + elId).innerHTML = `<p class="muted small">Map unavailable offline.</p>`; return null; }
  const m = window.L.map(elId).setView(S.ward.center, S.ward.zoom);
  window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(m);
  return m;
}

// ---------- router ----------
async function route() {
  const [, page = '', arg] = location.hash.split('/');
  const fn = pages[page] || pages.home;
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === (page || 'home')));
  try { await fn(arg && decodeURIComponent(arg)); } catch (e) { view().innerHTML = `<p class="card warn">${esc(e.message)}</p>`; }
  window.scrollTo(0, 0);
}

async function updatePending() {
  const n = (await outbox.all().catch(() => [])).length;
  const el = $('#pending'); el.hidden = !n; el.textContent = `⏳ ${n} ${t('pendingSync')}`;
}

// ---------- boot ----------
async function boot() {
  S.config = await api.get('/api/config');
  const params = new URLSearchParams(location.search);
  const wanted = params.get('ward') || ls.get('ward');
  S.ward = S.config.wards.find((w) => w.id === wanted) || S.config.wards[0];
  renderShell();
  if (DEMO) { $('#demo').hidden = false; }
  $('#wardSelect').onchange = (e) => { S.ward = S.config.wards.find((w) => w.id === e.target.value); ls.set('ward', S.ward.id); renderShell(); route(); };
  $('#langBtn').onclick = () => { S.lang = S.lang === 'en' ? 'kn' : 'en'; ls.set('lang', S.lang); renderShell(); route(); updatePending(); };
  window.addEventListener('hashchange', route);
  const sync = () => flushOutbox((ticket) => { rememberTicket(ticket); toast(`${t('thanks')} ${ticket}`); }).then(updatePending);
  window.addEventListener('online', () => { $('#offline').hidden = true; sync(); });
  window.addEventListener('offline', () => ($('#offline').hidden = false));
  $('#offline').hidden = navigator.onLine; $('#offline').textContent = t('offline');
  sync();
  route();
}

// PWA install prompt and service worker
let deferred;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; $('#installBtn').hidden = false; });
$('#installBtn').onclick = async () => { deferred?.prompt(); deferred = null; $('#installBtn').hidden = true; };
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');

boot().catch((e) => { view().innerHTML = `<p class="card warn">${esc(e.message)}</p>`; });

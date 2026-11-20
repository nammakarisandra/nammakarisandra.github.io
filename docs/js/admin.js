import { api, resizeImage, DEMO } from './api.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATUSES = { new: 'New', submitted: 'Submitted to agency', in_progress: 'In progress', resolved: 'Resolved', pending: 'Pending' };
const PROJECT = { completed: 'Completed', partial: 'Partially completed', proposed: 'Proposed', follow_up: 'Under follow-up', not_verified: 'Not independently verified' };
let config, wardId, key = sessionStorage.getItem('nw-admin') || '';
const H = () => ({ 'x-admin-key': key });
const toast = (m) => { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.x); toast.x = setTimeout(() => (t.hidden = true), 5000); };
const opts = (obj, sel) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(v)}</option>`).join('');
const nameOf = (list, id) => list.find((x) => x.id === id)?.en || id;

async function issuesPane() {
  const issues = await api.get(`/api/wards/${wardId}/admin-issues`, H());
  const ward = config.wards.find((w) => w.id === wardId);
  $('#pane').innerHTML = `
    <div class="row wrap"><select id="fStatus"><option value="">All statuses</option>${opts(STATUSES)}</select>
      <select id="fCat"><option value="">All categories</option>${config.categories.map((c) => `<option value="${c.id}">${esc(c.en)}</option>`).join('')}</select>
      <span class="muted small">${issues.length} complaints</span></div>
    <div id="ilist"></div>`;
  const draw = () => {
    const s = $('#fStatus').value, c = $('#fCat').value;
    $('#ilist').innerHTML = issues.filter((i) => (!s || i.status === s) && (!c || i.category === c)).map((i) => `
      <form class="card issue" data-t="${esc(i.ticket)}">
        <div class="row between"><b>${esc(i.ticket)} · ${esc(nameOf(config.categories, i.category))}</b>
          <small class="muted">${new Date(i.createdAt).toLocaleString('en-IN')} · ${esc(i.source)}</small></div>
        <div>${esc(i.description)}</div>
        <div class="muted small">${esc(nameOf(ward.zones, i.zone))}${i.landmark ? ' · ' + esc(i.landmark) : ''}
          ${i.lat != null ? ` · <a target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${i.lat}&mlon=${i.lng}#map=18/${i.lat}/${i.lng}">map</a>` : ''}</div>
        ${i.consent && (i.name || i.phone) ? `<div class="pii">Contact (consented, for this complaint only): ${esc(i.name)} ${i.phone ? `<a href="tel:${esc(i.phone)}">${esc(i.phone)}</a>` : ''}</div>` : ''}
        <div class="row">${i.photo ? `<img src="${esc(i.photo)}" alt="before">` : ''}${i.afterPhoto ? `<img src="${esc(i.afterPhoto)}" alt="after">` : ''}</div>
        <div class="grid">
          <label>Status<select name="status">${opts(STATUSES, i.status)}</select></label>
          <label>Agency<select name="agency">${config.agencies.map((a) => `<option value="${a.id}" ${a.id === i.agency ? 'selected' : ''}>${esc(a.en)}</option>`).join('')}</select></label>
          <label>Agency complaint ref<input name="agencyRef" value="${esc(i.agencyRef)}"></label>
          <label>Pending reason<input name="pendingReason" value="${esc(i.pendingReason)}"></label>
          <label>Note for timeline<input name="note" placeholder="Shown publicly"></label>
          <label>After photo<input type="file" name="after" accept="image/*"></label>
        </div>
        <button class="btn primary">Save</button>
      </form>`).join('') || '<p class="card muted">No complaints match.</p>';
  };
  $('#fStatus').onchange = $('#fCat').onchange = draw;
  $('#ilist').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, b = Object.fromEntries(['status', 'agency', 'agencyRef', 'pendingReason', 'note'].map((k) => [k, f[k].value]));
    if (f.after.files[0]) b.afterPhoto = await resizeImage(f.after.files[0]);
    try {
      const updated = await api.patch(`/api/issues/${f.dataset.t}`, b, H());
      Object.assign(issues.find((x) => x.ticket === updated.ticket), updated);
      toast(`${updated.ticket} saved`); draw();
    } catch (err) { toast(err.message); }
  };
  draw();
}

function recordPane(kind) {
  const project = kind === 'projects';
  $('#pane').innerHTML = `<form class="card form" id="rf">
    <h3>${{ updates: 'Post a ward update', meetings: 'Add a meeting or help desk', projects: 'Add a verified work record' }[kind]}</h3>
    <label class="req">Title<input name="title" required maxlength="200"></label>
    <label>${kind === 'meetings' ? 'Date and time' : 'Date'}<input name="date" ${kind === 'meetings' ? 'type="datetime-local"' : 'type="date"'}></label>
    ${kind === 'meetings' ? '<label>Place<input name="place"></label>' : ''}
    ${project ? `<label>Location<input name="location"></label>
      <label>Work order number<input name="workOrder"></label>
      <label>Agency<select name="agency">${config.agencies.map((a) => `<option value="${a.id}">${esc(a.en)}</option>`).join('')}</select></label>
      <label>Sanctioned amount<input name="amount" placeholder="Rs 12,50,000"></label>
      <label>Status<select name="status">${opts(PROJECT, 'not_verified')}</select></label>
      <label>Completion evidence photo<input type="file" name="photo" accept="image/*"></label>` : ''}
    <label>Details<textarea name="body" rows="4"></textarea></label>
    <label ${project ? 'class="req"' : ''}>Source (document or link)<input name="source" ${project ? 'required' : ''}></label>
    <p class="muted small">Publish only facts backed by a source. Use the same template for every candidate.</p>
    <button class="btn primary">Publish</button></form>`;
  $('#rf').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    if (!f.checkValidity()) { f.classList.add('touched'); return; }
    const b = Object.fromEntries([...new FormData(f)].filter(([, v]) => typeof v === 'string'));
    if (project && f.photo.files[0]) b.photo = await resizeImage(f.photo.files[0]);
    try { await api.post(`/api/wards/${wardId}/${kind}`, b, H()); toast('Published'); f.reset(); }
    catch (err) { toast(err.message); }
  };
}

async function open(tab = 'issues') {
  document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  try { tab === 'issues' ? await issuesPane() : recordPane(tab); }
  catch (e) { if (e.status === 401) { sessionStorage.removeItem('nw-admin'); key = ''; show(); toast('Wrong admin key'); } else toast(e.message); }
}
function show() { $('#login').hidden = !!key; $('#app').hidden = !key; if (key) open(); }

$('#loginBtn').onclick = () => { key = $('#key').value; sessionStorage.setItem('nw-admin', key); show(); };
$('#logout').onclick = () => { sessionStorage.removeItem('nw-admin'); key = ''; show(); };
document.querySelector('.tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) open(b.dataset.tab); });
$('#csv').onclick = async (e) => {
  e.preventDefault();
  let text;
  try { text = await api.get(`/api/wards/${wardId}/export.csv`, H()); } catch { return toast('Export failed'); }
  const blob = new Blob([text], { type: 'text/csv' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${wardId}-issues.csv` });
  a.click();
};

if (DEMO) $('#keyHint').textContent = 'Demo version: the admin key is "demo". Changes stay in this browser only.';
config = await api.get('/api/config');
wardId = config.wards[0].id;
$('#ward').innerHTML = config.wards.map((w) => `<option value="${w.id}">${esc(w.en)}</option>`).join('');
$('#ward').onchange = (e) => { wardId = e.target.value; if (key) open(); };
show();

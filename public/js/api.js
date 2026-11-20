// API calls plus an offline outbox: complaints made without network are kept in
// IndexedDB and sent when the phone is back online.

import { DEMO } from './mode.js';
export { DEMO };

async function req(method, url, body, headers = {}) {
  if (DEMO) { // GitHub Pages copy: no server, data stays in this browser
    const { demoRequest } = await import('./demo-backend.js');
    return demoRequest(method, url, body, headers);
  }
  const res = await fetch(url, {
    method, headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status });
  return data;
}
export const api = {
  get: (u, h) => req('GET', u, null, h),
  post: (u, b, h) => req('POST', u, b, h),
  patch: (u, b, h) => req('PATCH', u, b, h),
};

// ---------- tiny IndexedDB outbox ----------
function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('namma-ward', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('outbox', { keyPath: 'clientId' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function store(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('outbox', mode);
    const out = fn(tx.objectStore('outbox'));
    tx.oncomplete = () => resolve(out?.result);
    tx.onerror = () => reject(tx.error);
  });
}
export const outbox = {
  add: (item) => store('readwrite', (s) => s.put(item)),
  all: () => store('readonly', (s) => s.getAll()),
  remove: (id) => store('readwrite', (s) => s.delete(id)),
};

export async function submitIssue(wardId, payload) {
  payload.clientId ||= crypto.randomUUID();
  if (DEMO) return api.post(`/api/wards/${wardId}/issues`, payload);
  if (!navigator.onLine) {
    await outbox.add({ wardId, payload });
    return { queued: true };
  }
  try {
    return await api.post(`/api/wards/${wardId}/issues`, payload);
  } catch (e) {
    if (e.status) throw e; // a real validation error from the server
    await outbox.add({ wardId, payload }); // network failure
    return { queued: true };
  }
}

export async function flushOutbox(onSent) {
  if (!navigator.onLine) return;
  for (const item of await outbox.all()) {
    try {
      const r = await api.post(`/api/wards/${item.wardId}/issues`, item.payload);
      await outbox.remove(item.payload.clientId);
      onSent?.(r.ticket);
    } catch (e) {
      if (e.status && e.status < 500) await outbox.remove(item.payload.clientId); // rejected, drop
      else break; // still offline or server down; try later
    }
  }
}

// Resize a photo on the device so uploads stay small on mobile data.
// The demo keeps photos in browser storage, so it uses smaller ones.
export function resizeImage(file, max = DEMO ? 800 : 1280, quality = DEMO ? 0.6 : 0.75) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// Tiny DOM helpers. Always escape data from the database before putting it in HTML.
export const $ = (sel, root = document) => root.querySelector(sel);
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const app = () => document.getElementById('app');

export function render(html) { app().innerHTML = html; }

let toastTimer;
export function toast(msg, kind = 'ok') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = kind; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

// Disable a form while an async action runs; show the error inline.
export function onSubmit(form, fn) {
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    const err = form.querySelector('.error');
    if (err) err.textContent = '';
    if (btn) btn.disabled = true;
    try { await fn(Object.fromEntries(new FormData(form))); }
    catch (x) { const { bm } = await import('./errors.js'); if (err) err.textContent = bm(x); else toast(bm(x), 'error'); }
    finally { if (btn) btn.disabled = false; }
  });
}

export const ROLE_BM = { owner: 'Owner', admin: 'Admin', manager: 'Manager', staff: 'Staff' };
export const date = d => d ? new Date(d).toLocaleDateString('ms-MY', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

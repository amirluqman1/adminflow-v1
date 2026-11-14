// Signed-in app shell: desktop sidebar, mobile bottom navigation, hash router.
import { messageFor } from './api.js';
import { esc, alertBox } from './ui.js';
import { ROLE_LABEL } from './api.js';
import { loadContext } from './store.js';
import { canSeeDirectory, canManage } from './perm.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderStaffList } from './pages/staff-list.js';
import { renderStaffProfile } from './pages/staff-profile.js';
import { renderStaffForm } from './pages/staff-form.js';
import { renderSettings } from './pages/settings.js';

const ICON = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/>',
  staff: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.6-3.4 3-5.2 6-5.2s5.4 1.8 6 5.2"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 14.3c2.6.2 4.6 1.8 5.1 4.7"/>',
  me: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c.8-4 3.8-6 7.5-6s6.7 2 7.5 6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M2.5 12h3M18.5 12h3M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`;

let ctx;
let onSignOut;

export async function startApp(user, signOut) {
  onSignOut = signOut;
  ctx = await loadContext(user); // throws if not linked
  ctx.go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
  // Each navigation gets a sequence number; a page that finishes loading after the user has
  // moved on must not draw over the newer page (see ctx.stale).
  ctx.seq = 0;
  ctx.stale = (seq) => seq !== ctx.seq;

  document.getElementById('auth-shell').hidden = true;
  const root = document.getElementById('app-root');
  root.hidden = false;
  root.innerHTML = layoutHtml();
  root.querySelectorAll('[data-signout]').forEach((b) => b.addEventListener('click', () => onSignOut()));
  window.addEventListener('hashchange', route);
  await route();
}

export function stopApp() {
  window.removeEventListener('hashchange', route);
  const root = document.getElementById('app-root');
  root.hidden = true; root.innerHTML = '';
  document.getElementById('auth-shell').hidden = false;
  ctx = null;
}

function navItems() {
  const items = [{ hash: '#/', label: 'Utama', icon: 'home' }];
  if (canSeeDirectory(ctx)) items.push({ hash: '#/staf', label: 'Staf', icon: 'staff' });
  items.push({ hash: '#/profil', label: 'Profil saya', icon: 'me' });
  if (canManage(ctx)) items.push({ hash: '#/tetapan', label: 'Tetapan', icon: 'settings' });
  return items;
}

function layoutHtml() {
  const me = ctx.me;
  const links = navItems().map((i) => `<a href="${i.hash}" data-nav="${i.hash}">${icon(i.icon)}<span>${esc(i.label)}</span></a>`).join('');
  return `
    <div class="layout">
      <aside class="sidebar">
        <div class="brand"><span class="brand-mark" aria-hidden="true">A</span><span class="brand-name">AdminFlow</span></div>
        <nav class="side-nav" aria-label="Menu utama">${links}</nav>
        <div class="side-user">
          <b>${esc(me.employee?.full_name || ctx.user.email)}</b>
          <span class="badge">${esc(ROLE_LABEL[me.role])}</span>
          <button class="link" type="button" data-signout>Log keluar</button>
        </div>
      </aside>
      <div class="main">
        <header class="topbar">
          <div class="brand"><span class="brand-mark" aria-hidden="true">A</span><span class="brand-name">AdminFlow</span></div>
          <button class="link" type="button" data-signout>Log keluar</button>
        </header>
        <main id="page" class="page" tabindex="-1"></main>
      </div>
      <nav class="bottom-nav" aria-label="Menu utama">${links}</nav>
    </div>`;
}

async function route() {
  if (!ctx) return;
  const page = document.getElementById('page');
  ctx.seq += 1;
  const [hash, query = ''] = (location.hash || '#/').split('?');
  ctx.query = new URLSearchParams(query);
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const top = `#/${parts[0] || ''}`;
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const active = a.dataset.nav === top || (a.dataset.nav === '#/profil' && hash === '#/profil');
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  page.innerHTML = '<p class="muted">Memuatkan…</p>';
  window.scrollTo(0, 0);
  try {
    if (parts[0] === 'staf' && canSeeDirectory(ctx)) {
      if (!parts[1]) await renderStaffList(ctx, page);
      else if (parts[1] === 'baru') await renderStaffForm(ctx, page, null);
      else if (parts[2] === 'edit') await renderStaffForm(ctx, page, parts[1]);
      else await renderStaffProfile(ctx, page, parts[1]);
    } else if (parts[0] === 'profil') {
      await renderStaffProfile(ctx, page, ctx.me.employee_id);
    } else if (parts[0] === 'tetapan' && canManage(ctx)) {
      await renderSettings(ctx, page);
    } else {
      await renderDashboard(ctx, page);
    }
  } catch (e) {
    console.error(e);
    page.innerHTML = `<h1>Ralat</h1>${alertBox('error', messageFor(e))}
      <button class="primary" type="button" id="retry">Cuba lagi</button>`;
    page.querySelector('#retry').addEventListener('click', route);
  }
  page.focus({ preventScroll: true });
}

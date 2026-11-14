// Signed-in app shell: desktop sidebar, mobile bottom navigation, hash router.
import { messageFor } from './api.js';
import { esc, alertBox } from './ui.js';
import { ROLE_LABEL } from './api.js';
import { loadContext } from './store.js';
import { canSeeDirectory, canManage, canSeeActivity } from './perm.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderStaffList } from './pages/staff-list.js';
import { renderStaffProfile } from './pages/staff-profile.js';
import { renderStaffForm } from './pages/staff-form.js';
import { renderSettings } from './pages/settings.js';
import { renderLeave } from './pages/leave.js';
import { renderTasks, renderTask } from './pages/tasks.js';
import { renderActivity } from './pages/activity.js';

const ICON = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/>',
  staff: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.6-3.4 3-5.2 6-5.2s5.4 1.8 6 5.2"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 14.3c2.6.2 4.6 1.8 5.1 4.7"/>',
  me: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c.8-4 3.8-6 7.5-6s6.7 2 7.5 6"/>',
  leave: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="m9 15 2 2 4-4"/>',
  tasks: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1.2 1.2L7 5M3.5 12l1.2 1.2L7 11M3.5 18l1.2 1.2L7 17"/>',
  activity: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
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
  wireMore(root);
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
  items.push({ hash: '#/cuti', label: 'Cuti', icon: 'leave' }, { hash: '#/tugasan', label: 'Tugasan', icon: 'tasks' });
  items.push({ hash: '#/profil', label: 'Profil saya', icon: 'me' });
  if (canSeeActivity(ctx)) items.push({ hash: '#/aktiviti', label: 'Aktiviti', icon: 'activity' });
  if (canManage(ctx)) items.push({ hash: '#/tetapan', label: 'Tetapan', icon: 'settings' });
  return items;
}

const link = (i) => `<a href="${i.hash}" data-nav="${i.hash}">${icon(i.icon)}<span>${esc(i.label)}</span></a>`;

function layoutHtml() {
  const me = ctx.me;
  const items = navItems();
  // phone bottom bar: max 5 buttons; the rest go into "Lagi"
  const primary = items.length <= 5 ? items : items.slice(0, 4);
  const extra = items.length <= 5 ? [] : items.slice(4);
  return `
    <div class="layout">
      <aside class="sidebar">
        <div class="brand"><span class="brand-mark" aria-hidden="true">A</span><span class="brand-name">AdminFlow</span></div>
        <nav class="side-nav" aria-label="Menu utama">${items.map(link).join('')}</nav>
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
      <nav class="bottom-nav" aria-label="Menu utama">
        ${primary.map(link).join('')}
        ${extra.length ? `<button type="button" class="more-btn" id="more-btn" aria-expanded="false" aria-controls="more-sheet" data-more="${extra.map((i) => i.hash).join(' ')}">${icon('more')}<span>Lagi</span></button>` : ''}
      </nav>
      ${extra.length ? `<div class="more-sheet" id="more-sheet" hidden>${extra.map(link).join('')}</div>` : ''}
    </div>`;
}

function wireMore(root) {
  const btn = root.querySelector('#more-btn'); const sheet = root.querySelector('#more-sheet');
  if (!btn) return;
  const set = (open) => { sheet.hidden = !open; btn.setAttribute('aria-expanded', String(open)); };
  btn.addEventListener('click', (e) => { e.stopPropagation(); set(sheet.hidden); });
  sheet.addEventListener('click', () => set(false));
  document.addEventListener('click', (e) => { if (!sheet.hidden && !sheet.contains(e.target)) set(false); });
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
  const more = document.getElementById('more-btn');
  if (more) more.classList.toggle('active', more.dataset.more.split(' ').includes(top));
  page.innerHTML = '<p class="muted">Memuatkan…</p>';
  window.scrollTo(0, 0);
  try {
    if (parts[0] === 'staf' && canSeeDirectory(ctx)) {
      if (!parts[1]) await renderStaffList(ctx, page);
      else if (parts[1] === 'baru') await renderStaffForm(ctx, page, null);
      else if (parts[2] === 'edit') await renderStaffForm(ctx, page, parts[1]);
      else await renderStaffProfile(ctx, page, parts[1]);
    } else if (parts[0] === 'cuti') {
      await renderLeave(ctx, page);
    } else if (parts[0] === 'tugasan') {
      if (parts[1]) await renderTask(ctx, page, parts[1]); else await renderTasks(ctx, page);
    } else if (parts[0] === 'aktiviti' && canSeeActivity(ctx)) {
      await renderActivity(ctx, page);
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

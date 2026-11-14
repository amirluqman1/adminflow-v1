// Direktori Staf — search & filter by Syarikat, outlet, position, status, login access.
import { ROLE_LABEL } from '../api.js';
import { esc, options } from '../ui.js';
import { loadStaff } from '../store.js';
import { canManage } from '../perm.js';

const LOGIN_FILTERS = [
  ['', 'Semua akses'],
  ['active', 'Ada login aktif'],
  ['closed', 'Login ditutup'],
  ['pending', 'Jemputan menunggu'],
  ['none', 'Tiada login'],
];

// remembered per browser tab while navigating
const filters = { q: '', entity: '', outlet: '', position: '', status: 'active', login: '' };

export async function renderStaffList(ctx, el) {
  if (ctx.query.get('login')) { Object.assign(filters, { login: ctx.query.get('login'), status: 'active' }); }
  const seq = ctx.seq;
  const staff = await loadStaff(ctx);
  if (ctx.stale(seq)) return;
  const positions = [...new Set(staff.map((e) => e.position).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const multiEntity = ctx.entities.length > 1;

  el.innerHTML = `
    <div class="page-head">
      <div><h1>Direktori Staf</h1><p class="muted" id="count"></p></div>
      ${canManage(ctx) ? '<a class="btn primary" href="#/staf/baru">+ Tambah pekerja</a>' : ''}
    </div>
    <form class="filters" id="filters" role="search" onsubmit="return false">
      <input type="search" name="q" placeholder="Cari nama, no. pekerja, emel, telefon" value="${esc(filters.q)}" aria-label="Cari staf">
      <details class="filter-more" ${filters.entity || filters.outlet || filters.position || filters.login || filters.status !== 'active' ? 'open' : ''}>
        <summary>Tapis</summary>
        <div class="filter-grid">
          ${multiEntity ? `<label>Syarikat<select name="entity">${options(ctx.entities.map((x) => [x.id, x.name]), filters.entity, { empty: 'Semua Syarikat' })}</select></label>` : ''}
          <label>Outlet<select name="outlet">${options([['hq', 'HQ / tiada outlet'], ...ctx.outlets.map((x) => [x.id, x.name])], filters.outlet, { empty: 'Semua outlet' })}</select></label>
          <label>Jawatan<select name="position">${options(positions.map((p) => [p, p]), filters.position, { empty: 'Semua jawatan' })}</select></label>
          <label>Status<select name="status">${options([['active', 'Aktif'], ['inactive', 'Tidak aktif'], ['all', 'Semua']], filters.status)}</select></label>
          ${canManage(ctx) ? `<label>Akses login<select name="login">${options(LOGIN_FILTERS, filters.login)}</select></label>` : ''}
        </div>
        <button class="link" type="button" id="reset">Set semula penapis</button>
      </details>
    </form>
    <ul class="staff-list" id="list" aria-live="polite"></ul>`;

  const form = el.querySelector('#filters');
  const draw = () => {
    for (const k of Object.keys(filters)) if (form.elements[k]) filters[k] = form.elements[k].value;
    const rows = applyFilters(staff, filters);
    el.querySelector('#count').textContent = `${rows.length} daripada ${staff.length} pekerja`;
    el.querySelector('#list').innerHTML = rows.length
      ? rows.map((e) => rowHtml(ctx, e, multiEntity)).join('')
      : `<li class="empty">Tiada pekerja sepadan dengan carian/penapis ini.</li>`;
  };
  form.addEventListener('input', draw);
  form.addEventListener('change', draw);
  el.querySelector('#reset').addEventListener('click', () => {
    Object.assign(filters, { q: '', entity: '', outlet: '', position: '', status: 'active', login: '' });
    ctx.go('#/staf');
  });
  draw();
}

function loginState(e) {
  if (e.profile) return e.profile.is_active ? 'active' : 'closed';
  return e.pendingInvite ? 'pending' : 'none';
}

function applyFilters(staff, f) {
  const q = f.q.trim().toLowerCase();
  return staff.filter((e) => {
    if (f.status !== 'all' && e.status !== f.status) return false;
    if (f.entity && e.legal_entity_id !== f.entity) return false;
    if (f.outlet === 'hq' ? e.outlet_id : f.outlet && e.outlet_id !== f.outlet) return false;
    if (f.position && e.position !== f.position) return false;
    if (f.login && loginState(e) !== f.login) return false;
    if (q) {
      const hay = [e.full_name, e.employee_no, e.email, e.phone, e.position].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q) && !hay.replace(/[\s-]/g, '').includes(q.replace(/[\s-]/g, ''))) return false;
    }
    return true;
  });
}

function rowHtml(ctx, e, multiEntity) {
  const outlet = e.outlet_id ? ctx.outletById.get(e.outlet_id)?.name : 'HQ';
  const entity = multiEntity && e.legal_entity_id ? ctx.entityById.get(e.legal_entity_id)?.name : '';
  const where = [outlet, entity].filter(Boolean).join(' · ');
  const login = {
    active: `<span class="badge">${esc(ROLE_LABEL[e.profile?.role])}</span>`,
    closed: '<span class="badge muted-badge">Login ditutup</span>',
    pending: '<span class="badge pending">Jemputan menunggu</span>',
    none: '<span class="badge muted-badge">Tiada login</span>',
  }[loginState(e)];
  return `
    <li><a class="staff-row" href="#/staf/${e.id}">
      <span class="avatar" aria-hidden="true">${esc(initials(e.full_name))}</span>
      <span class="staff-main">
        <b>${esc(e.full_name)}</b>
        <span class="muted">${esc(e.position || 'Tiada jawatan')}${e.employee_no ? ` · ${esc(e.employee_no)}` : ''}</span>
        <span class="muted">${esc(where)}</span>
      </span>
      <span class="staff-badges">${e.status === 'inactive' ? '<span class="badge danger-badge">Tidak aktif</span>' : ''}${login}</span>
    </a></li>`;
}

export function initials(name) {
  return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

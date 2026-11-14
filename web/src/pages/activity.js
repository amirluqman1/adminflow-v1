// Sejarah Aktiviti — append-only audit trail (Owner: whole group, Admin: own Syarikat; RLS decides).
import { client, call } from '../api.js';
import { esc, options } from '../ui.js';
import { loadStaff } from '../store.js';
import { LEAVE_TYPE } from './leave.js';
import { ROLE_LABEL } from '../api.js';
import { EMP_TYPE } from '../ui.js';

// enum values → BM, per field
const VALUE = {
  status: { active: 'Aktif', inactive: 'Tidak aktif', pending: 'Menunggu', approved: 'Diluluskan', rejected: 'Ditolak', cancelled: 'Dibatalkan',
    accepted: 'Diterima', revoked: 'Dibatalkan', expired: 'Tamat tempoh', todo: 'To Do', in_progress: 'Sedang dibuat', completed: 'Selesai', verified: 'Disahkan' },
  role: ROLE_LABEL,
  employment_type: EMP_TYPE,
  leave_type: LEAVE_TYPE,
  priority: { low: 'Rendah', normal: 'Biasa', high: 'Tinggi' },
};

const ACTION = {
  'company.bootstrap': 'Group dicipta',
  'legal_entity.create': 'Syarikat ditambah', 'legal_entity.update': 'Syarikat dikemas kini',
  'outlet.create': 'Outlet ditambah', 'outlet.update': 'Outlet dikemas kini',
  'admin_entity.assign': 'Syarikat diberi kepada Admin', 'admin_entity.remove': 'Syarikat ditarik daripada Admin',
  'manager_outlet.assign': 'Outlet diberi kepada Admin Outlet', 'manager_outlet.remove': 'Outlet ditarik daripada Admin Outlet',
  'employee.create': 'Pekerja ditambah', 'employee.update': 'Maklumat pekerja dikemas kini',
  'employee.deactivate': 'Pekerja dinyahaktif', 'employee.reactivate': 'Pekerja diaktifkan semula',
  'account.activate': 'Akaun login diaktifkan', 'account.deactivate': 'Akaun login ditutup', 'account.role_change': 'Peranan ditukar',
  'invitation.create': 'Jemputan dibuat', 'invitation.revoke': 'Jemputan dibatalkan', 'invitation.accept': 'Jemputan diterima',
  'invitation.reissue': 'Jemputan Owner dikeluarkan semula',
  'leave.submit': 'Cuti dimohon', 'leave.submit_on_behalf': 'Cuti direkod bagi pihak', 'leave.submit_auto_approved': 'Cuti (auto-lulus)',
  'leave.approve': 'Cuti diluluskan', 'leave.reject': 'Cuti ditolak', 'leave.cancel': 'Cuti dibatalkan', 'leave.self_approve': 'Admin lulus cuti sendiri',
  'task.create': 'Tugasan dicipta', 'task.update': 'Tugasan dikemas kini', 'task.reassign': 'Tugasan diberi kepada orang lain',
  'task.status_in_progress': 'Tugasan mula dibuat', 'task.status_todo': 'Tugasan kembali ke To Do', 'task.status_completed': 'Tugasan selesai',
  'task.verify': 'Tugasan disahkan', 'task.send_back': 'Tugasan dihantar balik', 'task.cancel': 'Tugasan dibatalkan',
};
const CATEGORY = [
  ['employee', 'Pekerja'], ['account', 'Akaun & peranan'], ['invitation', 'Jemputan'], ['leave', 'Cuti'], ['task', 'Tugasan'],
  ['structure', 'Syarikat, outlet & akses'],
];
const STRUCTURE_PREFIXES = ['legal_entity', 'outlet', 'admin_entity', 'manager_outlet', 'company'];
const FIELD = {
  full_name: 'Nama', position: 'Jawatan', phone: 'Telefon', email: 'Emel', employee_no: 'No. pekerja', status: 'Status',
  outlet_id: 'Outlet', legal_entity_id: 'Syarikat', employment_type: 'Jenis pekerjaan', join_date: 'Tarikh mula', role: 'Peranan',
  is_active: 'Aktif', name: 'Nama', code: 'Kod', address: 'Alamat', registration_no: 'No. SSM', title: 'Tajuk', due_at: 'Tarikh akhir',
  priority: 'Keutamaan', assigned_employee_id: 'Diberi kepada', description: 'Penerangan', leave_type: 'Jenis cuti',
  start_date: 'Mula', end_date: 'Akhir', reason: 'Sebab', review_note: 'Nota semakan', cancel_reason: 'Sebab batal',
};
const SKIP = new Set(['id', 'company_id', 'created_at', 'updated_at', 'token_hash', 'started_at', 'completed_at', 'verified_at', 'cancelled_at',
  'reviewed_at', 'activated_at', 'deactivated_at', 'completed_by_profile_id', 'verified_by_profile_id', 'cancelled_by_profile_id',
  'reviewed_by_profile_id', 'submitted_by_profile_id', 'created_by_profile_id', 'invited_by_profile_id', 'accepted_auth_user_id', 'accepted_at', 'revoked_at']);
const PAGE = 50;

export async function renderActivity(ctx, el) {
  const seq = ctx.seq;
  const staff = await loadStaff(ctx);
  if (ctx.stale(seq)) return;
  const empName = new Map(staff.map((e) => [e.id, e.full_name]));
  const profName = new Map(staff.filter((e) => e.profile).map((e) => [e.profile.id, e.full_name]));
  const state = { rows: [], done: false, filters: { cat: '', emp: ctx.query.get('emp') || '', from: '', to: '' } };

  el.innerHTML = `
    <div class="page-head"><div><h1>Sejarah Aktiviti</h1>
      <p class="muted">${ctx.me.role === 'owner' ? 'Semua perubahan dalam Group' : 'Perubahan dalam Syarikat anda'} — siapa, apa, bila. Rekod tidak boleh diubah atau dipadam.</p></div></div>
    <form class="filters row" id="flt" onsubmit="return false">
      <select name="cat" aria-label="Kategori">${options(CATEGORY, '', { empty: 'Semua kategori' })}</select>
      <select name="emp" aria-label="Pekerja">${options(staff.map((e) => [e.id, e.full_name]), state.filters.emp, { empty: 'Semua pekerja' })}</select>
      <label class="inline-date">Dari <input type="date" name="from"></label>
      <label class="inline-date">Hingga <input type="date" name="to"></label>
    </form>
    <ul class="audit" id="list"></ul>
    <div class="actions center"><button class="secondary" type="button" id="more" hidden>Muat lagi</button></div>`;

  const list = el.querySelector('#list');
  const more = el.querySelector('#more');

  async function load(reset) {
    if (reset) { state.rows = []; state.done = false; list.innerHTML = '<li class="muted">Memuatkan…</li>'; }
    const f = state.filters;
    let q = client.from('audit_logs').select('*').order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(state.rows.length, state.rows.length + PAGE - 1);
    if (f.cat === 'structure') q = q.or(STRUCTURE_PREFIXES.map((p) => `action.like.${p}.*`).join(','));
    else if (f.cat) q = q.like('action', `${f.cat}.%`);
    if (f.emp) q = q.eq('employee_id', f.emp);
    if (f.from) q = q.gte('created_at', new Date(`${f.from}T00:00:00`).toISOString());
    if (f.to) q = q.lte('created_at', new Date(`${f.to}T23:59:59.999`).toISOString());
    const mySeq = ctx.seq;
    const { data, error } = await call(() => q);
    if (ctx.stale(mySeq)) return;
    if (error) { list.innerHTML = `<li class="empty">Gagal memuatkan sejarah. Cuba lagi.</li>`; return; }
    state.rows.push(...data);
    state.done = data.length < PAGE;
    list.innerHTML = state.rows.length ? state.rows.map((r) => rowHtml(ctx, r, empName, profName)).join('') : '<li class="empty">Tiada aktiviti untuk penapis ini.</li>';
    more.hidden = state.done;
  }

  const form = el.querySelector('#flt');
  form.addEventListener('change', () => {
    Object.assign(state.filters, { cat: form.elements.cat.value, emp: form.elements.emp.value, from: form.elements.from.value, to: form.elements.to.value });
    load(true);
  });
  more.addEventListener('click', () => load(false));
  await load(true);
}

function when(iso) {
  return new Date(iso).toLocaleString('ms-MY', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function target(ctx, r, empName) {
  const d = r.new_data || r.old_data || {};
  if (r.entity_type === 'tasks') return d.title ? `“${d.title}”` : 'Tugasan';
  if (r.entity_type === 'leave_requests') return [r.employee_id && empName.get(r.employee_id), d.leave_type && LEAVE_TYPE[d.leave_type], d.start_date && `${d.start_date}${d.end_date && d.end_date !== d.start_date ? ` – ${d.end_date}` : ''}`].filter(Boolean).join(' · ');
  if (r.entity_type === 'outlets') return d.name || ctx.outletById.get(r.entity_id)?.name || 'Outlet';
  if (r.entity_type === 'legal_entities') return d.name || ctx.entityById.get(r.entity_id)?.name || 'Syarikat';
  if (r.entity_type === 'manager_outlets') return [r.employee_id && empName.get(r.employee_id), ctx.outletById.get(d.outlet_id)?.name].filter(Boolean).join(' → ');
  if (r.entity_type === 'admin_entities') return [r.employee_id && empName.get(r.employee_id), ctx.entityById.get(d.legal_entity_id)?.name].filter(Boolean).join(' → ');
  if (r.employee_id) return empName.get(r.employee_id) || 'Pekerja (di luar skop)';
  return '';
}

function fmtVal(ctx, k, v, empName) {
  if (v === null || v === undefined || v === '') return '—';
  if (k === 'outlet_id') return ctx.outletById.get(v)?.name || 'Outlet';
  if (k === 'legal_entity_id') return ctx.entityById.get(v)?.name || 'Syarikat';
  if (k === 'assigned_employee_id') return empName.get(v) || 'Pekerja';
  if (typeof v === 'boolean') return v ? 'Ya' : 'Tidak';
  if (VALUE[k]?.[v]) return VALUE[k][v];
  if (k === 'due_at') return when(v);
  return String(v);
}

function changes(ctx, r, empName) {
  const o = r.old_data || {}; const n = r.new_data || {};
  if (!r.old_data || !r.new_data) return [];
  return Object.keys({ ...o, ...n })
    .filter((k) => !SKIP.has(k) && JSON.stringify(o[k]) !== JSON.stringify(n[k]))
    .map((k) => `<li><span>${esc(FIELD[k] || k)}</span> ${esc(fmtVal(ctx, k, o[k], empName))} → <b>${esc(fmtVal(ctx, k, n[k], empName))}</b></li>`);
}

function rowHtml(ctx, r, empName, profName) {
  const actor = r.actor_profile_id ? (profName.get(r.actor_profile_id) || 'Pengguna (di luar skop)') : 'Sistem / pentadbir pangkalan data';
  const diff = changes(ctx, r, empName);
  const tgt = target(ctx, r, empName);
  return `
    <li class="audit-row">
      <div class="audit-top"><b>${esc(ACTION[r.action] || r.action)}</b><time class="muted small" datetime="${esc(r.created_at)}">${esc(when(r.created_at))}</time></div>
      <div class="small">${tgt ? `${esc(tgt)} · ` : ''}<span class="muted">oleh ${esc(actor)}</span></div>
      ${r.note ? `<div class="small note">“${esc(r.note)}”</div>` : ''}
      ${diff.length ? `<details><summary>${diff.length} perubahan</summary><ul class="diff">${diff.join('')}</ul></details>` : ''}
    </li>`;
}

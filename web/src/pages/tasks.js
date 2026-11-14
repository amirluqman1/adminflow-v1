// Tugasan — To Do → In Progress → Completed → Verified (or Cancelled with reason).
// The assignee never verifies their own task. Managers update on behalf of no-login staff only.
import { client, call, messageFor } from '../api.js';
import { esc, fmtDate, options, toast, dialog, busy, alertBox } from '../ui.js';
import { loadStaff } from '../store.js';
import { canCreateTask, canAssignTo, canManageTask, canWorkTask, isSelf } from '../perm.js';

export const TASK_STATUS = {
  todo: ['To Do', 'muted-badge'],
  in_progress: ['Sedang dibuat', 'pending'],
  completed: ['Selesai — tunggu sah', 'info-badge'],
  verified: ['Disahkan', 'ok-badge'],
  cancelled: ['Dibatalkan', 'danger-badge'],
};
const PRIORITY = { low: 'Rendah', normal: 'Biasa', high: 'Tinggi' };

const fmtDue = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('ms-MY', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};
// datetime-local value in local time
const localInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

async function loadTasks(ctx, id) {
  let q = client.from('task_overview').select('*');
  q = id ? q.eq('id', id) : q.order('created_at', { ascending: false }).limit(1000);
  const r = await call(() => q);
  if (r.error) throw r.error;
  return r.data;
}

// ---------------------------------------------------------------- list
export async function renderTasks(ctx, el) {
  const seq = ctx.seq;
  const [staff, tasks] = await Promise.all([loadStaff(ctx), loadTasks(ctx)]);
  if (ctx.stale(seq)) return;
  const empById = new Map(staff.map((e) => [e.id, e]));
  const manager = canCreateTask(ctx);
  const mine = (t) => t.assigned_employee_id === ctx.me.employee_id;
  const toVerify = (t) => t.status === 'completed' && !mine(t) && canManageTask(ctx, t, empById.get(t.assigned_employee_id));

  const tabs = manager
    ? [['saya', 'Tugasan saya'], ['sahkan', 'Perlu disahkan'], ['semua', 'Semua']]
    : [['saya', 'Tugasan saya']];
  const empFilter = ctx.query.get('emp');
  let tab = ctx.query.get('tab') || (empFilter ? 'semua' : 'saya');
  if (!tabs.some(([k]) => k === tab)) tab = tabs[0][0];
  const verifyCount = tasks.filter(toVerify).length;

  el.innerHTML = `
    <div class="page-head">
      <div><h1>Tugasan</h1><p class="muted">${tasks.filter((t) => mine(t) && ['todo', 'in_progress'].includes(t.status)).length} tugasan terbuka untuk anda</p></div>
      ${manager ? '<button class="btn primary" type="button" id="new">+ Tugasan baru</button>' : ''}
    </div>
    ${tabs.length > 1 ? `<nav class="tabs" aria-label="Paparan tugasan">${tabs.map(([k, l]) =>
      `<a href="#/tugasan?tab=${k}" class="${k === tab ? 'active' : ''}"${k === tab ? ' aria-current="page"' : ''}>${esc(l)}${k === 'sahkan' && verifyCount ? ` <span class="count">${verifyCount}</span>` : ''}</a>`).join('')}</nav>` : ''}
    <form class="filters row" id="flt" onsubmit="return false">
      ${tab === 'semua' ? '<input type="search" name="q" placeholder="Cari tajuk / nama" aria-label="Cari tugasan">' : ''}
      <select name="status" aria-label="Status">${options([['open', 'Belum selesai'], ['overdue', 'Lewat'], ...Object.entries(TASK_STATUS).map(([k, [l]]) => [k, l]), ['all', 'Semua status']], tab === 'sahkan' ? 'completed' : 'open')}</select>
      ${tab === 'semua' && ctx.outlets.length > 1 ? `<select name="outlet" aria-label="Outlet">${options(ctx.outlets.map((o) => [o.id, o.name]), '', { empty: 'Semua outlet' })}</select>` : ''}
    </form>
    ${tab === 'semua' && empFilter && empById.get(empFilter) ? `<p class="muted small">Ditapis: ${esc(empById.get(empFilter).full_name)} · <a href="#/tugasan?tab=semua">buang tapisan</a></p>` : ''}
    <ul class="cards" id="list"></ul>`;

  const f = el.querySelector('#flt');
  const draw = () => {
    const st = f.elements.status.value;
    const q = f.elements.q?.value.trim().toLowerCase() || '';
    const outlet = f.elements.outlet?.value || '';
    let rows = tasks;
    if (tab === 'saya') rows = rows.filter(mine);
    if (tab === 'sahkan') rows = rows.filter(toVerify);
    if (tab === 'semua' && empFilter) rows = rows.filter((t) => t.assigned_employee_id === empFilter);
    rows = rows.filter((t) => (st === 'all' || (st === 'open' ? ['todo', 'in_progress', 'completed'].includes(t.status) : st === 'overdue' ? t.is_overdue : t.status === st))
      && (!outlet || t.outlet_id === outlet)
      && (!q || `${t.title} ${t.assigned_employee_name}`.toLowerCase().includes(q)));
    // overdue first, then nearest due date, then newest
    rows = [...rows].sort((a, b) => (b.is_overdue - a.is_overdue) || ((a.due_at ? Date.parse(a.due_at) : Infinity) - (b.due_at ? Date.parse(b.due_at) : Infinity)));
    el.querySelector('#list').innerHTML = rows.length ? rows.map((t) => card(ctx, t, tab)).join('')
      : `<li class="empty">${tab === 'sahkan' ? 'Tiada tugasan menunggu pengesahan.' : 'Tiada tugasan.'}</li>`;
  };
  f.addEventListener('input', draw); f.addEventListener('change', draw);
  draw();

  el.querySelector('#new')?.addEventListener('click', async () => {
    const id = await taskDialog(ctx, staff, null, empFilter);
    if (id) ctx.go(`#/tugasan/${id}`);
  });
}

function card(ctx, t, tab) {
  const [label, cls] = TASK_STATUS[t.status];
  return `
    <li><a class="card-item link-card" href="#/tugasan/${t.id}">
      <div class="card-top">
        <div><b>${esc(t.title)}</b>
          <span class="muted small block">${tab !== 'saya' ? `${esc(t.assigned_employee_name || '')} · ` : ''}${esc(t.outlet_name || 'HQ')}${t.priority === 'high' ? ' · <span class="danger-text">Keutamaan tinggi</span>' : ''}</span></div>
        <div class="badges"><span class="badge ${cls}">${label}</span>${t.is_overdue ? '<span class="badge danger-badge">Lewat</span>' : ''}</div>
      </div>
      ${t.due_at ? `<p class="small ${t.is_overdue ? 'danger-text' : 'muted'}">Tarikh akhir: ${esc(fmtDue(t.due_at))}</p>` : ''}
    </a></li>`;
}

// ---------------------------------------------------------------- create / edit dialog
export async function taskDialog(ctx, staff, t, preselect) {
  const assignable = staff.filter((e) => canAssignTo(ctx, e) || (t && e.id === t.assigned_employee_id));
  if (!assignable.length) { toast('Tiada pekerja dalam skop anda untuk diberi tugasan.', 'error'); return null; }
  const who = assignable.map((e) => [e.id, `${e.full_name}${isSelf(ctx, e) ? ' (saya)' : ''}${e.outlet_id ? ` — ${ctx.outletById.get(e.outlet_id)?.name || ''}` : ''}`]);
  let newId = null;
  const ok = await dialog({
    title: t ? 'Edit tugasan' : 'Tugasan baru',
    confirm: t ? 'Simpan' : 'Cipta tugasan',
    fields: [
      { name: 'title', label: 'Tajuk', required: true, value: t?.title, maxlength: 200 },
      { name: 'assignee', label: 'Diberi kepada', type: 'select', options: who, value: t?.assigned_employee_id || (assignable.some((e) => e.id === preselect) ? preselect : who[0][0]) },
      { name: 'due', label: 'Tarikh & masa akhir', hint: 'Pilihan', type: 'datetime-local', value: localInput(t?.due_at) },
      { name: 'priority', label: 'Keutamaan', type: 'select', options: Object.entries(PRIORITY), value: t?.priority || 'normal' },
      { name: 'description', label: 'Penerangan', type: 'textarea', value: t?.description, maxlength: 4000 },
    ],
    onSubmit: async (v) => {
      if (v.title.length < 2) return 'Tajuk sekurang-kurangnya 2 aksara.';
      const due = v.due ? new Date(v.due).toISOString() : null;
      const r = t
        ? await call(() => client.rpc('update_task', { p_task_id: t.id, p_title: v.title, p_description: v.description || null, p_due_at: due, p_priority: v.priority, p_assigned_employee_id: v.assignee }))
        : await call(() => client.rpc('create_task', { p_title: v.title, p_assigned_employee_id: v.assignee, p_description: v.description || null, p_due_at: due, p_priority: v.priority, p_outlet_id: null }));
      if (r.error) return messageFor(r.error);
      newId = t ? t.id : r.data;
      toast(t ? 'Tugasan dikemas kini.' : 'Tugasan dicipta.');
      return '';
    },
  });
  return ok ? newId : null;
}

// ---------------------------------------------------------------- detail
export async function renderTask(ctx, el, id) {
  const seq = ctx.seq;
  const [staff, rows] = await Promise.all([loadStaff(ctx), loadTasks(ctx, id)]);
  if (ctx.stale(seq)) return;
  const t = rows[0];
  if (!t) { el.innerHTML = `<a class="back" href="#/tugasan">← Tugasan</a><h1>Tugasan tidak dijumpai</h1>${alertBox('error', 'Rekod ini tiada atau di luar skop anda.')}`; return; }
  const empById = new Map(staff.map((e) => [e.id, e]));
  const nameByProfile = new Map(staff.filter((e) => e.profile).map((e) => [e.profile.id, e.full_name]));
  const assignee = empById.get(t.assigned_employee_id);
  const mine = t.assigned_employee_id === ctx.me.employee_id;
  const manage = canManageTask(ctx, t, assignee);
  const work = canWorkTask(ctx, t, assignee);
  const onBehalf = work && !mine;
  const [label, cls] = TASK_STATUS[t.status];
  const who = (pid) => (pid && nameByProfile.get(pid)) || null;

  // allowed next steps
  const btns = [];
  if (work && t.status === 'todo') btns.push(['in_progress', 'Mula buat', 'primary']);
  if (work && ['todo', 'in_progress'].includes(t.status)) btns.push(['completed', 'Tandakan selesai', t.status === 'todo' ? 'secondary' : 'primary']);
  if (work && t.status === 'in_progress') btns.push(['todo', 'Kembali ke To Do', 'link']);
  if (manage && !mine && t.status === 'completed') btns.push(['verified', 'Sahkan', 'primary'], ['send_back', 'Hantar balik untuk dibaiki', 'secondary']);
  if ((manage || t.created_by_profile_id === ctx.me.id) && !['verified', 'cancelled'].includes(t.status)) btns.push(['cancelled', 'Batalkan tugasan', 'danger-outline']);

  const step = (lbl, at, by) => at ? `<li><b>${esc(lbl)}</b><span class="muted small">${esc(fmtDue(at))}${by ? ` · ${esc(by)}` : ''}</span></li>` : '';

  el.innerHTML = `
    <a class="back" href="#/tugasan">← Tugasan</a>
    <div class="page-head">
      <div><h1>${esc(t.title)}</h1>
        <div class="badges"><span class="badge ${cls}">${label}</span>${t.is_overdue ? '<span class="badge danger-badge">Lewat</span>' : ''}
          ${t.priority === 'high' ? '<span class="badge danger-badge">Keutamaan tinggi</span>' : ''}</div></div>
      ${manage && ['todo', 'in_progress'].includes(t.status) ? '<button class="btn secondary" type="button" id="edit">Edit</button>' : ''}
    </div>
    <section class="panel">
      <dl class="info">
        <div><dt>Diberi kepada</dt><dd>${assignee && ctx.me.role !== 'staff' ? `<a href="#/staf/${assignee.id}">${esc(t.assigned_employee_name)}</a>` : esc(t.assigned_employee_name || '—')}</dd></div>
        <div><dt>Outlet</dt><dd>${esc(t.outlet_name || 'HQ')}</dd></div>
        <div><dt>Tarikh akhir</dt><dd class="${t.is_overdue ? 'danger-text' : ''}">${t.due_at ? esc(fmtDue(t.due_at)) : '—'}</dd></div>
        <div><dt>Keutamaan</dt><dd>${esc(PRIORITY[t.priority])}</dd></div>
      </dl>
      ${t.description ? `<p class="desc">${esc(t.description)}</p>` : ''}
      ${t.cancel_reason ? alertBox('error', `Dibatalkan: ${t.cancel_reason}`) : ''}
      ${onBehalf ? '<p class="muted small">Pekerja ini tiada login — anda boleh kemas kini status bagi pihaknya.</p>' : ''}
      ${btns.length ? `<div class="actions">${btns.map(([s, l, c]) => `<button class="${c}" type="button" data-to="${s}">${esc(l)}</button>`).join('')}</div>` : ''}
      ${mine && t.status === 'completed' ? '<p class="muted small">Menunggu pengesahan daripada pengurus. Anda tidak boleh mengesahkan tugasan sendiri.</p>' : ''}
    </section>
    <section class="panel">
      <h2>Perjalanan tugasan</h2>
      <ul class="timeline">
        ${step('Dicipta', t.created_at, who(t.created_by_profile_id))}
        ${step('Mula dibuat', t.started_at)}
        ${step('Selesai', t.completed_at, who(t.completed_by_profile_id))}
        ${step('Disahkan', t.verified_at, who(t.verified_by_profile_id))}
        ${step('Dibatalkan', t.cancelled_at, who(t.cancelled_by_profile_id))}
      </ul>
    </section>`;

  // after a successful change, lock every action until the fresh data is drawn (no double transitions)
  const rerender = () => { el.querySelectorAll('[data-to], #edit').forEach((x) => { x.disabled = true; }); return renderTask(ctx, el, id); };
  el.querySelector('#edit')?.addEventListener('click', async () => { if (await taskDialog(ctx, staff, t)) rerender(); });
  el.querySelectorAll('[data-to]').forEach((b) => b.addEventListener('click', async () => {
    const to = b.dataset.to;
    const send = to === 'send_back';
    const needReason = to === 'cancelled' || send;
    if (needReason || to === 'verified') {
      const ok = await dialog({
        title: { cancelled: 'Batalkan tugasan?', verified: 'Sahkan tugasan ini?', send_back: 'Hantar balik untuk dibaiki?' }[to],
        message: to === 'verified' ? 'Tugasan yang disahkan adalah muktamad.' : '',
        fields: [{ name: 'note', label: needReason ? 'Sebab (wajib)' : 'Nota (pilihan)', type: 'textarea', required: needReason, maxlength: 1000 }],
        confirm: { cancelled: 'Batalkan tugasan', verified: 'Sahkan', send_back: 'Hantar balik' }[to], danger: to === 'cancelled',
        onSubmit: async (v) => { const r = await call(() => client.rpc('set_task_status', { p_task_id: t.id, p_status: send ? 'in_progress' : to, p_note: v.note || null })); return r.error ? messageFor(r.error) : ''; },
      });
      if (ok) { toast('Status dikemas kini.'); rerender(); }
      return;
    }
    const { error } = await busy(b, () => call(() => client.rpc('set_task_status', { p_task_id: t.id, p_status: to, p_note: null })));
    if (error) return toast(messageFor(error), 'error');
    toast('Status dikemas kini.'); rerender();
  }));
}

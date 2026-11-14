// Cuti — apply, review (approve / reject with reason), cancel, record on behalf of no-login staff.
import { client, call, messageFor } from '../api.js';
import { esc, fmtDate, options, toast, dialog, busy } from '../ui.js';
import { loadStaff } from '../store.js';
import { canReviewLeave, canSelfApprove, canActOnBehalf, isSelf, canSeeDirectory } from '../perm.js';

export const LEAVE_TYPE = {
  annual: 'Cuti tahunan',
  medical: 'Cuti sakit (MC)',
  emergency: 'Cuti kecemasan',
  unpaid: 'Cuti tanpa gaji',
  other: 'Lain-lain',
};
const STATUS = {
  pending: ['Menunggu', 'pending'],
  approved: ['Diluluskan', 'ok-badge'],
  rejected: ['Ditolak', 'danger-badge'],
  cancelled: ['Dibatalkan', 'muted-badge'],
};

export const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000) + 1;
const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time

export async function renderLeave(ctx, el) {
  const seq = ctx.seq;
  const [staff, lr] = await Promise.all([
    loadStaff(ctx),
    call(() => client.from('leave_requests').select('*').order('start_date', { ascending: false }).limit(1000)),
  ]);
  if (lr.error) throw lr.error;
  if (ctx.stale(seq)) return;

  const empById = new Map(staff.map((e) => [e.id, e]));
  const nameByProfile = new Map(staff.filter((e) => e.profile).map((e) => [e.profile.id, e.full_name]));
  const reviewer = canSeeDirectory(ctx);
  const leaves = lr.data.map((l) => ({ ...l, emp: empById.get(l.employee_id) }));
  const actionable = (l) => l.status === 'pending' && l.emp && (canReviewLeave(ctx, l.emp) || (isSelf(ctx, l.emp) && canSelfApprove(ctx)));
  const behalf = staff.filter((e) => canActOnBehalf(ctx, e));

  const tabs = reviewer ? [['tindakan', 'Perlu tindakan'], ['saya', 'Cuti saya'], ['semua', 'Semua']] : [['saya', 'Cuti saya']];
  const empFilter = ctx.query.get('emp');
  let tab = ctx.query.get('tab') || (empFilter ? 'semua' : reviewer && leaves.some(actionable) ? 'tindakan' : 'saya');
  if (!tabs.some(([k]) => k === tab)) tab = tabs[0][0];

  let list = leaves;
  if (tab === 'tindakan') list = leaves.filter(actionable);
  if (tab === 'saya') list = leaves.filter((l) => l.employee_id === ctx.me.employee_id);
  if (tab === 'semua' && empFilter) list = leaves.filter((l) => l.employee_id === empFilter);
  const pendingCount = leaves.filter(actionable).length;

  el.innerHTML = `
    <div class="page-head">
      <div><h1>Cuti</h1><p class="muted">${reviewer ? `${pendingCount} permohonan menunggu tindakan anda` : 'Mohon dan jejak cuti anda'}</p></div>
      <button class="btn primary" type="button" id="apply">+ Mohon cuti</button>
    </div>
    ${tabs.length > 1 ? `<nav class="tabs" aria-label="Paparan cuti">${tabs.map(([k, l]) =>
      `<a href="#/cuti?tab=${k}" class="${k === tab ? 'active' : ''}"${k === tab ? ' aria-current="page"' : ''}>${esc(l)}${k === 'tindakan' && pendingCount ? ` <span class="count">${pendingCount}</span>` : ''}</a>`).join('')}</nav>` : ''}
    ${tab === 'semua' ? `
      <form class="filters row" id="flt" onsubmit="return false">
        <input type="search" name="q" placeholder="Cari nama" aria-label="Cari nama">
        <select name="status" aria-label="Status">${options(Object.entries(STATUS).map(([k, [l]]) => [k, l]), '', { empty: 'Semua status' })}</select>
        <select name="type" aria-label="Jenis cuti">${options(Object.entries(LEAVE_TYPE), '', { empty: 'Semua jenis' })}</select>
      </form>
      ${empFilter && empById.get(empFilter) ? `<p class="muted small">Ditapis: ${esc(empById.get(empFilter).full_name)} · <a href="#/cuti?tab=semua">buang tapisan</a></p>` : ''}` : ''}
    <ul class="cards" id="list"></ul>`;

  const draw = () => {
    let rows = list;
    const f = el.querySelector('#flt');
    if (f) {
      const q = f.elements.q.value.trim().toLowerCase();
      rows = rows.filter((l) => (!q || (l.emp?.full_name || '').toLowerCase().includes(q))
        && (!f.elements.status.value || l.status === f.elements.status.value)
        && (!f.elements.type.value || l.leave_type === f.elements.type.value));
    }
    el.querySelector('#list').innerHTML = rows.length
      ? rows.map((l) => card(ctx, l, tab, nameByProfile)).join('')
      : `<li class="empty">${tab === 'tindakan' ? 'Tiada permohonan menunggu tindakan anda. 🎉' : 'Tiada rekod cuti.'}</li>`;
    wire();
  };
  el.querySelector('#flt')?.addEventListener('input', draw);

  // after a successful change, lock every action until the fresh data is drawn
  const rerender = () => { el.querySelectorAll('[data-approve], [data-reject], [data-cancel], #apply').forEach((x) => { x.disabled = true; }); return renderLeave(ctx, el); };
  const byId = new Map(leaves.map((l) => [l.id, l]));
  function wire() {
    el.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', async () => {
      const l = byId.get(b.dataset.approve); const self = isSelf(ctx, l.emp);
      const ok = await dialog({
        title: self ? 'Luluskan cuti sendiri?' : `Luluskan cuti ${l.emp.full_name}?`,
        message: `${LEAVE_TYPE[l.leave_type]}, ${range(l)}.${self ? ' Owner akan dimaklumkan dan rekod ditanda "lulus sendiri".' : ''}`,
        fields: [{ name: 'note', label: 'Nota (pilihan)', type: 'textarea', maxlength: 1000 }],
        confirm: self ? 'Lulus sendiri' : 'Luluskan',
        onSubmit: async (v) => { const r = await call(() => client.rpc('review_leave', { p_leave_id: l.id, p_approve: true, p_note: v.note || null })); return r.error ? messageFor(r.error) : ''; },
      });
      if (ok) { toast('Cuti diluluskan.'); rerender(); }
    }));
    el.querySelectorAll('[data-reject]').forEach((b) => b.addEventListener('click', async () => {
      const l = byId.get(b.dataset.reject);
      const ok = await dialog({
        title: `Tolak cuti ${l.emp.full_name}?`, message: `${LEAVE_TYPE[l.leave_type]}, ${range(l)}.`,
        fields: [{ name: 'note', label: 'Sebab ditolak (wajib, pemohon akan nampak)', type: 'textarea', required: true, maxlength: 1000 }],
        confirm: 'Tolak', danger: true,
        onSubmit: async (v) => { const r = await call(() => client.rpc('review_leave', { p_leave_id: l.id, p_approve: false, p_note: v.note })); return r.error ? messageFor(r.error) : ''; },
      });
      if (ok) { toast('Cuti ditolak.'); rerender(); }
    }));
    el.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', async () => {
      const l = byId.get(b.dataset.cancel);
      if (!confirm('Batalkan permohonan cuti ini?')) return;
      const { error } = await busy(b, () => call(() => client.rpc('cancel_leave', { p_leave_id: l.id, p_note: null })));
      if (error) return toast(messageFor(error), 'error');
      toast('Permohonan dibatalkan.'); rerender();
    }));
  }
  draw();

  el.querySelector('#apply').addEventListener('click', () => applyDialog(ctx, behalf, empFilter).then((ok) => ok && rerender()));
}

function range(l) {
  const n = days(l.start_date, l.end_date);
  return l.start_date === l.end_date ? `${fmtDate(l.start_date)} (1 hari)` : `${fmtDate(l.start_date)} – ${fmtDate(l.end_date)} (${n} hari)`;
}

function card(ctx, l, tab, nameByProfile) {
  const [label, cls] = STATUS[l.status];
  const self = l.emp && isSelf(ctx, l.emp);
  const reviewerName = l.reviewed_by_profile_id ? nameByProfile.get(l.reviewed_by_profile_id) : null;
  const submitter = l.submitted_by_profile_id && !self && nameByProfile.get(l.submitted_by_profile_id);
  const onBehalf = l.emp?.profile?.id !== l.submitted_by_profile_id && !self && submitter;
  const canRev = l.status === 'pending' && l.emp && canReviewLeave(ctx, l.emp);
  const canSelf = l.status === 'pending' && self && canSelfApprove(ctx);
  const canCancel = l.status === 'pending' && l.emp && (self || canActOnBehalf(ctx, l.emp));
  return `
    <li class="card-item">
      <div class="card-top">
        <div>
          ${tab !== 'saya' ? `<b>${esc(l.emp?.full_name || 'Pekerja')}</b>` : `<b>${esc(LEAVE_TYPE[l.leave_type])}</b>`}
          <span class="muted small block">${tab !== 'saya' ? `${esc(LEAVE_TYPE[l.leave_type])} · ` : ''}${esc(range(l))}</span>
        </div>
        <div class="badges"><span class="badge ${cls}">${label}</span>
          ${l.self_approved ? '<span class="badge pending">Lulus sendiri</span>' : ''}${l.auto_approved ? '<span class="badge muted-badge">Auto</span>' : ''}</div>
      </div>
      ${l.reason ? `<p class="small">${esc(l.reason)}</p>` : ''}
      ${onBehalf ? `<p class="muted small">Direkod bagi pihak oleh ${esc(submitter)}</p>` : ''}
      ${l.reviewed_at ? `<p class="muted small">${l.status === 'rejected' ? 'Ditolak' : 'Diluluskan'} ${reviewerName ? `oleh ${esc(reviewerName)} ` : ''}pada ${esc(fmtDate(l.reviewed_at))}${l.review_note ? ` — “${esc(l.review_note)}”` : ''}</p>` : ''}
      ${l.cancelled_at ? `<p class="muted small">Dibatalkan pada ${esc(fmtDate(l.cancelled_at))}</p>` : ''}
      ${canRev || canSelf || canCancel ? `<div class="actions">
        ${canRev ? `<button class="primary" type="button" data-approve="${l.id}">Luluskan</button><button class="danger-outline" type="button" data-reject="${l.id}">Tolak</button>` : ''}
        ${canSelf ? `<button class="secondary" type="button" data-approve="${l.id}">Lulus sendiri</button>` : ''}
        ${canCancel ? `<button class="link" type="button" data-cancel="${l.id}">Batalkan</button>` : ''}
      </div>` : ''}
    </li>`;
}

// Apply for own leave, or record for a no-login employee (behalf list).
export async function applyDialog(ctx, behalf, preselect) {
  const who = [[ctx.me.employee_id, `Saya sendiri (${ctx.me.employee?.full_name || ''})`], ...behalf.map((e) => [e.id, `${e.full_name} — tiada login`])];
  return dialog({
    title: 'Mohon cuti',
    message: behalf.length ? 'Pekerja tanpa login boleh direkodkan cutinya oleh anda.' : '',
    confirm: 'Hantar permohonan',
    fields: [
      ...(behalf.length ? [{ name: 'who', label: 'Untuk', type: 'select', options: who, value: preselect && behalf.some((e) => e.id === preselect) ? preselect : ctx.me.employee_id }] : []),
      { name: 'type', label: 'Jenis cuti', type: 'select', options: Object.entries(LEAVE_TYPE), value: 'annual' },
      { name: 'start', label: 'Tarikh mula', type: 'date', value: today(), required: true },
      { name: 'end', label: 'Tarikh akhir', type: 'date', value: today(), required: true },
      { name: 'reason', label: 'Sebab / catatan', type: 'textarea', maxlength: 1000 },
    ],
    onSubmit: async (v) => {
      if (v.end < v.start) return 'Tarikh akhir mesti sama atau selepas tarikh mula.';
      if (days(v.start, v.end) > 367) return 'Satu permohonan maksimum setahun.';
      const forOther = v.who && v.who !== ctx.me.employee_id;
      const r = await call(() => client.rpc('submit_leave', {
        p_leave_type: v.type, p_start_date: v.start, p_end_date: v.end, p_reason: v.reason || null,
        p_employee_id: forOther ? v.who : null,
      }));
      if (r.error) return messageFor(r.error);
      toast(forOther ? 'Cuti direkodkan.' : 'Permohonan cuti dihantar.');
      return '';
    },
  });
}

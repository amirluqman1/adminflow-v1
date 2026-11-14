// Profil Staf — employment info, login account & access (role, outlets, Syarikat), invitation, status.
import { client, call, messageFor, ROLE_LABEL } from '../api.js';
import { esc, fmtDate, alertBox, options, EMP_TYPE, toast, dialog, busy } from '../ui.js';
import { loadEmployee } from '../store.js';
import {
  canEditEmployee, canSetStatus, canSetAccount, canInvite, inviteRoles, roleChoices,
  canAssignOutlets, canAssignEntities, canManage, isSelf, canSeeDirectory, canSeeActivity,
} from '../perm.js';
import { showInviteLink } from '../invite.js';
import { initials } from './staff-list.js';

export async function renderStaffProfile(ctx, el, id) {
  const seq = ctx.seq;
  const e = await loadEmployee(ctx, id);
  if (ctx.stale(seq)) return;
  if (!e) {
    el.innerHTML = `<h1>Pekerja tidak dijumpai</h1>${alertBox('error', 'Rekod ini tiada atau di luar skop akses anda.')}<a href="#/staf">← Kembali ke direktori</a>`;
    return;
  }
  const rerender = () => renderStaffProfile(ctx, el, id);
  const self = isSelf(ctx, e);
  const outlet = e.outlet_id ? ctx.outletById.get(e.outlet_id) : null;
  const entity = e.legal_entity_id ? ctx.entityById.get(e.legal_entity_id) : null;
  const row = (k, v) => `<div><dt>${esc(k)}</dt><dd>${v ? esc(v) : '<span class="muted">—</span>'}</dd></div>`;

  el.innerHTML = `
    ${canSeeDirectory(ctx) && !self ? '<a class="back" href="#/staf">← Direktori Staf</a>' : ''}
    <div class="profile-head">
      <span class="avatar lg" aria-hidden="true">${esc(initials(e.full_name))}</span>
      <div>
        <h1>${esc(e.full_name)}${self ? ' <span class="muted small">(anda)</span>' : ''}</h1>
        <p class="muted">${esc(e.position || 'Tiada jawatan')}</p>
        <div class="badges">
          ${e.status === 'active' ? '<span class="badge ok-badge">Aktif</span>' : `<span class="badge danger-badge">Tidak aktif sejak ${esc(fmtDate(e.deactivated_at))}</span>`}
          ${e.profile ? `<span class="badge">${esc(ROLE_LABEL[e.profile.role])}</span>` : ''}
        </div>
      </div>
      ${canEditEmployee(ctx, e) ? `<a class="btn secondary" href="#/staf/${e.id}/edit">Edit</a>` : ''}
    </div>

    <section class="panel">
      <h2>Maklumat pekerjaan</h2>
      <dl class="info">
        ${row('No. pekerja', e.employee_no)}
        ${row('Syarikat', entity ? entity.name : 'Peringkat Group')}
        ${row('Outlet', outlet ? outlet.name : 'HQ / tiada outlet')}
        ${row('Jenis pekerjaan', EMP_TYPE[e.employment_type])}
        ${row('Tarikh mula', e.join_date ? fmtDate(e.join_date) : '')}
        ${row('Telefon', e.phone)}
        ${row('Emel', e.email)}
      </dl>
    </section>

    <section class="panel">
      <h2>Cuti & tugasan</h2>
      <div class="actions tight">
        <a class="btn secondary" href="${self ? '#/cuti?tab=saya' : `#/cuti?tab=semua&emp=${e.id}`}">Lihat cuti</a>
        <a class="btn secondary" href="${self ? '#/tugasan?tab=saya' : `#/tugasan?tab=semua&emp=${e.id}`}">Lihat tugasan</a>
        ${canSeeActivity(ctx) ? `<a class="btn secondary" href="#/aktiviti?emp=${e.id}">Sejarah aktiviti</a>` : ''}
      </div>
      ${!e.profile?.is_active && e.status === 'active' && canSeeDirectory(ctx) ? '<p class="muted small">Pekerja ini tiada login aktif: cuti boleh direkod dan status tugasan dikemas kini bagi pihaknya.</p>' : ''}
    </section>
    <section class="panel" id="account"></section>
    ${canSetStatus(ctx, e) ? '<section class="panel" id="status"></section>' : ''}`;

  renderAccount(ctx, el.querySelector('#account'), e, rerender);
  if (canSetStatus(ctx, e)) renderStatus(el.querySelector('#status'), e, rerender);
}

// ---------------------------------------------------------------- account & access
function renderAccount(ctx, sec, e, rerender) {
  const p = e.profile;
  const self = isSelf(ctx, e);

  if (!p) {
    let html = '<h2>Akaun login</h2>';
    if (e.pendingInvite) {
      html += `<p>Jemputan <b>${esc(ROLE_LABEL[e.pendingInvite.role])}</b> dihantar ke ${esc(e.pendingInvite.email)},
        menunggu sehingga ${esc(fmtDate(e.pendingInvite.expires_at))}.</p>`;
    } else {
      html += '<p class="muted">Pekerja ini belum ada akaun login. Cuti dan tugasan masih boleh direkod bagi pihak mereka.</p>';
    }
    if (canInvite(ctx, e)) {
      if (!e.email) {
        html += alertBox('error', 'Tambah emel pekerja dahulu (butang Edit) untuk menjemput.');
      } else {
        html += `
          <div class="actions">
            <label class="inline">Peranan<select id="inv-role">${options(inviteRoles(ctx).map((r) => [r, ROLE_LABEL[r]]), e.pendingInvite?.role || 'staff')}</select></label>
            <button class="primary" type="button" id="inv-make">${e.pendingInvite ? 'Buat pautan baharu' : 'Buat pautan jemputan'}</button>
            ${e.pendingInvite ? '<button class="secondary" type="button" id="inv-revoke">Batalkan jemputan</button>' : ''}
          </div>
          <div id="inv-out"></div>`;
      }
    }
    sec.innerHTML = html;
    sec.querySelector('#inv-make')?.addEventListener('click', async (ev) => {
      if (e.pendingInvite && !confirm('Pautan lama akan dibatalkan dan tidak boleh digunakan lagi. Teruskan?')) return;
      const role = sec.querySelector('#inv-role').value;
      if (['admin', 'owner'].includes(role) && !confirm(`Jemput sebagai ${ROLE_LABEL[role]}? Peranan ini ada akses luas.`)) return;
      const { data, error } = await busy(ev.currentTarget, () => call(() => client.rpc('create_invitation', { p_employee_id: e.id, p_role: role })));
      const out = sec.querySelector('#inv-out');
      if (error) { out.innerHTML = alertBox('error', messageFor(error)); return; }
      showInviteLink(out, e.full_name, data);
      sec.querySelector('#inv-revoke')?.remove();
      sec.querySelector('#inv-make').textContent = 'Buat pautan baharu';
      e.pendingInvite = { role, email: data.email, expires_at: data.expires_at, id: data.invitation_id };
    });
    sec.querySelector('#inv-revoke')?.addEventListener('click', async (ev) => {
      if (!confirm('Batalkan jemputan ini? Pautan yang sudah dihantar tidak akan berfungsi lagi.')) return;
      const { error } = await busy(ev.currentTarget, () => call(() => client.rpc('revoke_invitation', { p_invitation_id: e.pendingInvite.id })));
      if (error) return toast(messageFor(error), 'error');
      toast('Jemputan dibatalkan.');
      rerender();
    });
    return;
  }

  // has an account
  const outletChips = e.managerOutletIds.map((oid) => [oid, ctx.outletById.get(oid)?.name || 'Outlet']);
  const entityChips = e.adminEntityIds.map((eid) => [eid, ctx.entityById.get(eid)?.name || 'Syarikat']);
  const choices = roleChoices(ctx, e);
  const showOutlets = p.role === 'manager' && (canManage(ctx) || self);
  const showEntities = p.role === 'admin' && (ctx.me.role === 'owner' || self);
  const myCovers = self && p.role === 'manager' ? [...ctx.myOutletIds].map((oid) => [oid, ctx.outletById.get(oid)?.name]) : outletChips;
  const myEntities = self && p.role === 'admin' ? [...ctx.myEntityIds].map((eid) => [eid, ctx.entityById.get(eid)?.name]) : entityChips;

  sec.innerHTML = `
    <h2>Akaun & akses</h2>
    <dl class="info">
      <div><dt>Peranan</dt><dd><span class="badge">${esc(ROLE_LABEL[p.role])}</span></dd></div>
      <div><dt>Akaun login</dt><dd>${p.is_active ? `Aktif sejak ${esc(fmtDate(p.activated_at))}` : `<span class="danger-text">Ditutup ${esc(fmtDate(p.deactivated_at))}</span>`}</dd></div>
    </dl>
    ${choices.length ? `
      <div class="actions">
        <label class="inline">Tukar peranan<select id="role-new">${options(choices.map((r) => [r, ROLE_LABEL[r]]), '', { empty: 'Pilih…' })}</select></label>
        <button class="secondary" type="button" id="role-save">Tukar</button>
      </div>` : ''}
    ${showOutlets ? `
      <h3>Outlet yang dijaga</h3>
      ${chipList(myCovers, canAssignOutlets(ctx, e) ? 'mo' : null, 'Belum ada outlet — Admin Outlet tanpa outlet tidak nampak sesiapa.')}
      ${canAssignOutlets(ctx, e) ? addRow('mo', ctx.outlets.filter((o) => o.is_active && !e.managerOutletIds.includes(o.id)).map((o) => [o.id, o.name]), 'Tambah outlet') : ''}` : ''}
    ${showEntities ? `
      <h3>Syarikat yang diurus</h3>
      ${chipList(myEntities, canAssignEntities(ctx, e) ? 'ae' : null, 'Belum ada Syarikat — Admin tanpa Syarikat hanya nampak dirinya sendiri.')}
      ${canAssignEntities(ctx, e) ? addRow('ae', ctx.entities.filter((x) => x.is_active && !e.adminEntityIds.includes(x.id)).map((x) => [x.id, x.name]), 'Tambah Syarikat') : ''}` : ''}
    ${canSetAccount(ctx, e) && e.status === 'active' ? `
      <div class="actions">
        <button class="${p.is_active ? 'danger-outline' : 'secondary'}" type="button" id="acct-toggle">${p.is_active ? 'Tutup akaun login' : 'Buka semula akaun login'}</button>
      </div>
      <p class="muted small">${p.is_active ? 'Menutup akaun menghalang log masuk tetapi rekod pekerja dan sejarah kekal.' : ''}</p>` : ''}`;

  sec.querySelector('#role-save')?.addEventListener('click', async () => {
    const to = sec.querySelector('#role-new').value;
    if (!to) return toast('Pilih peranan baharu dahulu.', 'error');
    const warn = to === 'owner' ? ' Owner nampak dan boleh ubah semua Syarikat.' : to === 'admin' ? ' Ingat untuk tetapkan Syarikat yang diurus selepas ini.' : '';
    const ok = await dialog({
      title: `Tukar peranan kepada ${ROLE_LABEL[to]}?`,
      message: `${e.full_name}: ${ROLE_LABEL[p.role]} → ${ROLE_LABEL[to]}.${warn}`,
      fields: [{ name: 'note', label: 'Sebab / nota (disimpan dalam sejarah)', type: 'textarea', maxlength: 500 }],
      confirm: 'Tukar peranan',
      onSubmit: async (v) => { const r = await call(() => client.rpc('change_role', { p_profile_id: p.id, p_new_role: to, p_note: v.note || null })); return r.error ? messageFor(r.error) : ''; },
    });
    if (ok) { toast('Peranan ditukar.'); rerender(); }
  });

  sec.querySelector('#acct-toggle')?.addEventListener('click', async () => {
    const closing = p.is_active;
    const ok = await dialog({
      title: closing ? 'Tutup akaun login?' : 'Buka semula akaun login?',
      message: closing ? `${e.full_name} tidak akan boleh log masuk. Rekod pekerja kekal.` : `${e.full_name} boleh log masuk semula dengan peranan ${ROLE_LABEL[p.role]}.`,
      fields: [{ name: 'note', label: 'Sebab / nota', type: 'textarea', maxlength: 500 }],
      confirm: closing ? 'Tutup akaun' : 'Buka akaun', danger: closing,
      onSubmit: async (v) => { const r = await call(() => client.rpc('set_account_active', { p_profile_id: p.id, p_active: !closing, p_note: v.note || null })); return r.error ? messageFor(r.error) : ''; },
    });
    if (ok) { toast(closing ? 'Akaun ditutup.' : 'Akaun dibuka semula.'); rerender(); }
  });

  wireChips(sec, 'mo', async (oid, add) => call(() => client.rpc(add ? 'assign_manager_outlet' : 'remove_manager_outlet', { p_profile_id: p.id, p_outlet_id: oid })), rerender);
  wireChips(sec, 'ae', async (eid, add) => call(() => client.rpc(add ? 'assign_admin_entity' : 'remove_admin_entity', { p_profile_id: p.id, p_legal_entity_id: eid })), rerender);
}

function chipList(items, key, emptyText) {
  if (!items.length) return `<p class="muted small">${esc(emptyText)}</p>`;
  return `<ul class="chips">${items.map(([id, name]) => `<li class="chip">${esc(name)}${key ? ` <button type="button" class="chip-x" data-${key}-remove="${id}" aria-label="Buang ${esc(name)}">×</button>` : ''}</li>`).join('')}</ul>`;
}

function addRow(key, opts, label) {
  if (!opts.length) return '';
  return `<div class="actions"><label class="inline">${esc(label)}<select id="${key}-add">${options(opts, '', { empty: 'Pilih…' })}</select></label>
    <button class="secondary" type="button" id="${key}-add-btn">Tambah</button></div>`;
}

function wireChips(sec, key, rpc, rerender) {
  sec.querySelectorAll(`[data-${key}-remove]`).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Buang akses ini?')) return;
    const { error } = await busy(b, () => rpc(b.dataset[`${key}Remove`], false));
    if (error) return toast(messageFor(error), 'error');
    toast('Akses dibuang.'); rerender();
  }));
  sec.querySelector(`#${key}-add-btn`)?.addEventListener('click', async (ev) => {
    const val = sec.querySelector(`#${key}-add`).value;
    if (!val) return toast('Pilih dahulu.', 'error');
    const { error } = await busy(ev.currentTarget, () => rpc(val, true));
    if (error) return toast(messageFor(error), 'error');
    toast('Akses ditambah.'); rerender();
  });
}

// ---------------------------------------------------------------- employment status
function renderStatus(sec, e, rerender) {
  const active = e.status === 'active';
  sec.innerHTML = `
    <h2>Status pekerja</h2>
    <p class="muted">${active
      ? 'Nyahaktif apabila pekerja berhenti. Login akan ditutup dan jemputan dibatalkan, tetapi semua rekod & sejarah disimpan (tiada padam kekal).'
      : 'Aktifkan semula jika pekerja kembali bekerja. Akaun login perlu dibuka semula secara berasingan.'}</p>
    <button class="${active ? 'danger-outline' : 'secondary'}" type="button" id="st">${active ? 'Nyahaktif pekerja' : 'Aktifkan semula pekerja'}</button>`;
  sec.querySelector('#st').addEventListener('click', async () => {
    const ok = await dialog({
      title: active ? `Nyahaktif ${e.full_name}?` : `Aktifkan semula ${e.full_name}?`,
      message: active ? 'Login ditutup serta-merta dan jemputan dibatalkan.' : '',
      fields: [{ name: 'note', label: active ? 'Sebab (cth: berhenti kerja)' : 'Nota', type: 'textarea', maxlength: 500, required: active }],
      confirm: active ? 'Nyahaktif' : 'Aktifkan semula', danger: active,
      onSubmit: async (v) => { const r = await call(() => client.rpc('set_employee_status', { p_employee_id: e.id, p_active: !active, p_note: v.note || null })); return r.error ? messageFor(r.error) : ''; },
    });
    if (ok) { toast(active ? 'Pekerja dinyahaktif.' : 'Pekerja diaktifkan semula.'); rerender(); }
  });
}

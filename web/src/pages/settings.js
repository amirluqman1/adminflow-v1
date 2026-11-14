// Tetapan & Akses — Syarikat, outlets, who manages what, pending invitations.
// Owner: everything. Admin: outlets inside own Syarikat, Admin Outlet assignments, own invitations.
import { client, call, messageFor, ROLE_LABEL } from '../api.js';
import { esc, fmtDate, options, toast, dialog, busy } from '../ui.js';
import { loadStaff, refreshStructure } from '../store.js';
import { isOwner } from '../perm.js';

export async function renderSettings(ctx, el) {
  const seq = ctx.seq;
  await refreshStructure(ctx);
  const staff = await loadStaff(ctx);
  if (ctx.stale(seq)) return;
  const rerender = () => renderSettings(ctx, el);
  const owner = isOwner(ctx);
  const entName = (id) => ctx.entityById.get(id)?.name || '—';
  const outletsOf = (eid) => ctx.outlets.filter((o) => o.legal_entity_id === eid);
  const people = (role) => staff.filter((s) => s.profile?.role === role && s.profile.is_active && s.status === 'active');
  const admins = people('admin');
  const managers = people('manager');
  const pending = staff.filter((s) => s.pendingInvite);

  el.innerHTML = `
    <div class="page-head"><div><h1>Tetapan & Akses</h1>
      <p class="muted">${owner ? 'Struktur Group, Syarikat, outlet dan siapa mengurus apa.' : 'Outlet dalam Syarikat anda dan akses Admin Outlet.'}</p></div></div>

    <section class="panel">
      <div class="panel-head"><h2>Syarikat & outlet</h2>
        <div class="actions tight">
          ${owner ? '<button class="secondary" type="button" id="add-ent">+ Syarikat</button>' : ''}
          ${ctx.entities.some((x) => x.is_active) ? '<button class="secondary" type="button" id="add-out">+ Outlet</button>' : ''}
        </div></div>
      ${ctx.entities.length ? ctx.entities.map((x) => `
        <div class="entity">
          <div class="entity-head">
            <div><b>${esc(x.name)}</b>${x.is_active ? '' : ' <span class="badge danger-badge">Tidak aktif</span>'}
              <span class="muted small block">${x.registration_no ? `SSM ${esc(x.registration_no)}` : 'Tiada no. SSM'}</span></div>
            ${owner ? `<button class="link" type="button" data-edit-ent="${x.id}">Edit</button>` : ''}
          </div>
          <ul class="outlets">${outletsOf(x.id).map((o) => `
            <li><span><b>${esc(o.name)}</b>${o.code ? ` <span class="muted">(${esc(o.code)})</span>` : ''}${o.is_active ? '' : ' <span class="badge danger-badge">Tidak aktif</span>'}
              ${o.address ? `<span class="muted small block">${esc(o.address)}</span>` : ''}</span>
              <button class="link" type="button" data-edit-out="${o.id}">Edit</button></li>`).join('') || '<li class="muted small">Belum ada outlet.</li>'}
          </ul>
        </div>`).join('') : '<p class="muted">Tiada Syarikat dalam skop anda.</p>'}
    </section>

    ${owner ? `
    <section class="panel">
      <h2>Admin & Syarikat</h2>
      <p class="muted small">Admin hanya nampak dan mengurus Syarikat yang diberi di sini. Hanya Owner nampak semua.</p>
      ${admins.length ? `<ul class="assign">${admins.map((a) => `
        <li><a href="#/staf/${a.id}"><b>${esc(a.full_name)}</b></a>
          <span class="muted small block">${a.adminEntityIds.length ? a.adminEntityIds.map((id) => esc(entName(id))).join(', ') : '<span class="danger-text">Belum ada Syarikat</span>'}</span></li>`).join('')}</ul>`
      : '<p class="muted small">Tiada Admin lagi. Jemput pekerja sebagai Admin dari profil mereka.</p>'}
    </section>` : ''}

    <section class="panel">
      <h2>Admin Outlet & outlet</h2>
      <p class="muted small">Admin Outlet mengurus staf, cuti dan tugasan bagi outlet yang ditetapkan sahaja.</p>
      ${managers.length ? `<ul class="assign">${managers.map((m) => `
        <li><a href="#/staf/${m.id}"><b>${esc(m.full_name)}</b></a>
          <span class="muted small block">${m.managerOutletIds.length ? m.managerOutletIds.map((id) => esc(ctx.outletById.get(id)?.name || 'Outlet')).join(', ') : '<span class="danger-text">Belum ada outlet</span>'}</span></li>`).join('')}</ul>`
      : '<p class="muted small">Tiada Admin Outlet lagi.</p>'}
      <p class="muted small">Untuk tambah/buang akses, buka profil orang itu.</p>
    </section>

    <section class="panel">
      <h2>Jemputan menunggu</h2>
      ${pending.length ? `<ul class="assign">${pending.map((s) => `
        <li><div><a href="#/staf/${s.id}"><b>${esc(s.full_name)}</b></a>
          <span class="muted small block">${esc(ROLE_LABEL[s.pendingInvite.role])} · ${esc(s.pendingInvite.email)} · tamat ${esc(fmtDate(s.pendingInvite.expires_at))}</span></div>
          <button class="link danger-text" type="button" data-revoke="${s.pendingInvite.id}">Batalkan</button></li>`).join('')}</ul>`
      : '<p class="muted small">Tiada jemputan menunggu.</p>'}
    </section>`;

  // ---- Syarikat (Owner only)
  el.querySelector('#add-ent')?.addEventListener('click', async () => {
    const ok = await dialog({
      title: 'Tambah Syarikat', confirm: 'Tambah',
      fields: [
        { name: 'name', label: 'Nama Syarikat', required: true, maxlength: 160 },
        { name: 'reg', label: 'No. pendaftaran SSM', hint: 'Pilihan', maxlength: 60 },
      ],
      onSubmit: async (v) => { const r = await call(() => client.rpc('create_legal_entity', { p_name: v.name, p_registration_no: v.reg || null })); return r.error ? messageFor(r.error) : ''; },
    });
    if (ok) { toast('Syarikat ditambah.'); rerender(); }
  });
  el.querySelectorAll('[data-edit-ent]').forEach((b) => b.addEventListener('click', async () => {
    const x = ctx.entityById.get(b.dataset.editEnt);
    const ok = await dialog({
      title: `Edit ${x.name}`,
      fields: [
        { name: 'name', label: 'Nama Syarikat', required: true, value: x.name, maxlength: 160 },
        { name: 'reg', label: 'No. pendaftaran SSM', value: x.registration_no, maxlength: 60 },
        { name: 'active', label: 'Syarikat aktif', type: 'checkbox', value: x.is_active },
      ],
      onSubmit: async (v) => {
        if (!v.active && x.is_active && !confirm('Nyahaktif Syarikat ini? Rekod kekal, tetapi ia tidak boleh dipilih untuk pekerja/outlet baharu.')) return 'Dibatalkan.';
        const r = await call(() => client.rpc('update_legal_entity', { p_legal_entity_id: x.id, p_name: v.name, p_registration_no: v.reg || null, p_is_active: v.active }));
        return r.error ? messageFor(r.error) : '';
      },
    });
    if (ok) { toast('Syarikat dikemas kini.'); rerender(); }
  }));

  // ---- Outlets (Owner; Admin inside own Syarikat)
  const entOpts = () => ctx.entities.filter((x) => x.is_active).map((x) => [x.id, x.name]);
  const outletFields = (o = {}) => [
    { name: 'name', label: 'Nama outlet', required: true, value: o.name, maxlength: 120 },
    { name: 'entity', label: 'Syarikat', type: 'select', options: entOpts(), value: o.legal_entity_id || entOpts()[0]?.[0], required: true },
    { name: 'code', label: 'Kod outlet', hint: 'Pilihan, huruf besar/nombor, cth AMF01', value: o.code, maxlength: 20, upper: true },
    { name: 'address', label: 'Alamat', type: 'textarea', value: o.address, maxlength: 500 },
  ];
  el.querySelector('#add-out')?.addEventListener('click', async () => {
    const ok = await dialog({
      title: 'Tambah outlet', confirm: 'Tambah', fields: outletFields(),
      onSubmit: async (v) => { const r = await call(() => client.rpc('create_outlet', { p_name: v.name, p_legal_entity_id: v.entity, p_code: v.code || null, p_address: v.address || null })); return r.error ? messageFor(r.error) : ''; },
    });
    if (ok) { toast('Outlet ditambah.'); rerender(); }
  });
  el.querySelectorAll('[data-edit-out]').forEach((b) => b.addEventListener('click', async () => {
    const o = ctx.outletById.get(b.dataset.editOut);
    const ok = await dialog({
      title: `Edit ${o.name}`,
      fields: [...outletFields(o), { name: 'active', label: 'Outlet aktif', type: 'checkbox', value: o.is_active }],
      onSubmit: async (v) => {
        const r = await call(() => client.rpc('update_outlet', { p_outlet_id: o.id, p_name: v.name, p_legal_entity_id: v.entity, p_code: v.code || null, p_address: v.address || null, p_is_active: v.active }));
        return r.error ? messageFor(r.error) : '';
      },
    });
    if (ok) { toast('Outlet dikemas kini.'); rerender(); }
  }));

  // ---- invitations
  el.querySelectorAll('[data-revoke]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Batalkan jemputan ini? Pautan yang sudah dihantar tidak akan berfungsi lagi.')) return;
    const { error } = await busy(b, () => call(() => client.rpc('revoke_invitation', { p_invitation_id: b.dataset.revoke })));
    if (error) return toast(messageFor(error), 'error');
    toast('Jemputan dibatalkan.'); rerender();
  }));
}

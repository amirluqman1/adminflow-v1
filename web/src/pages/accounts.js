// Owner/Admin: employees, logins, invitations and roles. Every write is an RPC; the database
// re-checks every rule (Option C role matrix, last Owner, never self), the UI only hides
// buttons that would certainly be refused.
import { select, rpc } from '../neon.js';
import { $, esc, render, onSubmit, toast, ROLE_BM, date } from '../ui.js';
import { state, route } from '../main.js';

export async function accounts() {
  const [emps, profs, invs, outlets] = await Promise.all([
    select('employees', 'id,full_name,email,phone,position,outlet_id,status', q => q.order('full_name')),
    select('profiles', 'id,employee_id,role,is_active'),
    select('account_invitations', 'id,employee_id,email,role,status,expires_at', q => q.eq('status', 'pending')),
    select('outlets', 'id,name,is_active', q => q.order('name')),
  ]);
  const me = state.profile;
  const isOwner = me.role === 'owner';
  const outletName = id => outlets.find(o => o.id === id)?.name ?? 'HQ';
  const prof = Object.fromEntries(profs.map(p => [p.employee_id, p]));
  const inv = Object.fromEntries(invs.filter(i => new Date(i.expires_at) > new Date()).map(i => [i.employee_id, i]));
  const rolesICanGive = isOwner ? ['staff', 'manager', 'admin', 'owner'] : ['staff', 'manager'];
  // Option C: Admin may only touch Staff/Manager accounts; nobody touches their own.
  const canManage = p => p && p.id !== me.id && (isOwner || ['staff', 'manager'].includes(p.role));

  const card = e => {
    const p = prof[e.id], i = inv[e.id];
    let status, actions = '';
    if (e.status !== 'active') status = '<span class="badge off">Pekerja tidak aktif</span>';
    else if (p) {
      status = `<span class="badge">${ROLE_BM[p.role]}</span>${p.is_active ? '' : ' <span class="badge off">Akaun dinyahaktif</span>'}`;
      if (canManage(p)) actions = `
        <select data-role="${p.id}" aria-label="Tukar peranan">${rolesICanGive.map(r => `<option value="${r}"${r === p.role ? ' selected' : ''}>${ROLE_BM[r]}</option>`).join('')}</select>
        <button type="button" class="ghost" data-active="${p.id}" data-to="${!p.is_active}">${p.is_active ? 'Nyahaktif akaun' : 'Aktifkan akaun'}</button>`;
    } else if (i) {
      status = `<span class="badge pending">Jemputan ${ROLE_BM[i.role]} · tamat ${date(i.expires_at)}</span>`;
      actions = `<button type="button" class="ghost" data-invite="${e.id}">Hantar semula</button>
                 <button type="button" class="ghost danger" data-revoke="${i.id}">Batal jemputan</button>`;
    } else {
      status = '<span class="badge off">Tiada akaun</span>';
      actions = `<button type="button" data-invite="${e.id}">Jemput</button>`;
    }
    return `<li class="emp"><div><b>${esc(e.full_name)}</b><small>${esc(e.position || '')}${e.position ? ' · ' : ''}${esc(outletName(e.outlet_id))}${e.email ? ' · ' + esc(e.email) : ''}</small>${status}</div>
      <div class="actions">${actions}</div></li>`;
  };

  render(`
    <section class="card">
      <div class="row"><h1>Akaun & Jemputan</h1><button type="button" id="add">+ Pekerja</button></div>
      <p class="muted">Pekerja tanpa akaun tetap boleh diurus (cuti/tugasan bagi pihak mereka). Jemputan sah 7 hari dan hanya untuk email yang sama.</p>
      <ul class="emps">${emps.map(card).join('') || '<li class="muted">Belum ada pekerja.</li>'}</ul>
    </section>

    <dialog id="dInvite"><form id="fInvite" method="dialog">
      <h2>Jemput <span id="invName"></span></h2>
      <input type="hidden" name="employee_id">
      <label>Email<input name="email" type="email" required></label>
      <label>Peranan<select name="role">${rolesICanGive.map(r => `<option value="${r}"${r === 'staff' ? ' selected' : ''}>${ROLE_BM[r]}</option>`).join('')}</select></label>
      <p class="error"></p>
      <div class="row"><button type="button" class="ghost" data-close>Batal</button><button type="submit">Cipta jemputan</button></div>
    </form></dialog>

    <dialog id="dLink"><div class="pad">
      <h2>Pautan jemputan</h2>
      <p class="warnbox">Pautan ini dipaparkan <b>sekali sahaja</b>. Hantar terus kepada <b id="linkEmail"></b>. Sesiapa yang ada pautan ini masih perlu log masuk dengan email tersebut.</p>
      <textarea id="link" readonly rows="3"></textarea>
      <div class="row"><button type="button" id="copy">Salin</button><a id="wa" class="btn" target="_blank" rel="noopener">WhatsApp</a><button type="button" class="ghost" data-close>Tutup</button></div>
    </div></dialog>

    <dialog id="dAdd"><form id="fAdd" method="dialog">
      <h2>Tambah pekerja</h2>
      <label>Nama penuh<input name="full_name" required minlength="2" maxlength="120"></label>
      <label>Outlet<select name="outlet_id"><option value="">HQ / tiada outlet</option>${outlets.filter(o => o.is_active).map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select></label>
      <label>Jawatan<input name="position" maxlength="80"></label>
      <label>Email <small>(perlu untuk jemputan)</small><input name="email" type="email"></label>
      <label>Telefon<input name="phone" inputmode="tel" placeholder="012-345 6789"></label>
      <p class="error"></p>
      <div class="row"><button type="button" class="ghost" data-close>Batal</button><button type="submit">Simpan</button></div>
    </form></dialog>`);

  document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.closest('dialog').close());

  const showLink = (token, email) => {
    const url = `${location.origin}${location.pathname}#/jemputan/${token}`;
    $('#link').value = url; $('#linkEmail').textContent = email;
    $('#wa').href = 'https://wa.me/?text=' + encodeURIComponent(`Jemputan AdminFlow. Daftar/log masuk dengan email ${email}, kemudian buka pautan ini: ${url}`);
    $('#dLink').showModal();
  };
  $('#copy').onclick = async () => { await navigator.clipboard.writeText($('#link').value).catch(() => $('#link').select()); toast('Pautan disalin.'); };
  $('#dLink').addEventListener('close', () => { $('#link').value = ''; route(); });

  document.querySelectorAll('[data-invite]').forEach(b => b.onclick = () => {
    const e = emps.find(x => x.id === b.dataset.invite);
    const f = $('#fInvite');
    f.employee_id.value = e.id; f.email.value = inv[e.id]?.email || e.email || '';
    if (inv[e.id]) f.role.value = inv[e.id].role;
    $('#invName').textContent = e.full_name;
    $('#dInvite').showModal();
  });
  onSubmit($('#fInvite'), async ({ employee_id, email, role }) => {
    const r = await rpc('create_invitation', { p_employee_id: employee_id, p_role: role, p_email: email.trim() });
    $('#dInvite').close();
    showLink(r.token, r.email);
  });

  document.querySelectorAll('[data-revoke]').forEach(b => b.onclick = async () => {
    if (!confirm('Batalkan jemputan ini? Pautan lama tidak boleh digunakan lagi.')) return;
    try { await rpc('revoke_invitation', { p_invitation_id: b.dataset.revoke }); toast('Jemputan dibatalkan.'); route(); }
    catch (e) { toast((await import('../errors.js')).bm(e), 'error'); }
  });

  document.querySelectorAll('[data-role]').forEach(s => s.onchange = async () => {
    const p = profs.find(x => x.id === s.dataset.role);
    if (!confirm(`Tukar peranan kepada ${ROLE_BM[s.value]}?`)) { s.value = p.role; return; }
    try { await rpc('change_role', { p_profile_id: p.id, p_new_role: s.value }); toast('Peranan ditukar.'); route(); }
    catch (e) { s.value = p.role; toast((await import('../errors.js')).bm(e), 'error'); }
  });

  document.querySelectorAll('[data-active]').forEach(b => b.onclick = async () => {
    const on = b.dataset.to === 'true';
    if (!confirm(on ? 'Aktifkan semula akaun ini?' : 'Nyahaktif akaun ini? Pekerja tidak boleh log masuk ke data lagi.')) return;
    try { await rpc('set_account_active', { p_profile_id: b.dataset.active, p_active: on }); toast('Akaun dikemas kini.'); route(); }
    catch (e) { toast((await import('../errors.js')).bm(e), 'error'); }
  });

  $('#add').onclick = () => $('#dAdd').showModal();
  onSubmit($('#fAdd'), async d => {
    await rpc('create_employee', {
      p_full_name: d.full_name.trim(), p_outlet_id: d.outlet_id || null, p_position: d.position.trim() || null,
      p_email: d.email.trim().toLowerCase() || null, p_phone: d.phone.trim() || null,
    });
    $('#dAdd').close(); toast('Pekerja ditambah.'); route();
  });
}

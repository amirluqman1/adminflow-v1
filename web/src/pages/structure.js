// Group → Syarikat → Outlet. Syarikat: Owner only. Outlets: Owner and Admin.
import { select, rpc } from '../neon.js';
import { $, esc, render, onSubmit, toast } from '../ui.js';
import { state, route } from '../main.js';

export async function structure() {
  const [ents, outlets] = await Promise.all([
    select('legal_entities', 'id,name,registration_no,is_active', q => q.order('name')),
    select('outlets', 'id,name,code,address,is_active,legal_entity_id', q => q.order('name')),
  ]);
  const isOwner = state.profile.role === 'owner';
  const outletRow = o => `<li><span>${esc(o.name)}${o.code ? ` <small>${esc(o.code)}</small>` : ''}${o.is_active ? '' : ' <span class="badge off">Tutup</span>'}</span>
    <button type="button" class="ghost" data-outlet="${o.id}">Ubah</button></li>`;
  const entCard = e => `<section class="card">
    <div class="row nowrap"><div><h2>${esc(e.name)}${e.is_active ? '' : ' <span class="badge off">Tidak aktif</span>'}</h2>
      <small class="muted">SSM: ${esc(e.registration_no || 'belum diisi')}</small></div>
      ${isOwner ? `<button type="button" class="ghost" data-ent="${e.id}">Ubah</button>` : ''}</div>
    <ul class="list">${outlets.filter(o => o.legal_entity_id === e.id).map(outletRow).join('') || '<li class="muted">Tiada outlet.</li>'}</ul>
  </section>`;
  const loose = outlets.filter(o => !o.legal_entity_id);

  render(`
    <section class="card"><div class="row"><h1>Syarikat & Outlet</h1>
      <span>${isOwner ? '<button type="button" id="addEnt" class="ghost">+ Syarikat</button>' : ''}<button type="button" id="addOutlet">+ Outlet</button></span></div>
      <p class="muted">Satu Group → beberapa Syarikat (Sdn Bhd / Enterprise) → outlet. ${isOwner ? '' : 'Hanya Owner boleh daftar atau ubah Syarikat.'}</p></section>
    ${ents.map(entCard).join('')}
    ${loose.length ? `<section class="card"><h2>Outlet tanpa Syarikat</h2><ul class="list">${loose.map(outletRow).join('')}</ul></section>` : ''}

    <dialog id="dEnt"><form id="fEnt" method="dialog">
      <h2 id="entTitle">Syarikat</h2><input type="hidden" name="id">
      <label>Nama berdaftar<input name="name" required minlength="2" maxlength="160" placeholder="cth: Syarikat ABC Sdn Bhd"></label>
      <label>No. SSM <small>(pilihan)</small><input name="registration_no" maxlength="60" placeholder="cth: 202301012345 (1234567-X)"></label>
      <label class="check"><input type="checkbox" name="is_active" checked> Aktif</label>
      <p class="error"></p>
      <div class="row"><button type="button" class="ghost" data-close>Batal</button><button type="submit">Simpan</button></div>
    </form></dialog>

    <dialog id="dOut"><form id="fOut" method="dialog">
      <h2 id="outTitle">Outlet</h2><input type="hidden" name="id">
      <label>Nama outlet<input name="name" required minlength="2" maxlength="120"></label>
      <label>Syarikat<select name="legal_entity_id"><option value="">— Belum ditetapkan —</option>${ents.filter(e => e.is_active).map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select></label>
      <label>Kod <small>(pilihan, huruf besar/nombor)</small><input name="code" maxlength="20" pattern="[A-Za-z0-9_-]{1,20}"></label>
      <label>Alamat<textarea name="address" maxlength="500" rows="2"></textarea></label>
      <label class="check"><input type="checkbox" name="is_active" checked> Beroperasi</label>
      <p class="error"></p>
      <div class="row"><button type="button" class="ghost" data-close>Batal</button><button type="submit">Simpan</button></div>
    </form></dialog>`);

  document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.closest('dialog').close());

  const openEnt = e => {
    const f = $('#fEnt');
    f.id.value = e?.id || ''; f.name.value = e?.name || ''; f.registration_no.value = e?.registration_no || '';
    f.is_active.checked = e ? e.is_active : true; f.is_active.parentElement.hidden = !e;
    $('#entTitle').textContent = e ? 'Ubah Syarikat' : 'Daftar Syarikat';
    $('#dEnt').showModal();
  };
  $('#addEnt')?.addEventListener('click', () => openEnt());
  document.querySelectorAll('[data-ent]').forEach(b => b.onclick = () => openEnt(ents.find(e => e.id === b.dataset.ent)));
  onSubmit($('#fEnt'), async d => {
    if (d.id) await rpc('update_legal_entity', { p_legal_entity_id: d.id, p_name: d.name.trim(), p_registration_no: d.registration_no.trim(), p_is_active: !!d.is_active });
    else await rpc('create_legal_entity', { p_name: d.name.trim(), p_registration_no: d.registration_no.trim() || null });
    $('#dEnt').close(); toast('Syarikat disimpan.'); route();
  });

  const openOut = o => {
    const f = $('#fOut');
    f.id.value = o?.id || ''; f.name.value = o?.name || ''; f.legal_entity_id.value = o?.legal_entity_id || '';
    f.code.value = o?.code || ''; f.address.value = o?.address || '';
    f.is_active.checked = o ? o.is_active : true; f.is_active.parentElement.hidden = !o;
    $('#outTitle').textContent = o ? 'Ubah outlet' : 'Tambah outlet';
    $('#dOut').showModal();
  };
  $('#addOutlet').onclick = () => openOut();
  document.querySelectorAll('[data-outlet]').forEach(b => b.onclick = () => openOut(outlets.find(o => o.id === b.dataset.outlet)));
  onSubmit($('#fOut'), async d => {
    const args = { p_name: d.name.trim(), p_legal_entity_id: d.legal_entity_id || null, p_code: d.code.trim() || null, p_address: d.address.trim() || null };
    if (d.id) await rpc('update_outlet', { p_outlet_id: d.id, ...args, p_is_active: !!d.is_active });
    else await rpc('create_outlet', args);
    $('#dOut').close(); toast('Outlet disimpan.'); route();
  });
}

// Tambah / edit pekerja → rpc create_employee / update_employee.
import { client, call, messageFor } from '../api.js';
import { esc, options, alertBox, EMP_TYPE, toast } from '../ui.js';
import { loadEmployee } from '../store.js';
import { canManage, canEditEmployee, isOwner } from '../perm.js';

export async function renderStaffForm(ctx, el, id) {
  const seq = ctx.seq;
  const emp = id ? await loadEmployee(ctx, id) : null;
  if (ctx.stale(seq)) return;
  if (id && !emp) { el.innerHTML = '<h1>Pekerja tidak dijumpai</h1><a href="#/staf">← Kembali ke direktori</a>'; return; }
  if (emp ? !canEditEmployee(ctx, emp) : !canManage(ctx)) {
    el.innerHTML = `<h1>Tiada kebenaran</h1>${alertBox('error', 'Anda tidak boleh mengubah rekod ini.')}<a href="#/staf">← Kembali</a>`;
    return;
  }
  const v = emp || { employment_type: 'full_time', legal_entity_id: defaultEntity(ctx), outlet_id: '' };
  const activeEntities = ctx.entities.filter((x) => x.is_active || x.id === v.legal_entity_id);
  const entityOpts = activeEntities.map((x) => [x.id, x.name]);
  const showEntity = ctx.me.role !== 'manager';
  const back = emp ? `#/staf/${emp.id}` : '#/staf';

  el.innerHTML = `
    <a class="back" href="${back}">← ${emp ? 'Kembali ke profil' : 'Kembali ke direktori'}</a>
    <h1>${emp ? `Edit ${esc(emp.full_name)}` : 'Tambah pekerja'}</h1>
    ${emp ? '' : '<p class="muted">Pekerja boleh ditambah tanpa emel/login. Jemputan login boleh dibuat kemudian dari profil.</p>'}
    <form id="f" class="form-card" novalidate>
      <fieldset><legend>Maklumat peribadi</legend>
        <label>Nama penuh *<input name="full_name" required maxlength="120" autocomplete="off" value="${esc(v.full_name)}"></label>
        <div class="two">
          <label>Telefon<input name="phone" type="tel" inputmode="tel" placeholder="012-345 6789" value="${esc(v.phone)}"></label>
          <label>Emel <span class="hint">Perlu untuk login</span><input name="email" type="email" inputmode="email" autocomplete="off" value="${esc(v.email)}"></label>
        </div>
        ${emp?.profile ? '<p class="muted small">Akaun login dipautkan kepada emel semasa jemputan diterima. Menukar emel di sini tidak menukar emel log masuk.</p>' : ''}
      </fieldset>
      <fieldset><legend>Pekerjaan</legend>
        <div class="two">
          <label>No. pekerja<input name="employee_no" maxlength="30" value="${esc(v.employee_no)}"></label>
          <label>Jawatan<input name="position" maxlength="80" list="positions" value="${esc(v.position)}"></label>
        </div>
        <div class="two">
          <label>Jenis pekerjaan<select name="employment_type">${options(Object.entries(EMP_TYPE), v.employment_type)}</select></label>
          <label>Tarikh mula<input name="join_date" type="date" value="${esc(v.join_date || '')}"></label>
        </div>
      </fieldset>
      <fieldset><legend>Penempatan</legend>
        <div class="two">
          ${showEntity ? `<label>Syarikat${isOwner(ctx) ? '' : ' *'}<select name="legal_entity_id">${options(entityOpts, v.legal_entity_id, isOwner(ctx) ? { empty: 'Peringkat Group (tiada Syarikat)' } : {})}</select></label>` : ''}
          <label>Outlet<select name="outlet_id"></select></label>
        </div>
      </fieldset>
      <datalist id="positions"></datalist>
      <div class="form-error"></div>
      <div class="form-actions">
        <a class="btn secondary" href="${back}">Batal</a>
        <button class="primary" type="submit">${emp ? 'Simpan perubahan' : 'Tambah pekerja'}</button>
      </div>
    </form>`;

  const form = el.querySelector('#f');
  const outletSel = form.elements.outlet_id;
  const fillOutlets = () => {
    const ent = showEntity ? form.elements.legal_entity_id.value : null;
    const list = ctx.outlets.filter((o) => (o.is_active || o.id === v.outlet_id) && (!showEntity || !ent || o.legal_entity_id === ent)
      && (ctx.me.role !== 'manager' || ctx.myOutletIds.has(o.id)));
    const keep = list.some((o) => o.id === outletSel.value) ? outletSel.value : (list.some((o) => o.id === v.outlet_id) ? v.outlet_id : '');
    outletSel.innerHTML = options(list.map((o) => [o.id, o.name]), keep, ctx.me.role === 'manager' ? {} : { empty: 'HQ / tiada outlet' });
  };
  if (showEntity) form.elements.legal_entity_id.addEventListener('change', fillOutlets);
  fillOutlets();

  // position suggestions from existing staff
  call(() => client.from('employees').select('position')).then(({ data }) => {
    const list = el.querySelector('#positions');
    if (!list || ctx.stale(seq)) return;
    const set = [...new Set((data || []).map((x) => x.position).filter(Boolean))].sort();
    list.innerHTML = set.map((p) => `<option value="${esc(p)}">`).join('');
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const box = form.querySelector('.form-error');
    const err = validate(f);
    if (err) { box.innerHTML = alertBox('error', err); return; }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; box.innerHTML = '';
    const outletId = f.outlet_id || null;
    // Syarikat follows the outlet when one is chosen; managers never send a Syarikat.
    const entityId = outletId ? ctx.outletById.get(outletId)?.legal_entity_id : (showEntity ? f.legal_entity_id || null : null);
    const args = {
      p_full_name: f.full_name.trim(),
      p_outlet_id: outletId,
      p_position: f.position.trim() || null,
      p_employment_type: f.employment_type,
      p_join_date: f.join_date || null,
      p_phone: f.phone.trim() || null,
      p_email: f.email.trim() || null,
      p_employee_no: f.employee_no.trim() || null,
      p_legal_entity_id: entityId,
    };
    const res = emp
      ? await call(() => client.rpc('update_employee', { p_employee_id: emp.id, ...args }))
      : await call(() => client.rpc('create_employee', args));
    btn.disabled = false;
    if (res.error) { box.innerHTML = alertBox('error', messageFor(res.error)); return; }
    toast(emp ? 'Perubahan disimpan.' : 'Pekerja ditambah.');
    ctx.go(`#/staf/${emp ? emp.id : res.data}`);
  });
}

function defaultEntity(ctx) {
  if (ctx.me.role === 'admin' && ctx.myEntityIds.size === 1) return [...ctx.myEntityIds][0];
  return ctx.entities.length === 1 ? ctx.entities[0].id : '';
}

function validate(f) {
  if (f.full_name.trim().length < 2) return 'Nama penuh sekurang-kurangnya 2 aksara.';
  if (f.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) return 'Format emel tidak sah.';
  if (f.phone.trim() && !/^\+?[0-9 -]{7,20}$/.test(f.phone.trim())) return 'Format telefon tidak sah (cth 012-345 6789).';
  return '';
}

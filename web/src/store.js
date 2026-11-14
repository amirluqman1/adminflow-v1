// Data loading for the signed-in app. All reads go through RLS, so every list is already
// limited to what this user may see; the UI never widens it.
import { client, call } from './api.js';

const unwrap = (r) => { if (r.error) throw r.error; return r.data || []; };

// ---------------------------------------------------------------- context (who am I + structure)
export async function loadContext(user) {
  const prof = unwrap(await call(() => client.from('profiles')
    .select('id, role, employee_id, is_active').eq('auth_user_id', user.id).limit(1)))[0];
  if (!prof) throw Object.assign(new Error('not linked'), { message: 'not_authorized' });

  const [emp, entities, outlets, myOutlets, myEntities] = await Promise.all([
    call(() => client.from('employees').select('*').eq('id', prof.employee_id).limit(1)),
    call(() => client.from('legal_entities').select('id, name, registration_no, is_active').order('name')),
    call(() => client.from('outlets').select('id, name, code, address, is_active, legal_entity_id').order('name')),
    prof.role === 'manager'
      ? call(() => client.from('manager_outlets').select('outlet_id').eq('profile_id', prof.id))
      : Promise.resolve({ data: [] }),
    prof.role === 'admin'
      ? call(() => client.from('admin_entities').select('legal_entity_id').eq('profile_id', prof.id))
      : Promise.resolve({ data: [] }),
  ]);

  const ctx = {
    user,
    me: { ...prof, employee: unwrap(emp)[0] || null },
    entities: unwrap(entities),
    outlets: unwrap(outlets),
    myOutletIds: new Set(unwrap(myOutlets).map((x) => x.outlet_id)),
    myEntityIds: new Set(unwrap(myEntities).map((x) => x.legal_entity_id)),
  };
  ctx.entityById = new Map(ctx.entities.map((e) => [e.id, e]));
  ctx.outletById = new Map(ctx.outlets.map((o) => [o.id, o]));
  return ctx;
}

export async function refreshStructure(ctx) {
  const [entities, outlets] = await Promise.all([
    call(() => client.from('legal_entities').select('id, name, registration_no, is_active').order('name')),
    call(() => client.from('outlets').select('id, name, code, address, is_active, legal_entity_id').order('name')),
  ]);
  ctx.entities = unwrap(entities);
  ctx.outlets = unwrap(outlets);
  ctx.entityById = new Map(ctx.entities.map((e) => [e.id, e]));
  ctx.outletById = new Map(ctx.outlets.map((o) => [o.id, o]));
}

// ---------------------------------------------------------------- staff (employees + accounts)
// Returns employees enriched with: profile, pendingInvite, managerOutletIds, adminEntityIds, effRole.
export async function loadStaff(ctx, { onlyId } = {}) {
  const manage = ['owner', 'admin'].includes(ctx.me.role);
  let empQ = client.from('employees').select('*').order('full_name');
  if (onlyId) empQ = empQ.eq('id', onlyId);
  const [emps, profs, invs, mos, aes] = await Promise.all([
    call(() => empQ),
    call(() => client.from('profiles').select('id, employee_id, role, is_active, activated_at, deactivated_at')),
    manage
      ? call(() => client.from('account_invitations').select('id, employee_id, role, email, expires_at, created_at').eq('status', 'pending'))
      : Promise.resolve({ data: [] }),
    manage ? call(() => client.from('manager_outlets').select('profile_id, outlet_id')) : Promise.resolve({ data: [] }),
    ctx.me.role === 'owner' ? call(() => client.from('admin_entities').select('profile_id, legal_entity_id')) : Promise.resolve({ data: [] }),
  ]);
  const profByEmp = new Map(unwrap(profs).map((p) => [p.employee_id, p]));
  const now = Date.now();
  const invByEmp = new Map(unwrap(invs).filter((i) => new Date(i.expires_at).getTime() > now).map((i) => [i.employee_id, i]));
  const group = (rows, key, val) => rows.reduce((m, r) => m.set(r[key], [...(m.get(r[key]) || []), r[val]]), new Map());
  const moByProf = group(unwrap(mos), 'profile_id', 'outlet_id');
  const aeByProf = group(unwrap(aes), 'profile_id', 'legal_entity_id');

  return unwrap(emps).map((e) => {
    const profile = profByEmp.get(e.id) || null;
    return {
      ...e,
      profile,
      pendingInvite: invByEmp.get(e.id) || null,
      managerOutletIds: profile ? moByProf.get(profile.id) || [] : [],
      adminEntityIds: profile ? aeByProf.get(profile.id) || [] : [],
      effRole: profile ? profile.role : 'staff',
    };
  });
}

export async function loadEmployee(ctx, id) {
  return (await loadStaff(ctx, { onlyId: id }))[0] || null;
}

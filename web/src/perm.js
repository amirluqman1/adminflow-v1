// UI-side mirror of the database rules (AGENTS.md "Business rules"). These only decide which
// buttons to show; the database functions enforce the real rules and refuse anything else.
const isManager = (ctx) => ['owner', 'admin'].includes(ctx.me.role);

export const canManage = isManager; // Owner/Admin: create staff, invite, accounts, settings
export const isOwner = (ctx) => ctx.me.role === 'owner';
export const isSelf = (ctx, emp) => emp.id === ctx.me.employee_id;

const inMyEntity = (ctx, emp) => emp.legal_entity_id && ctx.myEntityIds.has(emp.legal_entity_id);

export function canSeeDirectory(ctx) {
  return ctx.me.role !== 'staff';
}

export function canEditEmployee(ctx, emp) {
  const r = ctx.me.role;
  if (r === 'owner') return true;
  if (r === 'admin') return isSelf(ctx, emp) || (inMyEntity(ctx, emp) && emp.effRole !== 'owner');
  if (r === 'manager') return !isSelf(ctx, emp) && emp.effRole === 'staff' && ctx.myOutletIds.has(emp.outlet_id);
  return false;
}

// Admin: only Staff/Admin Outlet of own Syarikat. Never self.
function adminCanTouch(ctx, emp) {
  return inMyEntity(ctx, emp) && !['owner', 'admin'].includes(emp.effRole);
}

export function canSetStatus(ctx, emp) {
  if (isSelf(ctx, emp)) return false;
  if (ctx.me.role === 'owner') return true;
  return ctx.me.role === 'admin' && adminCanTouch(ctx, emp);
}

export const canSetAccount = canSetStatus;

// Roles the current user may give in an invitation.
export function inviteRoles(ctx) {
  return ctx.me.role === 'owner' ? ['staff', 'manager', 'admin', 'owner'] : ['staff', 'manager'];
}

export function canInvite(ctx, emp) {
  if (!isManager(ctx) || emp.profile || emp.status !== 'active') return false;
  return ctx.me.role === 'owner' || inMyEntity(ctx, emp);
}

// Roles a profile may be changed to by the current user ("Option C").
export function roleChoices(ctx, emp) {
  if (!emp.profile || isSelf(ctx, emp)) return [];
  if (ctx.me.role === 'owner') return ['staff', 'manager', 'admin', 'owner'].filter((r) => r !== emp.profile.role);
  if (ctx.me.role === 'admin' && adminCanTouch(ctx, emp)) return ['staff', 'manager'].filter((r) => r !== emp.profile.role);
  return [];
}

export function canAssignOutlets(ctx, emp) {
  return emp.profile?.role === 'manager' && isManager(ctx) && (ctx.me.role === 'owner' || adminCanTouch(ctx, emp));
}

export function canAssignEntities(ctx, emp) {
  return emp.profile?.role === 'admin' && ctx.me.role === 'owner';
}

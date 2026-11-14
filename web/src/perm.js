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

// ---------------------------------------------------------------- leave (mirror of review_leave / submit_leave)
// emp = enriched employee (loadStaff) of the applicant
export function canReviewLeave(ctx, emp) {
  const r = ctx.me.role;
  if (isSelf(ctx, emp)) return false; // own leave: only Admin self-approve (separate button)
  switch (emp.effRole) {
    case 'staff': return r === 'owner' || (r === 'admin' && inMyEntity(ctx, emp)) || (r === 'manager' && ctx.myOutletIds.has(emp.outlet_id));
    case 'manager': return r === 'owner' || (r === 'admin' && inMyEntity(ctx, emp));
    default: return r === 'owner'; // admin / owner applicants
  }
}
export const canSelfApprove = (ctx) => ctx.me.role === 'admin';

const hasLogin = (emp) => Boolean(emp.profile?.is_active);

// record / cancel leave on behalf: only for employees without an active login
export function canActOnBehalf(ctx, emp) {
  if (isSelf(ctx, emp) || hasLogin(emp) || emp.status !== 'active') return false;
  const r = ctx.me.role;
  return r === 'owner' || (r === 'admin' && inMyEntity(ctx, emp) && emp.effRole !== 'owner') || (r === 'manager' && ctx.myOutletIds.has(emp.outlet_id));
}

// ---------------------------------------------------------------- tasks (mirror of can_manage_task / check_task_assignment)
export const canCreateTask = (ctx) => ctx.me.role !== 'staff';

export function canAssignTo(ctx, emp) {
  if (emp.status !== 'active') return false;
  const r = ctx.me.role;
  if (r === 'owner' || isSelf(ctx, emp)) return r !== 'staff';
  if (r === 'admin') return inMyEntity(ctx, emp) && emp.effRole !== 'owner';
  if (r === 'manager') return ctx.myOutletIds.has(emp.outlet_id);
  return false;
}

// t = row of task_overview; assignee = enriched employee (may be undefined if outside scope)
export function canManageTask(ctx, t, assignee) {
  const r = ctx.me.role;
  if (r === 'owner') return true;
  if (t.created_by_profile_id === ctx.me.id && (r === 'admin' || r === 'manager')) return true;
  if (r === 'admin') {
    const outletEnt = t.outlet_id ? ctx.outletById.get(t.outlet_id)?.legal_entity_id : null;
    return Boolean((assignee && inMyEntity(ctx, assignee) && assignee.effRole !== 'owner') || (outletEnt && ctx.myEntityIds.has(outletEnt)));
  }
  if (r === 'manager') return ctx.myOutletIds.has(t.outlet_id) || Boolean(assignee && ctx.myOutletIds.has(assignee.outlet_id));
  return false;
}

export function canWorkTask(ctx, t, assignee) {
  if (t.assigned_employee_id === ctx.me.employee_id) return true;
  return canManageTask(ctx, t, assignee) && assignee && !hasLogin(assignee);
}

export const canSeeActivity = (ctx) => ['owner', 'admin'].includes(ctx.me.role);

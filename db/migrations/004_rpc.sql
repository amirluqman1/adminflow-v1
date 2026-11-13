-- AdminFlow V1 — 004: write API (RPC functions)
-- The ONLY way the app changes data. Each function:
--   1. identifies the caller from the verified JWT (app.require_me),
--   2. checks role / outlet / business rules,
--   3. writes, and labels the audit entry.
-- Errors: SQLSTATE 42501 => forbidden (HTTP 403), P0001 => business rule (HTTP 400).
--         `message` is a stable machine code the UI translates; `detail` is human-readable.

begin;

-- ================================================================= internal helpers
create type app.me_t as (profile_id uuid, company_id uuid, role public.app_role, employee_id uuid);

create or replace function app.require_me() returns app.me_t
language plpgsql stable security definer set search_path = '' as $$
declare me app.me_t;
begin
  select p.id, p.company_id, p.role, p.employee_id into me
  from public.profiles p
  join public.employees e on e.id = p.employee_id
  where p.auth_user_id = auth.uid() and p.is_active and e.status = 'active';
  if me.profile_id is null then
    raise exception using errcode = '42501', message = 'not_authorized',
      detail = 'No active AdminFlow account is linked to this login.';
  end if;
  return me;
end $$;

create or replace function app.forbid(p_detail text) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '42501', message = 'forbidden', detail = p_detail;
end $$;

create or replace function app.fail(p_code text, p_detail text) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = 'P0001', message = p_code, detail = p_detail;
end $$;

create or replace function app.label(p_action text, p_note text default null) returns void
language plpgsql set search_path = '' as $$
begin
  perform set_config('app.audit_action', coalesce(p_action, ''), true);
  perform set_config('app.audit_note',   coalesce(p_note, ''),   true);
end $$;

create or replace function app.other_active_owners(p_company_id uuid, p_exclude_profile uuid) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.profiles p
  join public.employees e on e.id = p.employee_id
  where p.company_id = p_company_id and p.role = 'owner' and p.is_active
    and e.status = 'active' and p.id <> p_exclude_profile
$$;

-- ================================================================= outlets
create or replace function public.create_outlet(p_name text, p_code text default null, p_address text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me app.me_t; v_id uuid;
begin
  me := app.require_me();
  if me.role not in ('owner', 'admin') then perform app.forbid('Only Owner/Admin can create outlets.'); end if;
  perform app.label('outlet.create');
  insert into public.outlets (company_id, name, code, address)
  values (me.company_id, trim(p_name), upper(nullif(trim(p_code), '')), nullif(trim(p_address), ''))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.update_outlet(
  p_outlet_id uuid, p_name text, p_code text, p_address text, p_is_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare me app.me_t;
begin
  me := app.require_me();
  if me.role not in ('owner', 'admin') then perform app.forbid('Only Owner/Admin can edit outlets.'); end if;
  perform app.label('outlet.update');
  update public.outlets
     set name = trim(p_name), code = upper(nullif(trim(p_code), '')),
         address = nullif(trim(p_address), ''), is_active = p_is_active
   where id = p_outlet_id and company_id = me.company_id;
  if not found then perform app.fail('not_found', 'Outlet not found.'); end if;
end $$;

-- ================================================================= employees
create or replace function public.create_employee(
  p_full_name text,
  p_outlet_id uuid default null,
  p_position text default null,
  p_employment_type public.employment_type default 'full_time',
  p_join_date date default null,
  p_phone text default null,
  p_email text default null,
  p_employee_no text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me app.me_t; v_id uuid;
begin
  me := app.require_me();
  if me.role not in ('owner', 'admin') then perform app.forbid('Only Owner/Admin can register employees.'); end if;
  perform app.label('employee.create');
  insert into public.employees
    (company_id, outlet_id, full_name, position, employment_type, join_date, phone, email, employee_no)
  values
    (me.company_id, p_outlet_id, trim(p_full_name), nullif(trim(p_position), ''), p_employment_type,
     p_join_date, nullif(trim(p_phone), ''), lower(nullif(trim(p_email), '')), nullif(trim(p_employee_no), ''))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.update_employee(
  p_employee_id uuid,
  p_full_name text,
  p_outlet_id uuid,
  p_position text,
  p_employment_type public.employment_type,
  p_join_date date,
  p_phone text,
  p_email text,
  p_employee_no text)
returns void language plpgsql security definer set search_path = '' as $$
declare me app.me_t; e public.employees; v_target_role public.app_role;
begin
  me := app.require_me();
  select * into e from public.employees where id = p_employee_id and company_id = me.company_id for update;
  if e.id is null then perform app.fail('not_found', 'Employee not found.'); end if;
  v_target_role := app.employee_effective_role(e.id);

  if me.role = 'owner' then
    null;
  elsif me.role = 'admin' then
    if v_target_role = 'owner' then perform app.forbid('Admin cannot edit an Owner record.'); end if;
  elsif me.role = 'manager' then
    if e.id = me.employee_id or v_target_role <> 'staff' or not app.is_my_outlet(e.outlet_id) then
      perform app.forbid('Managers can only edit staff in their own outlets.');
    end if;
    if not app.is_my_outlet(p_outlet_id) then
      perform app.forbid('Managers can only move staff between their own outlets.');
    end if;
  else
    perform app.forbid('Staff cannot edit employee records.');
  end if;

  perform app.label('employee.update');
  update public.employees
     set full_name = trim(p_full_name), outlet_id = p_outlet_id, position = nullif(trim(p_position), ''),
         employment_type = p_employment_type, join_date = p_join_date, phone = nullif(trim(p_phone), ''),
         email = lower(nullif(trim(p_email), '')), employee_no = nullif(trim(p_employee_no), '')
   where id = e.id;
end $$;

create or replace function public.set_employee_status(p_employee_id uuid, p_active boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare me app.me_t; e public.employees; pr public.profiles; v_target_role public.app_role;
begin
  me := app.require_me();
  if me.role not in ('owner', 'admin') then perform app.forbid('Only Owner/Admin can activate or deactivate employees.'); end if;
  select * into e from public.employees where id = p_employee_id and company_id = me.company_id for update;
  if e.id is null then perform app.fail('not_found', 'Employee not found.'); end if;
  if e.id = me.employee_id then perform app.forbid('You cannot change your own employment status.'); end if;
  v_target_role := app.employee_effective_role(e.id);
  if me.role = 'admin' and v_target_role in ('owner', 'admin') then
    perform app.forbid('Only the Owner can change the status of an Owner/Admin.');
  end if;
  select * into pr from public.profiles where employee_id = e.id for update;

  if p_active then
    if e.status = 'active' then return; end if;
    perform app.label('employee.reactivate', p_note);
    update public.employees set status = 'active', deactivated_at = null where id = e.id;
    -- login is NOT re-enabled automatically; use set_account_active
  else
    if e.status = 'inactive' then return; end if;
    if pr.id is not null and pr.role = 'owner' and pr.is_active
       and app.other_active_owners(me.company_id, pr.id) = 0 then
      perform app.fail('last_owner', 'The company must always have at least one active Owner.');
    end if;
    perform app.label('employee.deactivate', p_note);
    update public.employees set status = 'inactive', deactivated_at = now() where id = e.id;
    if pr.id is not null and pr.is_active then
      perform app.label('account.deactivate', 'Employee deactivated');
      update public.profiles set is_active = false, deactivated_at = now() where id = pr.id;
    end if;
    perform app.label('invitation.revoke', 'Employee deactivated');
    update public.account_invitations set status = 'revoked', revoked_at = now()
     where employee_id = e.id and status = 'pending';
  end if;
end $$;

-- ================================================================= accounts & roles
create or replace function public.change_role(p_profile_id uuid, p_new_role public.app_role, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare me app.me_t; pr public.profiles;
begin
  me := app.require_me();
  select * into pr from public.profiles where id = p_profile_id and company_id = me.company_id for update;
  if pr.id is null then perform app.fail('not_found', 'Account not found.'); end if;
  if pr.id = me.profile_id then perform app.forbid('You cannot change your own role.'); end if;
  if not pr.is_active then perform app.fail('account_inactive', 'Reactivate the account before changing its role.'); end if;
  if pr.role = p_new_role then return; end if;

  -- Option C: staff <-> manager by Owner/Admin; anything touching owner/admin by Owner only.
  if pr.role in ('owner', 'admin') or p_new_role in ('owner', 'admin') then
    if me.role <> 'owner' then perform app.forbid('Only the Owner can grant or remove Owner/Admin roles.'); end if;
  elsif me.role not in ('owner', 'admin') then
    perform app.forbid('Only Owner/Admin can change roles.');
  end if;

  if pr.role = 'owner' and app.other_active_owners(me.company_id, pr.id) = 0 then
    perform app.fail('last_owner', 'The company must always have at least one active Owner.');
  end if;

  if pr.role = 'manager' then
    perform app.label('manager_outlet.remove', 'Role changed from manager');
    delete from public.manager_outlets where profile_id = pr.id;
  end if;

  perform app.label('account.role_change', p_note);
  update public.profiles set role = p_new_role where id = pr.id;
end $$;

create or replace function public.set_account_active(p_profile_id uuid, p_active boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare me app.me_t; pr public.profiles; v_emp_status public.employee_status;
begin
  me := app.require_me();
  if me.role not in ('owner', 'admin') then perform app.forbid('Only Owner/Admin can manage accounts.'); end if;
  select * into pr from public.profiles where id = p_profile_id and company_id = me.company_id for update;
  if pr.id is null then perform app.fail('not_found', 'Account not found.'); end if;
  if pr.id = me.profile_id then perform app.forbid('You cannot change your own account status.'); end if;
  if me.role = 'admin' and pr.role in ('owner', 'admin') then
    perform app.forbid('Only the Owner can manage Owner/Admin accounts.');
  end if;
  if pr.is_active = p_active then return; end if;

  if p_active then
    select status into v_emp_status from public.employees where id = pr.employee_id;
    if v_emp_status <> 'active' then
      perform app.fail('employee_inactive', 'Reactivate the employee record first.');
    end if;
    perform app.label('account.activate', p_note);
    update public.profiles set is_active = true, deactivated_at = null where id = pr.id;
  else
    if pr.role = 'owner' and app.other_active_owners(me.company_id, pr.id) = 0 then
      perform app.fail('last_owner', 'The company must always have at least one active Owner.');
    end if;
    perform app.label('account.deactivate', p_note);
    update public.profiles set is_active = false, deactivated_at = now() where id = pr.id;
  end if;
end $$;

create or replace function public.assign_manager_outlet(p_profile_id uuid, p_outlet_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me app.me_t; pr public.profiles;
begin
  me := app.require_me();
  if me.role not in ('owner', 'admin') then perform app.forbid('Only Owner/Admin can assign outlets to managers.'); end if;
  select * into pr from public.profiles where id = p_profile_id and company_id = me.company_id;
  if pr.id is null or pr.role <> 'manager' or not pr.is_active then
    perform app.fail('not_a_manager', 'Outlets can only be assigned to an active Manager account.');
  end if;
  if not exists (select 1 from public.outlets where id = p_outlet_id and company_id = me.company_id and is_active) then
    perform app.fail('not_found', 'Active outlet not found.');
  end if;
  perform app.label('manager_outlet.assign');
  insert into public.manager_outlets (company_id, profile_id, outlet_id, assigned_by_profile_id)
  values (me.company_id, pr.id, p_outlet_id, me.profile_id)
  on conflict (profile_id, outlet_id) do nothing;
end $$;

create or replace function public.remove_manager_outlet(p_profile_id uuid, p_outlet_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me app.me_t;
begin
  me := app.require_me();
  if me.role not in ('owner', 'admin') then perform app.forbid('Only Owner/Admin can remove manager outlets.'); end if;
  perform app.label('manager_outlet.remove');
  delete from public.manager_outlets
   where profile_id = p_profile_id and outlet_id = p_outlet_id and company_id = me.company_id;
end $$;

-- ================================================================= invitations
create or replace function public.create_invitation(p_employee_id uuid, p_role public.app_role, p_email text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me app.me_t; e public.employees; v_token text; v_id uuid; v_email text; v_exp timestamptz;
begin
  me := app.require_me();
  if me.role not in ('owner', 'admin') then perform app.forbid('Only Owner/Admin can invite employees.'); end if;
  if p_role in ('owner', 'admin') and me.role <> 'owner' then
    perform app.forbid('Only the Owner can invite an Owner/Admin.');
  end if;
  select * into e from public.employees where id = p_employee_id and company_id = me.company_id for update;
  if e.id is null then perform app.fail('not_found', 'Employee not found.'); end if;
  if e.status <> 'active' then perform app.fail('employee_inactive', 'Employee is inactive.'); end if;
  if exists (select 1 from public.profiles where employee_id = e.id) then
    perform app.fail('already_has_account', 'This employee already has an account. Reactivate it instead.');
  end if;
  v_email := lower(nullif(trim(coalesce(p_email, e.email)), ''));
  if v_email is null then perform app.fail('email_required', 'An email address is required to invite.'); end if;

  perform app.label('invitation.revoke', 'Replaced by a new invitation');
  update public.account_invitations set status = 'revoked', revoked_at = now()
   where employee_id = e.id and status = 'pending';

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_exp   := now() + interval '7 days';
  perform app.label('invitation.create');
  insert into public.account_invitations (company_id, employee_id, email, role, token_hash, expires_at, invited_by_profile_id)
  values (me.company_id, e.id, v_email, p_role, extensions.digest(v_token, 'sha256'), v_exp, me.profile_id)
  returning id into v_id;

  -- the plaintext token is returned ONCE and never stored
  return jsonb_build_object('invitation_id', v_id, 'token', v_token, 'email', v_email, 'expires_at', v_exp);
end $$;

create or replace function public.revoke_invitation(p_invitation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me app.me_t; inv public.account_invitations;
begin
  me := app.require_me();
  if me.role not in ('owner', 'admin') then perform app.forbid('Only Owner/Admin can revoke invitations.'); end if;
  select * into inv from public.account_invitations
   where id = p_invitation_id and company_id = me.company_id for update;
  if inv.id is null or inv.status <> 'pending' then perform app.fail('not_found', 'Pending invitation not found.'); end if;
  if inv.role in ('owner', 'admin') and me.role <> 'owner' then
    perform app.forbid('Only the Owner can revoke an Owner/Admin invitation.');
  end if;
  perform app.label('invitation.revoke');
  update public.account_invitations set status = 'revoked', revoked_at = now() where id = inv.id;
end $$;

-- Called by a freshly signed-up user who has no profile yet.
create or replace function public.accept_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); inv public.account_invitations; u record; v_profile uuid;
begin
  if v_uid is null then perform app.forbid('Sign in first.'); end if;
  if exists (select 1 from public.profiles where auth_user_id = v_uid) then
    perform app.fail('already_linked', 'This login is already linked to an employee.');
  end if;
  select * into inv from public.account_invitations
   where token_hash = extensions.digest(coalesce(p_token, ''), 'sha256') for update;
  if inv.id is null or inv.status <> 'pending' or inv.expires_at < now() then
    perform app.fail('invalid_invitation', 'Invitation is invalid, used, revoked or expired.');
  end if;
  select u2.email, u2."emailVerified" as verified into u from neon_auth."user" u2 where u2.id = v_uid;
  if u.email is null or lower(u.email) <> inv.email then
    perform app.forbid('This invitation was sent to a different email address.');
  end if;
  if not coalesce(u.verified, false) then
    perform app.fail('email_not_verified', 'Verify your email address before accepting the invitation.');
  end if;
  if not exists (select 1 from public.employees where id = inv.employee_id and status = 'active') then
    perform app.fail('employee_inactive', 'Employee record is inactive.');
  end if;

  perform app.label('account.activate', 'Invitation accepted');
  insert into public.profiles (company_id, employee_id, auth_user_id, role)
  values (inv.company_id, inv.employee_id, v_uid, inv.role)
  returning id into v_profile;

  perform app.label('invitation.accept');
  update public.account_invitations
     set status = 'accepted', accepted_at = now(), accepted_auth_user_id = v_uid
   where id = inv.id;
  return v_profile;
end $$;

-- ================================================================= leave
create or replace function public.submit_leave(
  p_leave_type public.leave_type, p_start_date date, p_end_date date,
  p_reason text default null, p_employee_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me app.me_t; e public.employees; v_id uuid; v_auto boolean := false;
begin
  me := app.require_me();
  select * into e from public.employees
   where id = coalesce(p_employee_id, me.employee_id) and company_id = me.company_id;
  if e.id is null then perform app.fail('not_found', 'Employee not found.'); end if;
  if e.status <> 'active' then perform app.fail('employee_inactive', 'Employee is inactive.'); end if;

  if e.id <> me.employee_id then
    -- recording on behalf: only for employees WITHOUT an active login
    if app.employee_has_login(e.id) then
      perform app.forbid('This employee has a login and must submit their own leave.');
    end if;
    if not (me.role in ('owner', 'admin') or (me.role = 'manager' and app.is_my_outlet(e.outlet_id))) then
      perform app.forbid('You cannot record leave for this employee.');
    end if;
  end if;

  -- a sole Owner's own leave is recorded as auto-approved
  v_auto := (e.id = me.employee_id and me.role = 'owner'
             and app.other_active_owners(me.company_id, me.profile_id) = 0);

  perform app.label(case when v_auto then 'leave.submit_auto_approved'
                         when e.id <> me.employee_id then 'leave.submit_on_behalf'
                         else 'leave.submit' end);
  begin
    insert into public.leave_requests
      (company_id, employee_id, leave_type, start_date, end_date, reason, status,
       submitted_by_profile_id, reviewed_by_profile_id, reviewed_at, auto_approved, review_note)
    values
      (me.company_id, e.id, p_leave_type, p_start_date, p_end_date, nullif(trim(p_reason), ''),
       case when v_auto then 'approved'::public.leave_status else 'pending' end,
       me.profile_id,
       case when v_auto then me.profile_id end,
       case when v_auto then now() end,
       v_auto,
       case when v_auto then 'Auto-approved: sole Owner' end)
    returning id into v_id;
  exception when exclusion_violation then
    perform app.fail('leave_overlap', 'These dates overlap another pending/approved leave.');
  end;
  return v_id;
end $$;

create or replace function public.review_leave(p_leave_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare me app.me_t; lr public.leave_requests; v_outlet uuid; v_applicant public.app_role; v_ok boolean;
begin
  me := app.require_me();
  select * into lr from public.leave_requests where id = p_leave_id and company_id = me.company_id for update;
  if lr.id is null then perform app.fail('not_found', 'Leave request not found.'); end if;
  if lr.status <> 'pending' then perform app.fail('not_pending', 'Only pending requests can be reviewed.'); end if;
  if lr.employee_id = me.employee_id then perform app.forbid('You cannot approve or reject your own leave.'); end if;

  select outlet_id into v_outlet from public.employees where id = lr.employee_id;
  v_applicant := app.employee_effective_role(lr.employee_id);
  v_ok := case v_applicant
            when 'staff'   then me.role in ('owner', 'admin') or (me.role = 'manager' and app.is_my_outlet(v_outlet))
            when 'manager' then me.role in ('owner', 'admin')
            when 'admin'   then me.role in ('owner', 'admin')
            when 'owner'   then me.role = 'owner'
          end;
  if not v_ok then perform app.forbid('You are not allowed to review this leave request.'); end if;
  if not p_approve and coalesce(length(trim(p_note)), 0) = 0 then
    perform app.fail('reason_required', 'A reason is required when rejecting leave.');
  end if;

  perform app.label(case when p_approve then 'leave.approve' else 'leave.reject' end, p_note);
  update public.leave_requests
     set status = case when p_approve then 'approved'::public.leave_status else 'rejected' end,
         reviewed_by_profile_id = me.profile_id, reviewed_at = now(), review_note = nullif(trim(p_note), '')
   where id = lr.id;
end $$;

create or replace function public.cancel_leave(p_leave_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare me app.me_t; lr public.leave_requests; v_outlet uuid;
begin
  me := app.require_me();
  select * into lr from public.leave_requests where id = p_leave_id and company_id = me.company_id for update;
  if lr.id is null then perform app.fail('not_found', 'Leave request not found.'); end if;
  if lr.status <> 'pending' then perform app.fail('not_pending', 'Only pending requests can be cancelled.'); end if;
  if lr.employee_id <> me.employee_id then
    select outlet_id into v_outlet from public.employees where id = lr.employee_id;
    if app.employee_has_login(lr.employee_id)
       or not (me.role in ('owner', 'admin') or (me.role = 'manager' and app.is_my_outlet(v_outlet))) then
      perform app.forbid('You cannot cancel this leave request.');
    end if;
  end if;
  perform app.label('leave.cancel', p_note);
  update public.leave_requests set status = 'cancelled', cancelled_at = now() where id = lr.id;
end $$;

-- ================================================================= tasks
create or replace function app.check_task_assignment(me app.me_t, p_assignee uuid, p_outlet uuid)
returns public.employees language plpgsql stable security definer set search_path = '' as $$
declare e public.employees;
begin
  select * into e from public.employees where id = p_assignee and company_id = me.company_id;
  if e.id is null then perform app.fail('not_found', 'Assignee not found.'); end if;
  if e.status <> 'active' then perform app.fail('employee_inactive', 'Cannot assign tasks to an inactive employee.'); end if;
  if p_outlet is not null and not exists
     (select 1 from public.outlets where id = p_outlet and company_id = me.company_id) then
    perform app.fail('not_found', 'Outlet not found.');
  end if;
  if me.role = 'manager' then
    if not (e.id = me.employee_id or app.is_my_outlet(e.outlet_id)) then
      perform app.forbid('Managers can only assign tasks to staff in their own outlets.');
    end if;
    if p_outlet is not null and not app.is_my_outlet(p_outlet) then
      perform app.forbid('Managers can only create tasks for their own outlets.');
    end if;
  elsif me.role not in ('owner', 'admin') then
    perform app.forbid('Staff cannot create or reassign tasks.');
  end if;
  return e;
end $$;

create or replace function public.create_task(
  p_title text, p_assigned_employee_id uuid, p_description text default null,
  p_due_at timestamptz default null, p_priority public.task_priority default 'normal',
  p_outlet_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me app.me_t; e public.employees; v_outlet uuid; v_id uuid;
begin
  me := app.require_me();
  select outlet_id into v_outlet from public.employees where id = p_assigned_employee_id and company_id = me.company_id;
  v_outlet := coalesce(p_outlet_id, v_outlet);
  e := app.check_task_assignment(me, p_assigned_employee_id, v_outlet);
  perform app.label('task.create');
  insert into public.tasks
    (company_id, outlet_id, title, description, assigned_employee_id, priority, due_at, created_by_profile_id)
  values
    (me.company_id, v_outlet, trim(p_title), nullif(trim(p_description), ''), e.id, p_priority, p_due_at, me.profile_id)
  returning id into v_id;
  return v_id;
end $$;

create or replace function app.can_manage_task(me app.me_t, t public.tasks) returns boolean
language sql stable security definer set search_path = '' as $$
  select me.role in ('owner', 'admin')
      or (me.role = 'manager' and (
            t.created_by_profile_id = me.profile_id
         or app.is_my_outlet(t.outlet_id)
         or app.is_my_outlet((select e.outlet_id from public.employees e where e.id = t.assigned_employee_id))))
$$;

create or replace function public.update_task(
  p_task_id uuid, p_title text, p_description text, p_due_at timestamptz,
  p_priority public.task_priority, p_assigned_employee_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me app.me_t; t public.tasks; e public.employees;
begin
  me := app.require_me();
  select * into t from public.tasks where id = p_task_id and company_id = me.company_id for update;
  if t.id is null then perform app.fail('not_found', 'Task not found.'); end if;
  if not app.can_manage_task(me, t) then perform app.forbid('You cannot edit this task.'); end if;
  if t.status not in ('todo', 'in_progress') then
    perform app.fail('task_locked', 'Only To Do / In Progress tasks can be edited.');
  end if;
  if p_assigned_employee_id <> t.assigned_employee_id then
    e := app.check_task_assignment(me, p_assigned_employee_id, t.outlet_id);
  end if;
  perform app.label(case when p_assigned_employee_id <> t.assigned_employee_id then 'task.reassign' else 'task.update' end);
  update public.tasks
     set title = trim(p_title), description = nullif(trim(p_description), ''), due_at = p_due_at,
         priority = p_priority, assigned_employee_id = p_assigned_employee_id
   where id = t.id;
end $$;

create or replace function public.set_task_status(p_task_id uuid, p_status public.task_status, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare me app.me_t; t public.tasks; v_assignee boolean; v_manage boolean; v_behalf boolean;
begin
  me := app.require_me();
  select * into t from public.tasks where id = p_task_id and company_id = me.company_id for update;
  if t.id is null then perform app.fail('not_found', 'Task not found.'); end if;
  if t.status = p_status then return; end if;

  v_assignee := t.assigned_employee_id = me.employee_id;
  v_manage   := app.can_manage_task(me, t);
  v_behalf   := v_manage and not app.employee_has_login(t.assigned_employee_id);

  if t.status in ('verified', 'cancelled') then
    perform app.fail('invalid_transition', 'Verified or cancelled tasks are final.');
  end if;

  if p_status = 'cancelled' then
    if not (v_manage or t.created_by_profile_id = me.profile_id) then
      perform app.forbid('You cannot cancel this task.');
    end if;
    if coalesce(length(trim(p_note)), 0) = 0 then perform app.fail('reason_required', 'A reason is required to cancel.'); end if;
    perform app.label('task.cancel', p_note);
    update public.tasks set status = 'cancelled', cancelled_at = now(), cancelled_by_profile_id = me.profile_id,
                            cancel_reason = trim(p_note) where id = t.id;

  elsif p_status = 'verified' then
    if t.status <> 'completed' then perform app.fail('invalid_transition', 'Only completed tasks can be verified.'); end if;
    if not v_manage or v_assignee then perform app.forbid('You cannot verify this task (own task or no authority).'); end if;
    perform app.label('task.verify', p_note);
    update public.tasks set status = 'verified', verified_at = now(), verified_by_profile_id = me.profile_id where id = t.id;

  elsif t.status = 'completed' and p_status = 'in_progress' then
    -- send back for rework
    if not v_manage or v_assignee then perform app.forbid('You cannot send this task back.'); end if;
    if coalesce(length(trim(p_note)), 0) = 0 then perform app.fail('reason_required', 'A reason is required to send a task back.'); end if;
    perform app.label('task.send_back', p_note);
    update public.tasks set status = 'in_progress', completed_at = null, completed_by_profile_id = null where id = t.id;

  elsif (t.status, p_status) in (('todo', 'in_progress'), ('in_progress', 'todo'),
                                 ('in_progress', 'completed'), ('todo', 'completed')) then
    if not (v_assignee or v_behalf) then
      perform app.forbid('Only the assignee can update this task (or a manager for employees without login).');
    end if;
    perform app.label('task.status_' || p_status::text, p_note);
    update public.tasks
       set status = p_status,
           started_at = case when p_status = 'in_progress' then coalesce(started_at, now()) else started_at end,
           completed_at = case when p_status = 'completed' then now() end,
           completed_by_profile_id = case when p_status = 'completed' then me.profile_id end
     where id = t.id;
  else
    perform app.fail('invalid_transition', format('Cannot move a task from %s to %s.', t.status, p_status));
  end if;
end $$;

-- ================================================================= dashboard (SECURITY INVOKER: scoped by RLS)
create or replace function public.dashboard_summary()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'role',             app.my_role(),
    'total_staff',      (select count(*) from public.employees where status = 'active'),
    'active_accounts',  (select count(*) from public.profiles where is_active),
    'staff_by_outlet',  coalesce((
        select jsonb_agg(jsonb_build_object('outlet_id', o.id, 'outlet_name', o.name, 'count', c.n) order by o.name)
        from public.outlets o
        join (select outlet_id, count(*) n from public.employees where status = 'active' group by outlet_id) c
          on c.outlet_id = o.id), '[]'::jsonb),
    'pending_leave',    (select count(*) from public.leave_requests where status = 'pending'),
    'open_tasks',       (select count(*) from public.tasks where status in ('todo', 'in_progress')),
    'overdue_tasks',    (select count(*) from public.tasks where status in ('todo', 'in_progress') and due_at < now()),
    'awaiting_verification', (select count(*) from public.tasks where status = 'completed'),
    'my_open_tasks',    (select count(*) from public.tasks
                          where assigned_employee_id = app.my_employee_id() and status in ('todo', 'in_progress')),
    'my_pending_leave', (select count(*) from public.leave_requests
                          where employee_id = app.my_employee_id() and status = 'pending')
  )
$$;

-- ================================================================= bootstrap (DB admin only, never exposed)
create or replace function app.bootstrap_company(
  p_company_name text, p_owner_full_name text, p_owner_email text, p_outlet_names text[] default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_company uuid; v_emp uuid; v_token text; n text;
begin
  perform app.label('company.bootstrap');
  insert into public.companies (name) values (trim(p_company_name)) returning id into v_company;
  foreach n in array p_outlet_names loop
    insert into public.outlets (company_id, name) values (v_company, trim(n));
  end loop;
  insert into public.employees (company_id, full_name, email, position)
  values (v_company, trim(p_owner_full_name), lower(trim(p_owner_email)), 'Owner')
  returning id into v_emp;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.account_invitations (company_id, employee_id, email, role, token_hash, expires_at)
  values (v_company, v_emp, lower(trim(p_owner_email)), 'owner', extensions.digest(v_token, 'sha256'), now() + interval '7 days');
  return jsonb_build_object('company_id', v_company, 'owner_employee_id', v_emp, 'owner_invitation_token', v_token);
end $$;

-- ================================================================= privileges
revoke execute on all functions in schema public from public;
revoke execute on all functions in schema app    from public;

grant execute on function
  public.create_outlet(text, text, text),
  public.update_outlet(uuid, text, text, text, boolean),
  public.create_employee(text, uuid, text, public.employment_type, date, text, text, text),
  public.update_employee(uuid, text, uuid, text, public.employment_type, date, text, text, text),
  public.set_employee_status(uuid, boolean, text),
  public.change_role(uuid, public.app_role, text),
  public.set_account_active(uuid, boolean, text),
  public.assign_manager_outlet(uuid, uuid),
  public.remove_manager_outlet(uuid, uuid),
  public.create_invitation(uuid, public.app_role, text),
  public.revoke_invitation(uuid),
  public.accept_invitation(text),
  public.submit_leave(public.leave_type, date, date, text, uuid),
  public.review_leave(uuid, boolean, text),
  public.cancel_leave(uuid, text),
  public.create_task(text, uuid, text, timestamptz, public.task_priority, uuid),
  public.update_task(uuid, text, text, timestamptz, public.task_priority, uuid),
  public.set_task_status(uuid, public.task_status, text),
  public.dashboard_summary()
to authenticated;

-- helpers used inside RLS policies / invoker functions (re-grant after blanket revoke)
grant execute on function
  app.my_profile_id(), app.my_company_id(), app.my_role(), app.my_employee_id(),
  app.my_outlet_ids(), app.visible_employee_ids(), app.is_my_outlet(uuid)
to authenticated;

commit;

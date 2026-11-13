-- AdminFlow V1 — 006: Admin scoped to their own Syarikat + Owner notifications
-- Owner decisions (2026-11-13):
--   * Only the OWNER sees across Syarikat. An ADMIN sees/manages only the Syarikat the Owner assigned
--     (one or more, via admin_entities). Managers ("Admin Outlet" in the UI) stay outlet-scoped.
--   * Admin leave: the Owner approves, BUT an Admin may approve their OWN leave; every such
--     self-approval is flagged and the Owner is notified. Staff/Managers can never self-approve.
--   * An Admin may create/edit outlets inside their own Syarikat. Registering a Syarikat stays Owner-only.
--   * Every outlet belongs to a Syarikat. Every employee belongs to a Syarikat
--     (legal_entity_id NULL = group level, visible to the Owner only).

begin;

-- ================================================================= structure
alter table public.outlets alter column legal_entity_id set not null;
alter table public.outlets add constraint outlets_company_entity_id_uq unique (company_id, legal_entity_id, id);

alter table public.employees add column legal_entity_id uuid;
alter table public.employees add constraint employees_legal_entity_fk
  foreign key (company_id, legal_entity_id) references public.legal_entities (company_id, id);
-- the employee's outlet must belong to the employee's Syarikat (follows the outlet if it moves)
alter table public.employees add constraint employees_outlet_same_entity_fk
  foreign key (company_id, legal_entity_id, outlet_id)
  references public.outlets (company_id, legal_entity_id, id) on update cascade;
alter table public.employees add constraint employees_outlet_needs_entity
  check (outlet_id is null or legal_entity_id is not null);
create index employees_company_entity_idx on public.employees (company_id, legal_entity_id);

create table public.admin_entities (
  company_id              uuid not null,
  profile_id              uuid not null,
  legal_entity_id         uuid not null,
  assigned_by_profile_id  uuid,
  created_at              timestamptz not null default now(),
  primary key (profile_id, legal_entity_id),
  foreign key (company_id, profile_id)             references public.profiles (company_id, id),
  foreign key (company_id, legal_entity_id)        references public.legal_entities (company_id, id),
  foreign key (company_id, assigned_by_profile_id) references public.profiles (company_id, id)
);
create index admin_entities_entity_idx on public.admin_entities (company_id, legal_entity_id);

alter table public.leave_requests add column self_approved boolean not null default false;

alter table public.audit_logs add column legal_entity_id uuid;
create index audit_logs_entity_scope_idx on public.audit_logs (company_id, legal_entity_id, created_at desc);

create table public.notifications (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies (id),
  recipient_profile_id  uuid not null,
  type                  text not null,
  title                 text not null,
  body                  text,
  entity_type           text,
  entity_id             uuid,
  created_at            timestamptz not null default now(),
  read_at               timestamptz,
  foreign key (company_id, recipient_profile_id) references public.profiles (company_id, id)
);
create index notifications_recipient_idx on public.notifications (recipient_profile_id, created_at desc);
create index notifications_unread_idx on public.notifications (recipient_profile_id) where read_at is null;

-- ================================================================= identity helpers
create or replace function app.my_entity_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select ae.legal_entity_id from public.admin_entities ae
  where ae.profile_id = app.my_profile_id() and app.my_role() = 'admin'
$$;

create or replace function app.is_my_entity(p_legal_entity_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_legal_entity_id is not null and p_legal_entity_id in (select app.my_entity_ids())
$$;

-- owner = whole group; admin = own Syarikat + self; manager = own outlets + self; staff = self
create or replace function app.visible_employee_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select e.id
  from public.employees e
  where e.company_id = app.my_company_id()
    and (
      app.my_role() = 'owner'
      or e.id = app.my_employee_id()
      or (app.my_role() = 'admin' and e.legal_entity_id in (select app.my_entity_ids()))
      or (app.my_role() = 'manager' and e.outlet_id in (select app.my_outlet_ids()))
    )
$$;

create or replace function app.visible_outlet_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select o.id from public.outlets o
  where o.company_id = app.my_company_id()
    and (
      app.my_role() = 'owner'
      or (app.my_role() = 'admin' and o.legal_entity_id in (select app.my_entity_ids()))
      or o.id in (select app.my_outlet_ids())
      or o.id = (select e.outlet_id from public.employees e where e.id = app.my_employee_id())
    )
$$;

create or replace function app.visible_entity_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select le.id from public.legal_entities le
  where le.company_id = app.my_company_id()
    and (
      app.my_role() = 'owner'
      or le.id in (select app.my_entity_ids())
      or le.id in (select o.legal_entity_id from public.outlets o where o.id in (select app.visible_outlet_ids()))
      or le.id = (select e.legal_entity_id from public.employees e where e.id = app.my_employee_id())
    )
$$;

create or replace function app.employee_entity(p_employee_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select legal_entity_id from public.employees where id = p_employee_id
$$;

-- caller may manage this employee as owner (anyone) or admin (own Syarikat, not Owner)
create or replace function app.admin_can_manage_employee(me app.me_t, p_employee_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select me.role = 'owner'
      or (me.role = 'admin'
          and app.is_my_entity(app.employee_entity(p_employee_id))
          and app.employee_effective_role(p_employee_id) <> 'owner')
$$;

create or replace function app.notify_owners(
  p_company_id uuid, p_type text, p_title text, p_body text, p_entity_type text, p_entity_id uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (company_id, recipient_profile_id, type, title, body, entity_type, entity_id)
  select p.company_id, p.id, p_type, p_title, p_body, p_entity_type, p_entity_id
  from public.profiles p
  where p.company_id = p_company_id and p.role = 'owner' and p.is_active
$$;

grant execute on function app.my_entity_ids(), app.is_my_entity(uuid), app.visible_outlet_ids(),
  app.visible_entity_ids() to authenticated;

-- ================================================================= RLS (replace scoped policies)
drop policy outlets_select on public.outlets;
create policy outlets_select on public.outlets for select to authenticated
  using (company_id = (select app.my_company_id()) and id in (select app.visible_outlet_ids()));

drop policy legal_entities_select on public.legal_entities;
create policy legal_entities_select on public.legal_entities for select to authenticated
  using (company_id = (select app.my_company_id()) and id in (select app.visible_entity_ids()));

drop policy manager_outlets_select on public.manager_outlets;
create policy manager_outlets_select on public.manager_outlets for select to authenticated
  using (company_id = (select app.my_company_id())
         and (profile_id = (select app.my_profile_id())
              or ((select app.my_role()) in ('owner', 'admin') and outlet_id in (select app.visible_outlet_ids()))));

drop policy account_invitations_select on public.account_invitations;
create policy account_invitations_select on public.account_invitations for select to authenticated
  using (company_id = (select app.my_company_id())
         and (select app.my_role()) in ('owner', 'admin')
         and employee_id in (select app.visible_employee_ids()));

drop policy audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (company_id = (select app.my_company_id())
         and ((select app.my_role()) = 'owner'
              or ((select app.my_role()) = 'admin' and legal_entity_id in (select app.my_entity_ids()))));

drop policy tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (company_id = (select app.my_company_id())
         and (assigned_employee_id in (select app.visible_employee_ids())
              or created_by_profile_id = (select app.my_profile_id())));

alter table public.admin_entities enable row level security;
create policy admin_entities_select on public.admin_entities for select to authenticated
  using (company_id = (select app.my_company_id())
         and ((select app.my_role()) = 'owner' or profile_id = (select app.my_profile_id())));

alter table public.notifications enable row level security;
create policy notifications_select on public.notifications for select to authenticated
  using (recipient_profile_id = (select app.my_profile_id()));

grant select on public.admin_entities, public.notifications to authenticated;

-- ================================================================= audit: record the Syarikat of each change
create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old     jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new     jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row     jsonb := coalesce(v_new, v_old);
  v_action  text  := nullif(current_setting('app.audit_action', true), '');
  v_note    text  := nullif(current_setting('app.audit_note', true), '');
  v_emp     uuid;
  v_entity  uuid;
  v_le      uuid;
begin
  v_old := v_old - 'token_hash';
  v_new := v_new - 'token_hash';
  if tg_op = 'UPDATE' and (v_old - 'updated_at') = (v_new - 'updated_at') then
    return null;
  end if;

  v_emp := case tg_table_name
             when 'employees' then (v_row->>'id')::uuid
             when 'tasks'     then (v_row->>'assigned_employee_id')::uuid
             when 'manager_outlets' then
               (select p.employee_id from public.profiles p where p.id = (v_row->>'profile_id')::uuid)
             when 'admin_entities' then
               (select p.employee_id from public.profiles p where p.id = (v_row->>'profile_id')::uuid)
             when 'outlets' then null
             when 'legal_entities' then null
             when 'companies' then null
             else (v_row->>'employee_id')::uuid
           end;
  v_entity := case when tg_table_name in ('manager_outlets', 'admin_entities')
                   then (v_row->>'profile_id')::uuid
                   else (v_row->>'id')::uuid end;
  v_le := case tg_table_name
            when 'legal_entities' then (v_row->>'id')::uuid
            when 'outlets'        then (v_row->>'legal_entity_id')::uuid
            when 'employees'      then (v_row->>'legal_entity_id')::uuid
            when 'admin_entities' then (v_row->>'legal_entity_id')::uuid
            when 'manager_outlets' then
              (select o.legal_entity_id from public.outlets o where o.id = (v_row->>'outlet_id')::uuid)
            else (select e.legal_entity_id from public.employees e where e.id = v_emp)
          end;

  insert into public.audit_logs
    (company_id, legal_entity_id, actor_profile_id, actor_auth_user_id, action, entity_type, entity_id,
     employee_id, old_data, new_data, note)
  values
    (coalesce((v_row->>'company_id')::uuid, case when tg_table_name = 'companies' then (v_row->>'id')::uuid end),
     v_le, app.my_profile_id(), auth.uid(),
     coalesce(v_action, tg_table_name || '.' || lower(tg_op)),
     tg_table_name, v_entity, v_emp, v_old, v_new, v_note);
  return null;
end $$;

create trigger audit_admin_entities after insert or update or delete on public.admin_entities
  for each row execute function app.audit_row();

-- ================================================================= Syarikat ↔ Admin assignment (Owner only)
create or replace function public.assign_admin_entity(p_profile_id uuid, p_legal_entity_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me app.me_t; pr public.profiles;
begin
  me := app.require_me();
  if me.role <> 'owner' then perform app.forbid('Only the Owner can assign a Syarikat to an Admin.'); end if;
  select * into pr from public.profiles where id = p_profile_id and company_id = me.company_id;
  if pr.id is null or pr.role <> 'admin' or not pr.is_active then
    perform app.fail('not_an_admin', 'A Syarikat can only be assigned to an active Admin account.');
  end if;
  if not exists (select 1 from public.legal_entities where id = p_legal_entity_id and company_id = me.company_id and is_active) then
    perform app.fail('not_found', 'Active Syarikat not found.');
  end if;
  perform app.label('admin_entity.assign');
  insert into public.admin_entities (company_id, profile_id, legal_entity_id, assigned_by_profile_id)
  values (me.company_id, pr.id, p_legal_entity_id, me.profile_id)
  on conflict (profile_id, legal_entity_id) do nothing;
end $$;

create or replace function public.remove_admin_entity(p_profile_id uuid, p_legal_entity_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me app.me_t;
begin
  me := app.require_me();
  if me.role <> 'owner' then perform app.forbid('Only the Owner can remove a Syarikat from an Admin.'); end if;
  perform app.label('admin_entity.remove');
  delete from public.admin_entities
   where profile_id = p_profile_id and legal_entity_id = p_legal_entity_id and company_id = me.company_id;
end $$;

-- ================================================================= outlets (Admin inside own Syarikat)
create or replace function app.check_legal_entity(p_company_id uuid, p_legal_entity_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_legal_entity_id is null or not exists
     (select 1 from public.legal_entities where id = p_legal_entity_id and company_id = p_company_id and is_active) then
    perform app.fail('not_found', 'Active Syarikat not found.');
  end if;
end $$;

drop function public.create_outlet(text, uuid, text, text);
create or replace function public.create_outlet(
  p_name text, p_legal_entity_id uuid, p_code text default null, p_address text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me app.me_t; v_id uuid;
begin
  me := app.require_me();
  if me.role not in ('owner', 'admin') then perform app.forbid('Only Owner/Admin can create outlets.'); end if;
  perform app.check_legal_entity(me.company_id, p_legal_entity_id);
  if me.role = 'admin' and not app.is_my_entity(p_legal_entity_id) then
    perform app.forbid('Admins can only create outlets in their own Syarikat.');
  end if;
  perform app.label('outlet.create');
  insert into public.outlets (company_id, legal_entity_id, name, code, address)
  values (me.company_id, p_legal_entity_id, trim(p_name), upper(nullif(trim(p_code), '')), nullif(trim(p_address), ''))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.update_outlet(
  p_outlet_id uuid, p_name text, p_legal_entity_id uuid, p_code text, p_address text, p_is_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare me app.me_t; o public.outlets;
begin
  me := app.require_me();
  if me.role not in ('owner', 'admin') then perform app.forbid('Only Owner/Admin can edit outlets.'); end if;
  select * into o from public.outlets where id = p_outlet_id and company_id = me.company_id for update;
  if o.id is null then perform app.fail('not_found', 'Outlet not found.'); end if;
  perform app.check_legal_entity(me.company_id, p_legal_entity_id);
  if me.role = 'admin' and not (app.is_my_entity(o.legal_entity_id) and app.is_my_entity(p_legal_entity_id)) then
    perform app.forbid('Admins can only edit outlets in their own Syarikat.');
  end if;
  perform app.label('outlet.update');
  update public.outlets
     set name = trim(p_name), legal_entity_id = p_legal_entity_id, code = upper(nullif(trim(p_code), '')),
         address = nullif(trim(p_address), ''), is_active = p_is_active
   where id = o.id;
end $$;

-- ================================================================= employees (gain Syarikat)
-- Resolve and validate (entity, outlet) for the caller. Outlet implies its Syarikat.
create or replace function app.resolve_placement(me app.me_t, p_legal_entity_id uuid, p_outlet_id uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_entity uuid := p_legal_entity_id; v_outlet_entity uuid;
begin
  if p_outlet_id is not null then
    select legal_entity_id into v_outlet_entity from public.outlets where id = p_outlet_id and company_id = me.company_id;
    if v_outlet_entity is null then perform app.fail('not_found', 'Outlet not found.'); end if;
    if v_entity is not null and v_entity <> v_outlet_entity then
      perform app.fail('entity_mismatch', 'The outlet belongs to a different Syarikat.');
    end if;
    v_entity := v_outlet_entity;
  end if;
  if v_entity is not null then perform app.check_legal_entity(me.company_id, v_entity); end if;
  if me.role = 'admin' and not app.is_my_entity(v_entity) then
    perform app.forbid('Admins can only place employees in their own Syarikat.');
  end if;
  if me.role = 'manager' and not app.is_my_outlet(p_outlet_id) then
    perform app.forbid('Managers can only place staff in their own outlets.');
  end if;
  return v_entity;
end $$;

drop function public.create_employee(text, uuid, text, public.employment_type, date, text, text, text);
create or replace function public.create_employee(
  p_full_name text,
  p_outlet_id uuid default null,
  p_position text default null,
  p_employment_type public.employment_type default 'full_time',
  p_join_date date default null,
  p_phone text default null,
  p_email text default null,
  p_employee_no text default null,
  p_legal_entity_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me app.me_t; v_id uuid; v_entity uuid;
begin
  me := app.require_me();
  if me.role not in ('owner', 'admin') then perform app.forbid('Only Owner/Admin can register employees.'); end if;
  v_entity := app.resolve_placement(me, p_legal_entity_id, p_outlet_id);
  perform app.label('employee.create');
  insert into public.employees
    (company_id, legal_entity_id, outlet_id, full_name, position, employment_type, join_date, phone, email, employee_no)
  values
    (me.company_id, v_entity, p_outlet_id, trim(p_full_name), nullif(trim(p_position), ''), p_employment_type,
     p_join_date, nullif(trim(p_phone), ''), lower(nullif(trim(p_email), '')), nullif(trim(p_employee_no), ''))
  returning id into v_id;
  return v_id;
end $$;

drop function public.update_employee(uuid, text, uuid, text, public.employment_type, date, text, text, text);
create or replace function public.update_employee(
  p_employee_id uuid,
  p_full_name text,
  p_outlet_id uuid,
  p_position text,
  p_employment_type public.employment_type,
  p_join_date date,
  p_phone text,
  p_email text,
  p_employee_no text,
  p_legal_entity_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare me app.me_t; e public.employees; v_target_role public.app_role; v_entity uuid;
begin
  me := app.require_me();
  select * into e from public.employees where id = p_employee_id and company_id = me.company_id for update;
  if e.id is null then perform app.fail('not_found', 'Employee not found.'); end if;
  v_target_role := app.employee_effective_role(e.id);

  if me.role = 'owner' then
    null;
  elsif me.role = 'admin' then
    if e.id <> me.employee_id and not app.admin_can_manage_employee(me, e.id) then
      perform app.forbid('Admins can only edit employees of their own Syarikat (not the Owner).');
    end if;
  elsif me.role = 'manager' then
    if e.id = me.employee_id or v_target_role <> 'staff' or not app.is_my_outlet(e.outlet_id) then
      perform app.forbid('Managers can only edit staff in their own outlets.');
    end if;
  else
    perform app.forbid('Staff cannot edit employee records.');
  end if;

  -- default: keep current Syarikat unless an outlet or a new Syarikat is given
  v_entity := app.resolve_placement(me, coalesce(p_legal_entity_id, case when p_outlet_id is null then e.legal_entity_id end), p_outlet_id);

  perform app.label('employee.update');
  update public.employees
     set full_name = trim(p_full_name), legal_entity_id = v_entity, outlet_id = p_outlet_id,
         position = nullif(trim(p_position), ''), employment_type = p_employment_type, join_date = p_join_date,
         phone = nullif(trim(p_phone), ''), email = lower(nullif(trim(p_email), '')),
         employee_no = nullif(trim(p_employee_no), '')
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
  if me.role = 'admin' and (v_target_role in ('owner', 'admin') or not app.admin_can_manage_employee(me, e.id)) then
    perform app.forbid('Admins can only change staff/managers of their own Syarikat.');
  end if;
  select * into pr from public.profiles where employee_id = e.id for update;

  if p_active then
    if e.status = 'active' then return; end if;
    perform app.label('employee.reactivate', p_note);
    update public.employees set status = 'active', deactivated_at = null where id = e.id;
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

  if pr.role in ('owner', 'admin') or p_new_role in ('owner', 'admin') then
    if me.role <> 'owner' then perform app.forbid('Only the Owner can grant or remove Owner/Admin roles.'); end if;
  elsif me.role = 'admin' then
    if not app.admin_can_manage_employee(me, pr.employee_id) then
      perform app.forbid('Admins can only change roles inside their own Syarikat.');
    end if;
  elsif me.role <> 'owner' then
    perform app.forbid('Only Owner/Admin can change roles.');
  end if;

  if pr.role = 'owner' and app.other_active_owners(me.company_id, pr.id) = 0 then
    perform app.fail('last_owner', 'The company must always have at least one active Owner.');
  end if;
  if pr.role = 'manager' then
    perform app.label('manager_outlet.remove', 'Role changed from manager');
    delete from public.manager_outlets where profile_id = pr.id;
  end if;
  if pr.role = 'admin' then
    perform app.label('admin_entity.remove', 'Role changed from admin');
    delete from public.admin_entities where profile_id = pr.id;
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
  if me.role = 'admin' and (pr.role in ('owner', 'admin') or not app.admin_can_manage_employee(me, pr.employee_id)) then
    perform app.forbid('Admins can only manage staff/manager accounts of their own Syarikat.');
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
declare me app.me_t; pr public.profiles; v_entity uuid;
begin
  me := app.require_me();
  if me.role not in ('owner', 'admin') then perform app.forbid('Only Owner/Admin can assign outlets to managers.'); end if;
  select * into pr from public.profiles where id = p_profile_id and company_id = me.company_id;
  if pr.id is null or pr.role <> 'manager' or not pr.is_active then
    perform app.fail('not_a_manager', 'Outlets can only be assigned to an active Manager account.');
  end if;
  select legal_entity_id into v_entity from public.outlets where id = p_outlet_id and company_id = me.company_id and is_active;
  if v_entity is null then perform app.fail('not_found', 'Active outlet not found.'); end if;
  if me.role = 'admin' and not (app.is_my_entity(v_entity) and app.admin_can_manage_employee(me, pr.employee_id)) then
    perform app.forbid('Admins can only assign outlets of their own Syarikat to their own managers.');
  end if;
  perform app.label('manager_outlet.assign');
  insert into public.manager_outlets (company_id, profile_id, outlet_id, assigned_by_profile_id)
  values (me.company_id, pr.id, p_outlet_id, me.profile_id)
  on conflict (profile_id, outlet_id) do nothing;
end $$;

create or replace function public.remove_manager_outlet(p_profile_id uuid, p_outlet_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me app.me_t; v_entity uuid;
begin
  me := app.require_me();
  if me.role not in ('owner', 'admin') then perform app.forbid('Only Owner/Admin can remove manager outlets.'); end if;
  select legal_entity_id into v_entity from public.outlets where id = p_outlet_id and company_id = me.company_id;
  if me.role = 'admin' and not app.is_my_entity(v_entity) then
    perform app.forbid('Admins can only manage outlets of their own Syarikat.');
  end if;
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
  if me.role = 'admin' and not app.admin_can_manage_employee(me, e.id) then
    perform app.forbid('Admins can only invite employees of their own Syarikat.');
  end if;
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
  if me.role = 'admin' and (inv.role in ('owner', 'admin') or not app.admin_can_manage_employee(me, inv.employee_id)) then
    perform app.forbid('Admins can only revoke staff/manager invitations of their own Syarikat.');
  end if;
  perform app.label('invitation.revoke');
  update public.account_invitations set status = 'revoked', revoked_at = now() where id = inv.id;
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
    if app.employee_has_login(e.id) then
      perform app.forbid('This employee has a login and must submit their own leave.');
    end if;
    if not (me.role = 'owner'
            or (me.role = 'admin' and app.admin_can_manage_employee(me, e.id))
            or (me.role = 'manager' and app.is_my_outlet(e.outlet_id))) then
      perform app.forbid('You cannot record leave for this employee.');
    end if;
  end if;

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

  if me.role = 'admin' and e.id = me.employee_id then
    perform app.notify_owners(me.company_id, 'leave.admin_submitted', 'Admin mohon cuti',
      format('%s mohon cuti %s hingga %s.', e.full_name, p_start_date, p_end_date), 'leave_requests', v_id);
  end if;
  return v_id;
end $$;

create or replace function public.review_leave(p_leave_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare me app.me_t; lr public.leave_requests; v_outlet uuid; v_applicant public.app_role;
        v_ok boolean; v_self boolean; v_name text;
begin
  me := app.require_me();
  select * into lr from public.leave_requests where id = p_leave_id and company_id = me.company_id for update;
  if lr.id is null then perform app.fail('not_found', 'Leave request not found.'); end if;
  if lr.status <> 'pending' then perform app.fail('not_pending', 'Only pending requests can be reviewed.'); end if;

  v_self := lr.employee_id = me.employee_id;
  if v_self then
    -- Owner decision: an Admin may approve (never reject) their own leave; the Owner is notified.
    if me.role <> 'admin' then perform app.forbid('You cannot approve or reject your own leave.'); end if;
    if not p_approve then perform app.fail('invalid_transition', 'Cancel your own request instead of rejecting it.'); end if;
    perform app.label('leave.self_approve', p_note);
    update public.leave_requests
       set status = 'approved', reviewed_by_profile_id = me.profile_id, reviewed_at = now(),
           review_note = coalesce(nullif(trim(p_note), ''), 'Self-approved by Admin'), self_approved = true
     where id = lr.id;
    select full_name into v_name from public.employees where id = lr.employee_id;
    perform app.notify_owners(me.company_id, 'leave.admin_self_approved', 'Admin luluskan cuti sendiri',
      format('%s meluluskan cuti sendiri %s hingga %s.', v_name, lr.start_date, lr.end_date), 'leave_requests', lr.id);
    return;
  end if;

  select outlet_id into v_outlet from public.employees where id = lr.employee_id;
  v_applicant := app.employee_effective_role(lr.employee_id);
  v_ok := case v_applicant
            when 'staff'   then me.role = 'owner'
                                or (me.role = 'admin' and app.admin_can_manage_employee(me, lr.employee_id))
                                or (me.role = 'manager' and app.is_my_outlet(v_outlet))
            when 'manager' then me.role = 'owner'
                                or (me.role = 'admin' and app.admin_can_manage_employee(me, lr.employee_id))
            when 'admin'   then me.role = 'owner'
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
       or not (me.role = 'owner'
               or (me.role = 'admin' and app.admin_can_manage_employee(me, lr.employee_id))
               or (me.role = 'manager' and app.is_my_outlet(v_outlet))) then
      perform app.forbid('You cannot cancel this leave request.');
    end if;
  end if;
  perform app.label('leave.cancel', p_note);
  update public.leave_requests set status = 'cancelled', cancelled_at = now() where id = lr.id;
end $$;

-- ================================================================= tasks
create or replace function app.check_task_assignment(me app.me_t, p_assignee uuid, p_outlet uuid)
returns public.employees language plpgsql stable security definer set search_path = '' as $$
declare e public.employees; v_outlet_entity uuid;
begin
  select * into e from public.employees where id = p_assignee and company_id = me.company_id;
  if e.id is null then perform app.fail('not_found', 'Assignee not found.'); end if;
  if e.status <> 'active' then perform app.fail('employee_inactive', 'Cannot assign tasks to an inactive employee.'); end if;
  if p_outlet is not null then
    select legal_entity_id into v_outlet_entity from public.outlets where id = p_outlet and company_id = me.company_id;
    if v_outlet_entity is null then perform app.fail('not_found', 'Outlet not found.'); end if;
  end if;
  if me.role = 'admin' then
    if not (e.id = me.employee_id or app.admin_can_manage_employee(me, e.id)) then
      perform app.forbid('Admins can only assign tasks inside their own Syarikat.');
    end if;
    if p_outlet is not null and not app.is_my_entity(v_outlet_entity) then
      perform app.forbid('Admins can only create tasks for outlets of their own Syarikat.');
    end if;
  elsif me.role = 'manager' then
    if not (e.id = me.employee_id or app.is_my_outlet(e.outlet_id)) then
      perform app.forbid('Managers can only assign tasks to staff in their own outlets.');
    end if;
    if p_outlet is not null and not app.is_my_outlet(p_outlet) then
      perform app.forbid('Managers can only create tasks for their own outlets.');
    end if;
  elsif me.role <> 'owner' then
    perform app.forbid('Staff cannot create or reassign tasks.');
  end if;
  return e;
end $$;

create or replace function app.can_manage_task(me app.me_t, t public.tasks) returns boolean
language sql stable security definer set search_path = '' as $$
  select me.role = 'owner'
      or t.created_by_profile_id = me.profile_id and me.role in ('admin', 'manager')
      or (me.role = 'admin' and (app.admin_can_manage_employee(me, t.assigned_employee_id)
             or app.is_my_entity((select o.legal_entity_id from public.outlets o where o.id = t.outlet_id))))
      or (me.role = 'manager' and (
             app.is_my_outlet(t.outlet_id)
          or app.is_my_outlet((select e.outlet_id from public.employees e where e.id = t.assigned_employee_id))))
$$;

-- ================================================================= notifications
create or replace function public.mark_notification_read(p_notification_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare me app.me_t;
begin
  me := app.require_me();
  update public.notifications set read_at = now()
   where recipient_profile_id = me.profile_id and read_at is null
     and (p_notification_id is null or id = p_notification_id);
end $$;

-- ================================================================= dashboard
create or replace function public.dashboard_summary()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'role',             app.my_role(),
    'total_staff',      (select count(*) from public.employees where status = 'active'),
    'active_accounts',  (select count(*) from public.profiles where is_active),
    'staff_by_outlet',  coalesce((
        select jsonb_agg(jsonb_build_object('outlet_id', o.id, 'outlet_name', o.name,
                                            'legal_entity_id', o.legal_entity_id, 'count', c.n) order by o.name)
        from public.outlets o
        join (select outlet_id, count(*) n from public.employees where status = 'active' group by outlet_id) c
          on c.outlet_id = o.id), '[]'::jsonb),
    'staff_by_entity',  coalesce((
        select jsonb_agg(jsonb_build_object('legal_entity_id', le.id, 'legal_entity_name', le.name, 'count', c.n) order by le.name)
        from public.legal_entities le
        join (select legal_entity_id, count(*) n from public.employees
              where status = 'active' group by legal_entity_id) c
          on c.legal_entity_id = le.id), '[]'::jsonb),
    'pending_leave',    (select count(*) from public.leave_requests where status = 'pending'),
    'open_tasks',       (select count(*) from public.tasks where status in ('todo', 'in_progress')),
    'overdue_tasks',    (select count(*) from public.tasks where status in ('todo', 'in_progress') and due_at < now()),
    'awaiting_verification', (select count(*) from public.tasks where status = 'completed'),
    'my_open_tasks',    (select count(*) from public.tasks
                          where assigned_employee_id = app.my_employee_id() and status in ('todo', 'in_progress')),
    'my_pending_leave', (select count(*) from public.leave_requests
                          where employee_id = app.my_employee_id() and status = 'pending'),
    'unread_notifications', (select count(*) from public.notifications where read_at is null)
  )
$$;

-- ================================================================= bootstrap: group + Syarikat + outlets
drop function app.bootstrap_company(text, text, text, text[]);
-- p_entities: [{"name": "...", "registration_no": "...", "outlets": ["Outlet A", ...]}, ...]
create or replace function app.bootstrap_company(
  p_group_name text, p_owner_full_name text, p_owner_email text, p_entities jsonb default '[]')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_company uuid; v_emp uuid; v_token text; v_ent uuid; ent jsonb; o text;
begin
  perform app.label('company.bootstrap');
  insert into public.companies (name) values (trim(p_group_name)) returning id into v_company;
  for ent in select * from jsonb_array_elements(p_entities) loop
    insert into public.legal_entities (company_id, name, registration_no)
    values (v_company, trim(ent->>'name'), nullif(trim(ent->>'registration_no'), ''))
    returning id into v_ent;
    for o in select jsonb_array_elements_text(coalesce(ent->'outlets', '[]')) loop
      insert into public.outlets (company_id, legal_entity_id, name) values (v_company, v_ent, trim(o));
    end loop;
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
  public.assign_admin_entity(uuid, uuid),
  public.remove_admin_entity(uuid, uuid),
  public.create_outlet(text, uuid, text, text),
  public.create_employee(text, uuid, text, public.employment_type, date, text, text, text, uuid),
  public.update_employee(uuid, text, uuid, text, public.employment_type, date, text, text, text, uuid),
  public.mark_notification_read(uuid),
  public.dashboard_summary()
to authenticated;
grant execute on function
  app.my_profile_id(), app.my_company_id(), app.my_role(), app.my_employee_id(),
  app.my_outlet_ids(), app.visible_employee_ids(), app.is_my_outlet(uuid),
  app.my_entity_ids(), app.is_my_entity(uuid), app.visible_outlet_ids(), app.visible_entity_ids()
to authenticated;

commit;

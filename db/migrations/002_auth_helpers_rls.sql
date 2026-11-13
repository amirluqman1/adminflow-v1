-- AdminFlow V1 — 002: identity helpers, RLS policies, grants
-- Identity comes ONLY from the verified JWT via auth.uid() (pg_session_jwt, installed by Neon Data API).
-- The browser (role `authenticated`) gets SELECT only. All writes go through RPC functions (004).

begin;

-- ---------------------------------------------------------------- lock down defaults
revoke all on schema app from public;
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema app    revoke execute on functions from public;

-- ---------------------------------------------------------------- identity helpers
-- SECURITY DEFINER so they can read profiles without recursing into RLS.
-- Return NULL when the caller has no ACTIVE profile -> every policy then denies.

create or replace function app.my_profile_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.id
  from public.profiles p
  join public.employees e on e.id = p.employee_id
  where p.auth_user_id = auth.uid() and p.is_active and e.status = 'active'
$$;

create or replace function app.my_company_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.company_id from public.profiles p where p.id = app.my_profile_id()
$$;

create or replace function app.my_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = app.my_profile_id()
$$;

create or replace function app.my_employee_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.employee_id from public.profiles p where p.id = app.my_profile_id()
$$;

-- Outlets the caller manages (only meaningful for role = manager).
create or replace function app.my_outlet_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select mo.outlet_id
  from public.manager_outlets mo
  where mo.profile_id = app.my_profile_id()
    and app.my_role() = 'manager'
$$;

-- Employees the caller may see: owner/admin = whole company, manager = own outlets + self, staff = self.
create or replace function app.visible_employee_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select e.id
  from public.employees e
  where e.company_id = app.my_company_id()
    and (
      app.my_role() in ('owner', 'admin')
      or e.id = app.my_employee_id()
      or (app.my_role() = 'manager'
          and e.outlet_id in (select mo.outlet_id from public.manager_outlets mo
                              where mo.profile_id = app.my_profile_id()))
    )
$$;

-- Effective role of an employee for approval rules: their active profile role, else 'staff'.
create or replace function app.employee_effective_role(p_employee_id uuid) returns public.app_role
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select p.role from public.profiles p where p.employee_id = p_employee_id and p.is_active),
    'staff'::public.app_role)
$$;

create or replace function app.employee_has_login(p_employee_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.employee_id = p_employee_id and p.is_active)
$$;

create or replace function app.is_my_outlet(p_outlet_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_outlet_id is not null and p_outlet_id in (select app.my_outlet_ids())
$$;

grant usage on schema app to authenticated;
grant execute on function
  app.my_profile_id(), app.my_company_id(), app.my_role(), app.my_employee_id(),
  app.my_outlet_ids(), app.visible_employee_ids(), app.is_my_outlet(uuid)
to authenticated;

-- ---------------------------------------------------------------- enable RLS everywhere
alter table public.companies           enable row level security;
alter table public.outlets             enable row level security;
alter table public.employees           enable row level security;
alter table public.profiles            enable row level security;
alter table public.manager_outlets     enable row level security;
alter table public.account_invitations enable row level security;
alter table public.leave_requests      enable row level security;
alter table public.tasks               enable row level security;
alter table public.audit_logs          enable row level security;

-- ---------------------------------------------------------------- SELECT policies (read only)
create policy companies_select on public.companies for select to authenticated
  using (id = (select app.my_company_id()));

create policy outlets_select on public.outlets for select to authenticated
  using (company_id = (select app.my_company_id()));

create policy employees_select on public.employees for select to authenticated
  using (company_id = (select app.my_company_id())
         and id in (select app.visible_employee_ids()));

create policy profiles_select on public.profiles for select to authenticated
  using (company_id = (select app.my_company_id())
         and employee_id in (select app.visible_employee_ids()));

create policy manager_outlets_select on public.manager_outlets for select to authenticated
  using (company_id = (select app.my_company_id())
         and ((select app.my_role()) in ('owner', 'admin')
              or profile_id = (select app.my_profile_id())));

create policy account_invitations_select on public.account_invitations for select to authenticated
  using (company_id = (select app.my_company_id())
         and (select app.my_role()) in ('owner', 'admin'));

create policy leave_requests_select on public.leave_requests for select to authenticated
  using (company_id = (select app.my_company_id())
         and employee_id in (select app.visible_employee_ids()));

create policy tasks_select on public.tasks for select to authenticated
  using (company_id = (select app.my_company_id())
         and (assigned_employee_id in (select app.visible_employee_ids())
              or created_by_profile_id = (select app.my_profile_id())
              or outlet_id in (select app.my_outlet_ids())));

create policy audit_logs_select on public.audit_logs for select to authenticated
  using (company_id = (select app.my_company_id())
         and (select app.my_role()) in ('owner', 'admin'));

-- ---------------------------------------------------------------- grants: SELECT only
revoke all on all tables in schema public from anonymous, authenticated;
grant usage on schema public to authenticated;
grant select on
  public.companies, public.outlets, public.employees, public.profiles, public.manager_outlets,
  public.leave_requests, public.tasks, public.audit_logs
to authenticated;
-- token_hash is never readable by API users
grant select (id, company_id, employee_id, email, role, status, expires_at, invited_by_profile_id,
              accepted_at, accepted_auth_user_id, revoked_at, created_at, updated_at)
  on public.account_invitations to authenticated;

-- ---------------------------------------------------------------- task overview view (overdue computed)
create view public.task_overview with (security_invoker = true) as
select t.*,
       (t.status in ('todo', 'in_progress') and t.due_at is not null and t.due_at < now()) as is_overdue,
       e.full_name as assigned_employee_name,
       o.name      as outlet_name
from public.tasks t
left join public.employees e on e.id = t.assigned_employee_id
left join public.outlets o on o.id = t.outlet_id;

grant select on public.task_overview to authenticated;

commit;

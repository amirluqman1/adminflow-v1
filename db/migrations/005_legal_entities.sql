-- AdminFlow V1 — 005: legal entities (Syarikat) between group and outlets
-- Model:  companies (the family GROUP, one login scope)
--           └── legal_entities (each registered company / Sdn Bhd, with SSM no.)
--                 └── outlets (many per entity)
-- Owner sees everything in the group. Managers stay outlet-scoped (unchanged).
-- UI wording: companies = "Group", legal_entities = "Syarikat", outlets = "Outlet".

begin;

create table public.legal_entities (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id),
  name            text not null check (length(trim(name)) between 2 and 160),
  registration_no text check (length(registration_no) <= 60),     -- SSM no., optional
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (company_id, id)
);
create unique index legal_entities_company_name_uq on public.legal_entities (company_id, lower(name));
create unique index legal_entities_company_reg_uq  on public.legal_entities (company_id, registration_no)
  where registration_no is not null;

alter table public.outlets add column legal_entity_id uuid;
alter table public.outlets add constraint outlets_legal_entity_fk
  foreign key (company_id, legal_entity_id) references public.legal_entities (company_id, id);
create index outlets_legal_entity_idx on public.outlets (company_id, legal_entity_id);

-- RLS: everyone in the group may read entity names (like outlet names)
alter table public.legal_entities enable row level security;
create policy legal_entities_select on public.legal_entities for select to authenticated
  using (company_id = (select app.my_company_id()));
grant select on public.legal_entities to authenticated;

create trigger audit_legal_entities after insert or update or delete on public.legal_entities
  for each row execute function app.audit_row();
create trigger touch_legal_entities before update on public.legal_entities
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------- entity RPCs (Owner only)
create or replace function public.create_legal_entity(p_name text, p_registration_no text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me app.me_t; v_id uuid;
begin
  me := app.require_me();
  if me.role <> 'owner' then perform app.forbid('Only the Owner can register a company (Syarikat).'); end if;
  perform app.label('legal_entity.create');
  insert into public.legal_entities (company_id, name, registration_no)
  values (me.company_id, trim(p_name), nullif(trim(p_registration_no), ''))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.update_legal_entity(
  p_legal_entity_id uuid, p_name text, p_registration_no text, p_is_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare me app.me_t;
begin
  me := app.require_me();
  if me.role <> 'owner' then perform app.forbid('Only the Owner can edit a company (Syarikat).'); end if;
  perform app.label('legal_entity.update');
  update public.legal_entities
     set name = trim(p_name), registration_no = nullif(trim(p_registration_no), ''), is_active = p_is_active
   where id = p_legal_entity_id and company_id = me.company_id;
  if not found then perform app.fail('not_found', 'Company (Syarikat) not found.'); end if;
end $$;

-- ---------------------------------------------------------------- outlet RPCs gain legal_entity_id
drop function public.create_outlet(text, text, text);
drop function public.update_outlet(uuid, text, text, text, boolean);

create or replace function app.check_legal_entity(p_company_id uuid, p_legal_entity_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_legal_entity_id is not null and not exists
     (select 1 from public.legal_entities where id = p_legal_entity_id and company_id = p_company_id and is_active) then
    perform app.fail('not_found', 'Active company (Syarikat) not found.');
  end if;
end $$;

create or replace function public.create_outlet(
  p_name text, p_legal_entity_id uuid default null, p_code text default null, p_address text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me app.me_t; v_id uuid;
begin
  me := app.require_me();
  if me.role not in ('owner', 'admin') then perform app.forbid('Only Owner/Admin can create outlets.'); end if;
  perform app.check_legal_entity(me.company_id, p_legal_entity_id);
  perform app.label('outlet.create');
  insert into public.outlets (company_id, legal_entity_id, name, code, address)
  values (me.company_id, p_legal_entity_id, trim(p_name), upper(nullif(trim(p_code), '')), nullif(trim(p_address), ''))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.update_outlet(
  p_outlet_id uuid, p_name text, p_legal_entity_id uuid, p_code text, p_address text, p_is_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare me app.me_t;
begin
  me := app.require_me();
  if me.role not in ('owner', 'admin') then perform app.forbid('Only Owner/Admin can edit outlets.'); end if;
  perform app.check_legal_entity(me.company_id, p_legal_entity_id);
  perform app.label('outlet.update');
  update public.outlets
     set name = trim(p_name), legal_entity_id = p_legal_entity_id, code = upper(nullif(trim(p_code), '')),
         address = nullif(trim(p_address), ''), is_active = p_is_active
   where id = p_outlet_id and company_id = me.company_id;
  if not found then perform app.fail('not_found', 'Outlet not found.'); end if;
end $$;

-- ---------------------------------------------------------------- dashboard adds staff per Syarikat
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
        join (select o.legal_entity_id, count(*) n from public.employees e
              join public.outlets o on o.id = e.outlet_id
              where e.status = 'active' group by o.legal_entity_id) c
          on c.legal_entity_id = le.id), '[]'::jsonb),
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

revoke execute on all functions in schema public from public;
revoke execute on all functions in schema app    from public;
grant execute on function
  public.create_legal_entity(text, text),
  public.update_legal_entity(uuid, text, text, boolean),
  public.create_outlet(text, uuid, text, text),
  public.update_outlet(uuid, text, uuid, text, text, boolean),
  public.dashboard_summary()
to authenticated;
grant execute on function
  app.my_profile_id(), app.my_company_id(), app.my_role(), app.my_employee_id(),
  app.my_outlet_ids(), app.visible_employee_ids(), app.is_my_outlet(uuid)
to authenticated;

commit;

-- AdminFlow V1 — 001: core schema
-- Tables, enums, constraints and indexes. No data, no RLS (see 002).
-- Rules:
--   * Every operational row carries company_id.
--   * Composite FKs (company_id, id) make cross-company links impossible.
--   * No hard FK into neon_auth (managed by Neon); profiles.auth_user_id is unique.
--   * Nothing is ever hard-deleted except manager_outlets link rows.

begin;

-- Extensions live in their own schema so their functions are NOT exposed as Data API RPCs.
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;  -- leave overlap exclusion
create extension if not exists pgcrypto   with schema extensions;  -- invitation token hashing

create schema if not exists app;             -- private helpers, NOT exposed via Data API

-- ---------------------------------------------------------------- enums
create type public.app_role          as enum ('owner', 'admin', 'manager', 'staff');
create type public.employee_status   as enum ('active', 'inactive');
create type public.employment_type   as enum ('full_time', 'part_time', 'contract', 'intern');
create type public.leave_type        as enum ('annual', 'medical', 'emergency', 'unpaid', 'other');
create type public.leave_status      as enum ('pending', 'approved', 'rejected', 'cancelled');
create type public.task_status       as enum ('todo', 'in_progress', 'completed', 'verified', 'cancelled');
create type public.task_priority     as enum ('low', 'normal', 'high');
create type public.invitation_status as enum ('pending', 'accepted', 'revoked', 'expired');

-- ---------------------------------------------------------------- companies
create table public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 2 and 120),
  timezone    text not null default 'Asia/Kuala_Lumpur',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- outlets
create table public.outlets (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id),
  name        text not null check (length(trim(name)) between 2 and 120),
  code        text check (code ~ '^[A-Z0-9_-]{1,20}$'),
  address     text check (length(address) <= 500),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, id)
);
create unique index outlets_company_name_uq on public.outlets (company_id, lower(name));
create unique index outlets_company_code_uq on public.outlets (company_id, code) where code is not null;

-- ---------------------------------------------------------------- employees (ALL workers)
create table public.employees (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id),
  outlet_id        uuid,                                  -- null = HQ / not outlet-bound
  employee_no      text check (length(employee_no) between 1 and 30),
  full_name        text not null check (length(trim(full_name)) between 2 and 120),
  phone            text check (phone ~ '^\+?[0-9 -]{7,20}$'),
  email            text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  position         text check (length(position) <= 80),
  employment_type  public.employment_type not null default 'full_time',
  join_date        date,
  status           public.employee_status not null default 'active',
  deactivated_at   timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, outlet_id) references public.outlets (company_id, id),
  check ((status = 'inactive') = (deactivated_at is not null))
);
create index employees_company_outlet_idx on public.employees (company_id, outlet_id);
create index employees_company_status_idx on public.employees (company_id, status);
create unique index employees_company_no_uq    on public.employees (company_id, employee_no) where employee_no is not null;
create unique index employees_company_email_uq on public.employees (company_id, lower(email)) where email is not null;

-- ---------------------------------------------------------------- profiles (employees WITH login)
create table public.profiles (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id),
  employee_id     uuid not null unique,
  auth_user_id    uuid not null unique,                 -- = neon_auth.user.id = JWT sub
  role            public.app_role not null default 'staff',
  is_active       boolean not null default true,
  activated_at    timestamptz not null default now(),
  deactivated_at  timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, employee_id) references public.employees (company_id, id),
  check (is_active = (deactivated_at is null))
);
create index profiles_company_role_idx on public.profiles (company_id, role) where is_active;

-- ---------------------------------------------------------------- manager_outlets
create table public.manager_outlets (
  company_id              uuid not null,
  profile_id              uuid not null,
  outlet_id               uuid not null,
  assigned_by_profile_id  uuid,
  created_at              timestamptz not null default now(),
  primary key (profile_id, outlet_id),
  foreign key (company_id, profile_id) references public.profiles (company_id, id),
  foreign key (company_id, outlet_id)  references public.outlets (company_id, id),
  foreign key (company_id, assigned_by_profile_id) references public.profiles (company_id, id)
);
create index manager_outlets_outlet_idx on public.manager_outlets (company_id, outlet_id);

-- ---------------------------------------------------------------- account_invitations
create table public.account_invitations (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies (id),
  employee_id            uuid not null,
  email                  text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role                   public.app_role not null,
  token_hash             bytea not null unique,           -- sha256(token); plaintext never stored
  status                 public.invitation_status not null default 'pending',
  expires_at             timestamptz not null,
  invited_by_profile_id  uuid,                            -- null only for bootstrap
  accepted_at            timestamptz,
  accepted_auth_user_id  uuid,
  revoked_at             timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  foreign key (company_id, employee_id) references public.employees (company_id, id),
  foreign key (company_id, invited_by_profile_id) references public.profiles (company_id, id)
);
create unique index account_invitations_one_pending_uq
  on public.account_invitations (employee_id) where status = 'pending';
create index account_invitations_company_idx on public.account_invitations (company_id, status);

-- ---------------------------------------------------------------- leave_requests
create table public.leave_requests (
  id                       uuid primary key default gen_random_uuid(),
  company_id               uuid not null references public.companies (id),
  employee_id              uuid not null,
  leave_type               public.leave_type not null,
  start_date               date not null,
  end_date                 date not null,
  reason                   text check (length(reason) <= 1000),
  status                   public.leave_status not null default 'pending',
  submitted_by_profile_id  uuid not null,                 -- real actor (self or on behalf)
  reviewed_by_profile_id   uuid,
  reviewed_at              timestamptz,
  review_note              text check (length(review_note) <= 1000),
  auto_approved            boolean not null default false,
  cancelled_at             timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  foreign key (company_id, employee_id) references public.employees (company_id, id),
  foreign key (company_id, submitted_by_profile_id) references public.profiles (company_id, id),
  foreign key (company_id, reviewed_by_profile_id)  references public.profiles (company_id, id),
  check (end_date >= start_date),
  check (end_date - start_date <= 366),
  check ((status in ('approved', 'rejected')) = (reviewed_at is not null)),
  check (status <> 'rejected' or coalesce(length(trim(review_note)), 0) > 0),
  check ((status = 'cancelled') = (cancelled_at is not null)),
  constraint leave_no_overlap exclude using gist (
    employee_id with =,
    daterange(start_date, end_date, '[]') with &&
  ) where (status in ('pending', 'approved'))
);
create index leave_requests_company_status_idx on public.leave_requests (company_id, status);
create index leave_requests_employee_idx       on public.leave_requests (employee_id, start_date desc);

-- ---------------------------------------------------------------- tasks
create table public.tasks (
  id                       uuid primary key default gen_random_uuid(),
  company_id               uuid not null references public.companies (id),
  outlet_id                uuid,
  title                    text not null check (length(trim(title)) between 2 and 200),
  description              text check (length(description) <= 4000),
  assigned_employee_id     uuid not null,
  priority                 public.task_priority not null default 'normal',
  status                   public.task_status not null default 'todo',
  due_at                   timestamptz,
  created_by_profile_id    uuid not null,
  started_at               timestamptz,
  completed_at             timestamptz,
  completed_by_profile_id  uuid,
  verified_at              timestamptz,
  verified_by_profile_id   uuid,
  cancelled_at             timestamptz,
  cancelled_by_profile_id  uuid,
  cancel_reason            text check (length(cancel_reason) <= 1000),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  foreign key (company_id, outlet_id) references public.outlets (company_id, id),
  foreign key (company_id, assigned_employee_id) references public.employees (company_id, id),
  foreign key (company_id, created_by_profile_id)   references public.profiles (company_id, id),
  foreign key (company_id, completed_by_profile_id) references public.profiles (company_id, id),
  foreign key (company_id, verified_by_profile_id)  references public.profiles (company_id, id),
  foreign key (company_id, cancelled_by_profile_id) references public.profiles (company_id, id),
  check ((status = 'verified')  = (verified_at is not null)),
  check ((status = 'cancelled') = (cancelled_at is not null and length(trim(cancel_reason)) > 0)),
  check (status not in ('completed', 'verified') or completed_at is not null)
);
create index tasks_company_status_idx on public.tasks (company_id, status);
create index tasks_assignee_idx       on public.tasks (assigned_employee_id, status);
create index tasks_outlet_idx         on public.tasks (company_id, outlet_id);
create index tasks_open_due_idx       on public.tasks (company_id, due_at)
  where status in ('todo', 'in_progress');

-- ---------------------------------------------------------------- audit_logs
create table public.audit_logs (
  id                  bigint generated always as identity primary key,
  company_id          uuid references public.companies (id),
  actor_profile_id    uuid,                 -- null = system / database admin
  actor_auth_user_id  uuid,
  db_role             text not null default current_user,
  action              text not null,
  entity_type         text not null,
  entity_id           uuid,
  employee_id         uuid,                 -- affected employee, when applicable
  old_data            jsonb,
  new_data            jsonb,
  note                text,
  created_at          timestamptz not null default now()
);
create index audit_logs_company_time_idx on public.audit_logs (company_id, created_at desc);
create index audit_logs_entity_idx       on public.audit_logs (entity_type, entity_id);
create index audit_logs_employee_idx     on public.audit_logs (employee_id, created_at desc);

commit;

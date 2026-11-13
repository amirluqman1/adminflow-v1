-- AdminFlow V1 — 003: audit trail
-- Every INSERT/UPDATE/DELETE on business tables writes one audit_logs row automatically.
-- RPC functions may label the change with a semantic action/note via:
--   perform set_config('app.audit_action', 'leave.approve', true);
--   perform set_config('app.audit_note',   'reason text',   true);
-- audit_logs itself is append-only: UPDATE/DELETE/TRUNCATE are blocked for everyone.

begin;

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
begin
  -- never store secrets in the audit trail
  v_old := v_old - 'token_hash';
  v_new := v_new - 'token_hash';

  -- skip no-op updates (only updated_at changed)
  if tg_op = 'UPDATE' and (v_old - 'updated_at') = (v_new - 'updated_at') then
    return null;
  end if;

  v_emp := case tg_table_name
             when 'employees' then (v_row->>'id')::uuid
             when 'tasks'     then (v_row->>'assigned_employee_id')::uuid
             when 'manager_outlets' then
               (select p.employee_id from public.profiles p where p.id = (v_row->>'profile_id')::uuid)
             else (v_row->>'employee_id')::uuid
           end;
  v_entity := case when tg_table_name = 'manager_outlets'
                   then (v_row->>'profile_id')::uuid
                   else (v_row->>'id')::uuid end;

  insert into public.audit_logs
    (company_id, actor_profile_id, actor_auth_user_id, action, entity_type, entity_id,
     employee_id, old_data, new_data, note)
  values
    (coalesce((v_row->>'company_id')::uuid, case when tg_table_name = 'companies' then (v_row->>'id')::uuid end),
     app.my_profile_id(), auth.uid(),
     coalesce(v_action, tg_table_name || '.' || lower(tg_op)),
     tg_table_name, v_entity, v_emp, v_old, v_new, v_note);
  return null;
end $$;

create or replace function app.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function app.block_audit_changes() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '42501', message = 'audit_logs_are_append_only';
end $$;

do $$
declare t text;
begin
  foreach t in array array['companies', 'outlets', 'employees', 'profiles', 'manager_outlets',
                           'account_invitations', 'leave_requests', 'tasks']
  loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I
                    for each row execute function app.audit_row()', t);
  end loop;
  foreach t in array array['companies', 'outlets', 'employees', 'profiles',
                           'account_invitations', 'leave_requests', 'tasks']
  loop
    execute format('create trigger touch_%1$s before update on public.%1$I
                    for each row execute function app.touch_updated_at()', t);
  end loop;
end $$;

create trigger audit_logs_no_update before update or delete on public.audit_logs
  for each row execute function app.block_audit_changes();
create trigger audit_logs_no_truncate before truncate on public.audit_logs
  for each statement execute function app.block_audit_changes();

commit;

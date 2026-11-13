-- AdminFlow V1 — 006: one-step bootstrap of a Group with its Syarikat and outlets (DB admin only)
-- app.bootstrap_company (004) creates outlets without a Syarikat. bootstrap_group creates, in one
-- transaction: the Group, every Syarikat, every outlet linked to its Syarikat, the Owner employee
-- (HQ, no outlet) and a one-time Owner invitation. Never exposed to API users.
--
--   select app.bootstrap_group('Group Utama', 'Owner Full Name', 'owner@email', '[
--     {"name": "Syarikat A Sdn Bhd", "registration_no": "202301000001", "outlets": ["Outlet 1"]},
--     {"name": "Syarikat B",          "outlets": ["Outlet 2", "Outlet 3"]}
--   ]'::jsonb);

begin;

create or replace function app.bootstrap_group(
  p_group_name text, p_owner_full_name text, p_owner_email text, p_entities jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_res jsonb; v_company uuid; v_entity uuid; e jsonb; o text;
  v_entities int := 0; v_outlets int := 0;
begin
  if p_entities is null or jsonb_typeof(p_entities) <> 'array' or jsonb_array_length(p_entities) = 0 then
    perform app.fail('entities_required', 'At least one Syarikat is required.');
  end if;

  v_res := app.bootstrap_company(p_group_name, p_owner_full_name, p_owner_email, '{}');
  v_company := (v_res ->> 'company_id')::uuid;

  for e in select x from jsonb_array_elements(p_entities) as t(x) loop
    insert into public.legal_entities (company_id, name, registration_no)
    values (v_company, trim(e ->> 'name'), nullif(trim(e ->> 'registration_no'), ''))
    returning id into v_entity;
    v_entities := v_entities + 1;
    for o in select jsonb_array_elements_text(coalesce(e -> 'outlets', '[]'::jsonb)) loop
      insert into public.outlets (company_id, legal_entity_id, name) values (v_company, v_entity, trim(o));
      v_outlets := v_outlets + 1;
    end loop;
  end loop;

  return v_res || jsonb_build_object('legal_entities', v_entities, 'outlets', v_outlets);
end $$;

revoke execute on function app.bootstrap_group(text, text, text, jsonb) from public;

commit;

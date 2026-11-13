-- AdminFlow V1 — security test suite
-- Installs test.run_all(): plays every role through the real RPC functions with simulated JWT
-- claims + `SET ROLE authenticated`, asserts each rule, then ROLLS BACK all test data.
--
-- Prerequisites (development branch / local stub only — NEVER production):
--   neon_auth users with these emails, all emailVerified = true except unverified@example.com:
--   owner@, admin@, admin.b@, mgr.a@, mgr.b@, staff.a@, staff.b@, unverified@, stranger@, owner2@ (example.com)
-- Usage:  select * from test.run_all();

create schema if not exists test;
grant usage on schema test to authenticated;

-- run p_sql; compare outcome ('ok' or error message) with p_expected
create or replace function test.expect(p_name text, p_sql text, p_expected text default 'ok')
returns jsonb language plpgsql as $$
declare v_msg text;
begin
  begin
    execute p_sql;
    v_msg := 'ok';
  exception when others then
    v_msg := sqlerrm;
  end;
  return jsonb_build_object('name', p_name, 'ok', v_msg = p_expected,
    'info', case when v_msg = p_expected then null else 'expected ' || p_expected || ' got ' || v_msg end);
end $$;

create or replace function test.eq(p_name text, p_actual bigint, p_expected bigint)
returns jsonb language sql as $$
  select jsonb_build_object('name', p_name, 'ok', p_actual = p_expected,
    'info', case when p_actual = p_expected then null else format('expected %s got %s', p_expected, p_actual) end)
$$;

-- switch the simulated logged-in user (null = back to DB admin)
create or replace function test.login(p_uid uuid) returns void language plpgsql as $$
begin
  if p_uid is null then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', false);
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', p_uid, 'role', 'authenticated')::text, false);
    execute 'set role authenticated';
  end if;
end $$;

grant execute on function test.expect(text, text, text), test.eq(text, bigint, bigint), test.login(uuid) to authenticated;

create or replace function test.run_all()
returns table (n int, result text, name text, info text)
language plpgsql as $f$
declare
  r jsonb := '[]';
  u_owner uuid; u_admin uuid; u_admin_b uuid; u_mgr_a uuid; u_mgr_b uuid; u_staff_a uuid; u_staff_b uuid;
  u_unverif uuid; u_stranger uuid; u_owner2 uuid;
  tok_owner text; tok_owner2 text; tok_admin text; tok_admin_b text; tok_mgr_a text; tok_mgr_b text;
  tok_staff_a text; tok_staff_b text; tok_unverif text;
  outlet_a uuid; outlet_b uuid; ent_a uuid; ent_b uuid;
  emp_admin uuid; emp_admin_b uuid; emp_mgr_a uuid; emp_mgr_b uuid; emp_staff_a uuid; emp_staff_b uuid;
  emp_nologin uuid; emp_unverif uuid; emp_owner uuid;
  prof_owner uuid; prof_admin uuid; prof_admin_b uuid; prof_mgr_a uuid; prof_mgr_b uuid; prof_staff_a uuid; prof_staff_b uuid;
  leave_staff_a uuid; leave_mgr_a uuid; leave_admin uuid; leave_admin2 uuid; leave_owner uuid;
  task_a uuid; task_nologin uuid; task_self uuid;
  v_company uuid;
begin
  begin  -- everything below is rolled back at the end
    select id into u_owner    from neon_auth."user" where email = 'owner@example.com';
    select id into u_admin    from neon_auth."user" where email = 'admin@example.com';
    select id into u_admin_b  from neon_auth."user" where email = 'admin.b@example.com';
    select id into u_mgr_a    from neon_auth."user" where email = 'mgr.a@example.com';
    select id into u_mgr_b    from neon_auth."user" where email = 'mgr.b@example.com';
    select id into u_staff_a  from neon_auth."user" where email = 'staff.a@example.com';
    select id into u_staff_b  from neon_auth."user" where email = 'staff.b@example.com';
    select id into u_unverif  from neon_auth."user" where email = 'unverified@example.com';
    select id into u_stranger from neon_auth."user" where email = 'stranger@example.com';
    select id into u_owner2   from neon_auth."user" where email = 'owner2@example.com';

    -- bootstrap: our group with 3 Syarikat (1 outlet each) + another group
    tok_owner := app.bootstrap_company('Test Group', 'Test Owner', 'owner@example.com',
      '[{"name":"Syarikat A Sdn Bhd","registration_no":"202301000001","outlets":["Outlet Bangi"]},
        {"name":"Syarikat B Sdn Bhd","outlets":["Outlet Kajang"]},
        {"name":"Syarikat C Sdn Bhd","outlets":["Outlet Shah Alam"]}]') ->> 'owner_invitation_token';
    tok_owner2 := app.bootstrap_company('Other Group', 'Other Owner', 'owner2@example.com',
      '[{"name":"Other Co Sdn Bhd","outlets":["Other Outlet"]}]') ->> 'owner_invitation_token';
    select o.id, o.company_id, o.legal_entity_id into outlet_a, v_company, ent_a from public.outlets o where o.name = 'Outlet Bangi';
    select o.id, o.legal_entity_id into outlet_b, ent_b from public.outlets o where o.name = 'Outlet Kajang';

    -- ============================================================ 1. onboarding & invitations
    perform test.login(u_stranger);
    r := r || test.expect('stranger: bad token rejected', $$select public.accept_invitation('deadbeef')$$, 'invalid_invitation');
    r := r || test.expect('stranger: cannot use owner token (email mismatch)', format('select public.accept_invitation(%L)', tok_owner), 'forbidden');
    r := r || test.eq('stranger: sees no employees', (select count(*) from public.employees), 0);
    r := r || test.eq('stranger: sees no companies', (select count(*) from public.companies), 0);
    r := r || test.expect('stranger: cannot call write RPC', format($$select public.create_outlet('Hack Outlet', %L)$$, ent_a), 'not_authorized');

    perform test.login(u_owner);
    r := r || test.expect('owner: accepts bootstrap invitation', format('select public.accept_invitation(%L)', tok_owner));
    r := r || test.expect('owner: token cannot be reused', format('select public.accept_invitation(%L)', tok_owner), 'already_linked');
    perform test.login(u_owner2);
    r := r || test.expect('owner2: accepts own company invite', format('select public.accept_invitation(%L)', tok_owner2));

    perform test.login(u_owner);
    emp_admin   := public.create_employee('Admin A', null, 'HR Admin', 'full_time', null, null, 'admin@example.com', 'E002', ent_a);
    emp_admin_b := public.create_employee('Admin B', null, 'HR Admin', 'full_time', null, null, 'admin.b@example.com', 'E009', ent_b);
    emp_mgr_a   := public.create_employee('Manager A', outlet_a, 'Outlet Manager', 'full_time', null, null, 'mgr.a@example.com', 'E003');
    emp_mgr_b   := public.create_employee('Manager B', outlet_b, 'Outlet Manager', 'full_time', null, null, 'mgr.b@example.com', 'E004');
    emp_staff_a := public.create_employee('Staff A', outlet_a, 'Barista', 'full_time', null, null, 'staff.a@example.com', 'E005');
    emp_staff_b := public.create_employee('Staff B', outlet_b, 'Cashier', 'part_time', null, null, 'staff.b@example.com', 'E006');
    emp_nologin := public.create_employee('No Login A', outlet_a, 'Kitchen Helper', 'part_time', null, '012-3456789', null, 'E007');
    emp_unverif := public.create_employee('Unverified Guy', outlet_a, 'Cleaner', 'part_time', null, null, 'unverified@example.com', 'E008');
    r := r || test.expect('owner: outlet/Syarikat mismatch rejected', format($$select public.create_employee('Wrong Place', %L, null, 'full_time', null, null, null, null, %L)$$, outlet_a, ent_b), 'entity_mismatch');
    tok_admin   := public.create_invitation(emp_admin, 'admin') ->> 'token';
    tok_admin_b := public.create_invitation(emp_admin_b, 'admin') ->> 'token';
    tok_mgr_a   := public.create_invitation(emp_mgr_a, 'manager') ->> 'token';
    tok_mgr_b   := public.create_invitation(emp_mgr_b, 'manager') ->> 'token';
    tok_staff_a := public.create_invitation(emp_staff_a, 'staff') ->> 'token';
    tok_staff_b := public.create_invitation(emp_staff_b, 'staff') ->> 'token';
    tok_unverif := public.create_invitation(emp_unverif, 'staff') ->> 'token';
    r := r || test.expect('owner: invitation needs an email', format($$select public.create_invitation(%L, 'staff')$$, emp_nologin), 'email_required');

    perform test.login(u_staff_a);
    r := r || test.expect('staff: cannot use someone else''s token', format('select public.accept_invitation(%L)', tok_admin), 'forbidden');
    r := r || test.expect('staff: accepts own invitation', format('select public.accept_invitation(%L)', tok_staff_a));
    perform test.login(u_unverif);
    r := r || test.expect('unverified email cannot accept', format('select public.accept_invitation(%L)', tok_unverif), 'email_not_verified');
    perform test.login(u_admin);   prof_admin   := public.accept_invitation(tok_admin);
    perform test.login(u_admin_b); prof_admin_b := public.accept_invitation(tok_admin_b);
    perform test.login(u_mgr_a);   prof_mgr_a   := public.accept_invitation(tok_mgr_a);
    perform test.login(u_mgr_b);   prof_mgr_b   := public.accept_invitation(tok_mgr_b);
    perform test.login(u_staff_b); prof_staff_b := public.accept_invitation(tok_staff_b);
    perform test.login(null);
    select p.id, p.employee_id into prof_owner, emp_owner from public.profiles p where p.auth_user_id = u_owner;
    select p.id into prof_staff_a from public.profiles p where p.auth_user_id = u_staff_a;

    -- ============================================================ 2. Owner assigns Syarikat to Admins
    perform test.login(u_admin);
    r := r || test.expect('admin: cannot assign Syarikat to self', format('select public.assign_admin_entity(%L, %L)', prof_admin, ent_b), 'forbidden');
    r := r || test.eq('admin without Syarikat sees only self', (select count(*) from public.employees), 1);
    perform test.login(u_owner);
    r := r || test.expect('owner: assigns Syarikat A to Admin A', format('select public.assign_admin_entity(%L, %L)', prof_admin, ent_a));
    r := r || test.expect('owner: assigns Syarikat B to Admin B', format('select public.assign_admin_entity(%L, %L)', prof_admin_b, ent_b));
    r := r || test.expect('owner: cannot assign Syarikat to a manager', format('select public.assign_admin_entity(%L, %L)', prof_mgr_a, ent_a), 'not_an_admin');

    -- ============================================================ 3. roles & outlets
    perform test.login(u_admin);
    r := r || test.expect('admin: cannot invite as admin', format($$select public.create_invitation(%L, 'admin', 'x@example.com')$$, emp_nologin), 'forbidden');
    r := r || test.expect('admin: cannot make self owner', format($$select public.change_role(%L, 'owner')$$, prof_admin), 'forbidden');
    r := r || test.expect('admin: cannot promote staff to admin', format($$select public.change_role(%L, 'admin')$$, prof_staff_a), 'forbidden');
    r := r || test.expect('admin: cannot demote owner', format($$select public.change_role(%L, 'staff')$$, prof_owner), 'forbidden');
    r := r || test.expect('admin: cannot deactivate owner account', format('select public.set_account_active(%L, false)', prof_owner), 'forbidden');
    r := r || test.expect('admin: cannot deactivate owner employee', format('select public.set_employee_status(%L, false)', emp_owner), 'forbidden');
    r := r || test.expect('admin: cannot edit owner record', format($$select public.update_employee(%L,'Hacked Name',null,null,'full_time',null,null,null,null)$$, emp_owner), 'forbidden');
    r := r || test.expect('admin A: assigns outlet A to manager A', format('select public.assign_manager_outlet(%L, %L)', prof_mgr_a, outlet_a));
    r := r || test.expect('admin A: cannot assign outlet of Syarikat B', format('select public.assign_manager_outlet(%L, %L)', prof_mgr_b, outlet_b), 'forbidden');
    r := r || test.expect('admin A: cannot assign outlet to staff', format('select public.assign_manager_outlet(%L, %L)', prof_staff_a, outlet_a), 'not_a_manager');
    r := r || test.expect('admin A: cannot change role in Syarikat B', format($$select public.change_role(%L, 'manager')$$, prof_staff_b), 'forbidden');
    r := r || test.expect('admin A: cannot edit staff of Syarikat B', format($$select public.update_employee(%L,'X Y',%L,null,'full_time',null,null,null,null)$$, emp_staff_b, outlet_b), 'forbidden');
    r := r || test.expect('admin A: cannot place employee in Syarikat B', format($$select public.create_employee('New Guy', null, null, 'full_time', null, null, null, null, %L)$$, ent_b), 'forbidden');
    r := r || test.expect('admin A: cannot invite staff of Syarikat B', format($$select public.create_invitation(%L, 'staff', 'nb@example.com')$$, emp_staff_b), 'forbidden');
    r := r || test.expect('admin A: registers staff in own Syarikat', format($$select public.create_employee('New A', %L)$$, outlet_a));
    perform test.login(u_owner);
    r := r || test.expect('owner: assigns outlet B to manager B', format('select public.assign_manager_outlet(%L, %L)', prof_mgr_b, outlet_b));
    perform test.login(u_admin_b);
    r := r || test.expect('admin B: staff -> manager in own Syarikat', format($$select public.change_role(%L, 'manager')$$, prof_staff_b));
    r := r || test.expect('admin B: manager -> staff in own Syarikat', format($$select public.change_role(%L, 'staff')$$, prof_staff_b));

    perform test.login(u_mgr_a);
    r := r || test.expect('manager: cannot change roles', format($$select public.change_role(%L, 'manager')$$, prof_staff_a), 'forbidden');
    r := r || test.expect('manager: cannot give self more outlets', format('select public.assign_manager_outlet(%L, %L)', prof_mgr_a, outlet_b), 'forbidden');
    r := r || test.expect('manager: edits own-outlet staff', format($$select public.update_employee(%L,'Staff A Edited',%L,'Barista','full_time',null,null,'staff.a@example.com','E005')$$, emp_staff_a, outlet_a));
    r := r || test.expect('manager: cannot move staff to other outlet', format($$select public.update_employee(%L,'Staff A',%L,'Barista','full_time',null,null,'staff.a@example.com','E005')$$, emp_staff_a, outlet_b), 'forbidden');
    r := r || test.expect('manager: cannot edit other outlet staff', format($$select public.update_employee(%L,'X Y',%L,null,'full_time',null,null,null,null)$$, emp_staff_b, outlet_b), 'forbidden');

    perform test.login(u_owner);
    r := r || test.expect('owner: cannot change own role', format($$select public.change_role(%L, 'staff')$$, prof_owner), 'forbidden');
    r := r || test.expect('owner: cannot deactivate self', format('select public.set_account_active(%L, false)', prof_owner), 'forbidden');

    -- ============================================================ 3b. Syarikat & outlets
    perform test.login(u_admin);
    r := r || test.expect('admin: cannot register a Syarikat', $$select public.create_legal_entity('Admin Co Sdn Bhd')$$, 'forbidden');
    r := r || test.expect('admin A: adds 2nd outlet to own Syarikat', format($$select public.create_outlet('Outlet Bangi 2', %L, 'BG2')$$, ent_a));
    r := r || test.expect('admin A: cannot add outlet to Syarikat B', format($$select public.create_outlet('Sneaky Outlet', %L)$$, ent_b), 'forbidden');
    r := r || test.expect('admin A: cannot move outlet to Syarikat B', format($$select public.update_outlet(%L, 'Outlet Bangi', %L, null, null, true)$$, outlet_a, ent_b), 'forbidden');
    r := r || test.expect('admin A: cannot edit outlet of Syarikat B', format($$select public.update_outlet(%L, 'Renamed', %L, null, null, true)$$, outlet_b, ent_b), 'forbidden');
    perform test.login(u_owner);
    r := r || test.expect('owner: registers a new Syarikat', $$select public.create_legal_entity('Syarikat D Sdn Bhd', '202401000009')$$);
    perform test.login(u_mgr_a);
    r := r || test.expect('manager: cannot create outlet', format($$select public.create_outlet('Mgr Outlet', %L)$$, ent_a), 'forbidden');
    r := r || test.expect('manager: cannot edit Syarikat', format($$select public.update_legal_entity(%L, 'X Sdn Bhd', null, true)$$, ent_a), 'forbidden');
    perform test.login(u_owner2);
    r := r || test.expect('other group: cannot use our Syarikat', format($$select public.create_outlet('Sneaky', %L)$$, ent_a), 'not_found');
    r := r || test.eq('other group: cannot see our Syarikat', (select count(*) from public.legal_entities le where le.company_id = v_company), 0);

    -- ============================================================ 4. visibility (RLS)
    perform test.login(u_owner);
    r := r || test.eq('owner: sees all 10 employees', (select count(*) from public.employees), 10);
    r := r || test.eq('owner: sees all 4 outlets', (select count(*) from public.outlets), 4);
    r := r || test.eq('owner: sees all 4 Syarikat', (select count(*) from public.legal_entities), 4);
    r := r || test.eq('owner: sees only own group', (select count(*) from public.companies), 1);
    perform test.login(u_admin);
    r := r || test.eq('admin A: sees only Syarikat A employees (6)', (select count(*) from public.employees), 6);
    r := r || test.eq('admin A: cannot see Staff B', (select count(*) from public.employees e where e.id = emp_staff_b), 0);
    r := r || test.eq('admin A: cannot see group-level Owner record', (select count(*) from public.employees e where e.id = emp_owner), 0);
    r := r || test.eq('admin A: sees only own 2 outlets', (select count(*) from public.outlets), 2);
    r := r || test.eq('admin A: sees only own Syarikat', (select count(*) from public.legal_entities), 1);
    r := r || test.eq('admin A: sees own Syarikat audit', (select least(count(*), 1) from public.audit_logs), 1);
    r := r || test.eq('admin A: no audit from Syarikat B', (select count(*) from public.audit_logs a where a.legal_entity_id = ent_b), 0);
    r := r || test.eq('admin A: no group-level audit', (select count(*) from public.audit_logs a where a.legal_entity_id is null), 0);
    r := r || test.eq('admin A: sees only own Syarikat invitations', (select count(*) from public.account_invitations i where i.employee_id = emp_staff_b), 0);
    perform test.login(u_admin_b);
    r := r || test.eq('admin B: sees only Syarikat B employees (3)', (select count(*) from public.employees), 3);
    perform test.login(u_mgr_a);
    r := r || test.eq('manager A: sees outlet A employees + self (5)', (select count(*) from public.employees), 5);
    r := r || test.eq('manager A: cannot see Staff B', (select count(*) from public.employees e where e.id = emp_staff_b), 0);
    r := r || test.eq('manager A: no audit access', (select count(*) from public.audit_logs), 0);
    r := r || test.eq('manager A: no invitation access', (select count(*) from public.account_invitations), 0);
    perform test.login(u_staff_a);
    r := r || test.eq('staff A: sees only self', (select count(*) from public.employees), 1);
    r := r || test.eq('staff A: sees only own profile', (select count(*) from public.profiles), 1);
    r := r || test.eq('staff A: sees only own outlet', (select count(*) from public.outlets), 1);
    r := r || test.eq('staff A: sees only own Syarikat', (select count(*) from public.legal_entities), 1);
    perform test.login(u_owner2);
    r := r || test.eq('other group: sees only own 1 employee', (select count(*) from public.employees), 1);
    r := r || test.eq('other group: none of our audit', (select count(*) from public.audit_logs a where a.company_id = v_company), 0);
    r := r || test.expect('other group: cannot edit our employee', format($$select public.update_employee(%L,'X Y',null,null,'full_time',null,null,null,null)$$, emp_staff_a), 'not_found');
    r := r || test.expect('other group: cannot assign task to our staff', format($$select public.create_task('Steal', %L)$$, emp_staff_a), 'not_found');

    perform test.login(u_owner);
    r := r || test.expect('direct INSERT blocked', $$insert into public.outlets (company_id, name, legal_entity_id) select id, 'Direct', null from public.companies$$, 'permission denied for table outlets');
    r := r || test.expect('direct UPDATE blocked', $$update public.employees set full_name = 'Hacked'$$, 'permission denied for table employees');
    r := r || test.expect('direct DELETE on audit blocked', $$delete from public.audit_logs$$, 'permission denied for table audit_logs');
    r := r || test.expect('direct notification insert blocked', $$insert into public.notifications (company_id, recipient_profile_id, type, title) values (gen_random_uuid(), gen_random_uuid(), 'x', 'x')$$, 'permission denied for table notifications');
    r := r || test.expect('token_hash unreadable', $$select token_hash from public.account_invitations$$, 'permission denied for table account_invitations');
    r := r || test.expect('bootstrap not callable by users', $$select app.bootstrap_company('x','y','z@example.com')$$, 'permission denied for function bootstrap_company');

    -- ============================================================ 5. leave
    perform test.login(u_staff_a);
    leave_staff_a := public.submit_leave('annual', current_date + 10, current_date + 12, 'Family trip');
    r := r || test.expect('staff: overlapping leave rejected', $$select public.submit_leave('medical', current_date + 11, current_date + 11)$$, 'leave_overlap');
    r := r || test.expect('staff: cannot approve own leave', format('select public.review_leave(%L, true)', leave_staff_a), 'forbidden');
    r := r || test.expect('staff: cannot record leave for colleague', format($$select public.submit_leave('annual', current_date+1, current_date+1, null, %L)$$, emp_nologin), 'forbidden');
    r := r || test.expect('end before start rejected', $$select public.submit_leave('annual', current_date + 5, current_date + 4)$$,
         'new row for relation "leave_requests" violates check constraint "leave_requests_check"');
    perform test.login(u_owner2);
    r := r || test.expect('other group: cannot approve our leave', format('select public.review_leave(%L, true)', leave_staff_a), 'not_found');
    perform test.login(u_mgr_b);
    r := r || test.expect('manager B: cannot approve outlet A staff', format('select public.review_leave(%L, true)', leave_staff_a), 'forbidden');
    perform test.login(u_admin_b);
    r := r || test.expect('admin B: cannot approve Syarikat A staff', format('select public.review_leave(%L, true)', leave_staff_a), 'forbidden');
    perform test.login(u_mgr_a);
    r := r || test.expect('manager A: reject needs reason', format('select public.review_leave(%L, false)', leave_staff_a), 'reason_required');
    r := r || test.expect('manager A: approves outlet A staff', format($$select public.review_leave(%L, true, 'OK')$$, leave_staff_a));
    r := r || test.expect('manager A: records leave for no-login employee', format($$select public.submit_leave('medical', current_date, current_date, 'MC', %L)$$, emp_nologin));
    r := r || test.expect('manager A: cannot record leave for staff with login', format($$select public.submit_leave('annual', current_date+30, current_date+30, null, %L)$$, emp_staff_a), 'forbidden');
    leave_mgr_a := public.submit_leave('annual', current_date + 20, current_date + 21);
    r := r || test.expect('manager A: cannot approve own leave', format('select public.review_leave(%L, true)', leave_mgr_a), 'forbidden');
    perform test.login(u_mgr_b);
    r := r || test.expect('manager B: cannot approve another manager', format('select public.review_leave(%L, true)', leave_mgr_a), 'forbidden');
    perform test.login(u_admin_b);
    r := r || test.expect('admin B: cannot approve Syarikat A manager', format('select public.review_leave(%L, true)', leave_mgr_a), 'forbidden');
    perform test.login(u_admin);
    r := r || test.expect('admin A: approves own-Syarikat manager leave', format('select public.review_leave(%L, true)', leave_mgr_a));
    leave_admin := public.submit_leave('annual', current_date + 40, current_date + 41);
    perform test.login(u_admin_b);
    r := r || test.expect('admin B: cannot approve admin A leave', format('select public.review_leave(%L, true)', leave_admin), 'forbidden');
    perform test.login(u_mgr_a);
    r := r || test.expect('manager: cannot approve admin leave', format('select public.review_leave(%L, true)', leave_admin), 'forbidden');
    perform test.login(u_admin);
    r := r || test.expect('admin A: self-approves own leave', format('select public.review_leave(%L, true)', leave_admin));
    r := r || test.eq('admin self-approval is flagged', (select count(*) from public.leave_requests l where l.id = leave_admin and l.self_approved and l.status = 'approved'), 1);
    leave_admin2 := public.submit_leave('annual', current_date + 60, current_date + 60);
    r := r || test.expect('admin: cannot self-reject (cancel instead)', format($$select public.review_leave(%L, false, 'x')$$, leave_admin2), 'invalid_transition');
    perform test.login(u_owner);
    r := r || test.eq('owner notified: 2 admin leave submissions + 1 self-approval', (select count(*) from public.notifications), 3);
    r := r || test.expect('owner: rejects admin leave with reason', format($$select public.review_leave(%L, false, 'Peak season')$$, leave_admin2));
    leave_owner := public.submit_leave('annual', current_date + 50, current_date + 50);
    r := r || test.eq('sole owner leave auto-approved', (select count(*) from public.leave_requests l where l.id = leave_owner and l.status = 'approved' and l.auto_approved), 1);
    perform test.login(u_admin);
    r := r || test.eq('admin: cannot read owner notifications', (select count(*) from public.notifications), 0);
    r := r || test.expect('admin: owner leave not visible/reviewable', format('select public.review_leave(%L, true)', leave_owner), 'not_pending');
    perform test.login(u_staff_a);
    r := r || test.expect('staff: cannot cancel approved leave', format('select public.cancel_leave(%L)', leave_staff_a), 'not_pending');

    -- ============================================================ 6. tasks
    perform test.login(u_staff_a);
    r := r || test.expect('staff: cannot create tasks', format($$select public.create_task('Clean fridge', %L)$$, emp_staff_a), 'forbidden');
    perform test.login(u_admin_b);
    r := r || test.expect('admin B: cannot assign task to Syarikat A staff', format($$select public.create_task('Count stock', %L)$$, emp_staff_a), 'forbidden');
    perform test.login(u_admin);
    r := r || test.expect('admin A: assigns task in own Syarikat', format($$select public.create_task('Check stock', %L)$$, emp_staff_a));
    perform test.login(u_mgr_a);
    r := r || test.expect('manager A: cannot assign to outlet B staff', format($$select public.create_task('Count stock', %L)$$, emp_staff_b), 'forbidden');
    task_a       := public.create_task('Clean fridge', emp_staff_a, 'Deep clean', now() - interval '1 day', 'high');
    task_nologin := public.create_task('Wash trays', emp_nologin, null, now() + interval '1 day');
    r := r || test.expect('manager: cannot complete task of staff with login', format($$select public.set_task_status(%L, 'completed')$$, task_a), 'forbidden');
    r := r || test.expect('manager: updates task for no-login employee', format($$select public.set_task_status(%L, 'completed')$$, task_nologin));
    perform test.login(u_staff_b);
    r := r || test.eq('staff B: cannot see outlet A task', (select count(*) from public.tasks t where t.id = task_a), 0);
    r := r || test.expect('staff B: cannot update other''s task', format($$select public.set_task_status(%L, 'in_progress')$$, task_a), 'forbidden');
    perform test.login(u_admin_b);
    r := r || test.eq('admin B: cannot see Syarikat A task', (select count(*) from public.tasks t where t.id = task_a), 0);
    perform test.login(u_staff_a);
    r := r || test.eq('staff A: own task shows overdue', (select count(*) from public.task_overview t where t.id = task_a and t.is_overdue), 1);
    r := r || test.expect('staff: cannot edit task details', format($$select public.update_task(%L,'New title',null,null,'low',%L)$$, task_a, emp_staff_a), 'forbidden');
    r := r || test.expect('staff: starts own task', format($$select public.set_task_status(%L, 'in_progress')$$, task_a));
    r := r || test.expect('staff: in_progress -> verified invalid', format($$select public.set_task_status(%L, 'verified')$$, task_a), 'invalid_transition');
    r := r || test.expect('staff: completes own task', format($$select public.set_task_status(%L, 'completed')$$, task_a));
    r := r || test.expect('staff: cannot verify own task', format($$select public.set_task_status(%L, 'verified')$$, task_a), 'forbidden');
    r := r || test.expect('staff: cannot cancel task', format($$select public.set_task_status(%L, 'cancelled', 'no')$$, task_a), 'forbidden');
    perform test.login(u_mgr_a);
    r := r || test.expect('manager: send back needs reason', format($$select public.set_task_status(%L, 'in_progress')$$, task_a), 'reason_required');
    r := r || test.expect('manager: verifies completed task', format($$select public.set_task_status(%L, 'verified')$$, task_a));
    r := r || test.expect('verified task is final', format($$select public.set_task_status(%L, 'in_progress', 'redo')$$, task_a), 'invalid_transition');
    task_self := public.create_task('Self task', emp_mgr_a);
    r := r || test.expect('manager: completes own task', format($$select public.set_task_status(%L, 'completed')$$, task_self));
    r := r || test.expect('manager: cannot verify own task', format($$select public.set_task_status(%L, 'verified')$$, task_self), 'forbidden');
    r := r || test.expect('cancel needs reason', format($$select public.set_task_status(%L, 'cancelled')$$, task_self), 'reason_required');

    -- ============================================================ 7. audit, notifications & dashboard
    perform test.login(u_owner);
    r := r || test.eq('audit: leave approval has real actor', (select count(*) from public.audit_logs a where a.action = 'leave.approve' and a.actor_profile_id = prof_mgr_a), 1);
    r := r || test.eq('audit: on-behalf leave records manager', (select count(*) from public.audit_logs a where a.action = 'leave.submit_on_behalf' and a.actor_profile_id = prof_mgr_a and a.employee_id = emp_nologin), 1);
    r := r || test.eq('audit: admin self-approval recorded', (select count(*) from public.audit_logs a where a.action = 'leave.self_approve' and a.actor_profile_id = prof_admin), 1);
    r := r || test.eq('audit: role changes recorded', (select count(*) from public.audit_logs a where a.action = 'account.role_change'), 2);
    r := r || test.eq('audit: Syarikat assignment recorded', (select count(*) from public.audit_logs a where a.action = 'admin_entity.assign'), 2);
    r := r || test.eq('audit: Syarikat creation recorded', (select count(*) from public.audit_logs a where a.action = 'legal_entity.create'), 1);
    r := r || test.eq('audit: token hash never stored', (select count(*) from public.audit_logs a where a.new_data ? 'token_hash' or a.old_data ? 'token_hash'), 0);
    r := r || test.eq('dashboard: no overdue left', (select (public.dashboard_summary() ->> 'overdue_tasks')::bigint), 0);
    r := r || test.eq('dashboard: owner total staff', (select (public.dashboard_summary() ->> 'total_staff')::bigint), 10);
    r := r || test.eq('dashboard: Syarikat A has 6 staff', (select (x->>'count')::bigint from jsonb_array_elements(public.dashboard_summary()->'staff_by_entity') x where x->>'legal_entity_name' = 'Syarikat A Sdn Bhd'), 6);
    r := r || test.eq('dashboard: owner unread notifications', (select (public.dashboard_summary() ->> 'unread_notifications')::bigint), 3);
    perform public.mark_notification_read(null);
    r := r || test.eq('notifications: marked read', (select count(*) from public.notifications where read_at is null), 0);
    perform test.login(u_admin);
    r := r || test.eq('dashboard: admin A sees own Syarikat only', (select (public.dashboard_summary() ->> 'total_staff')::bigint), 6);
    perform test.login(u_staff_a);
    r := r || test.eq('dashboard: staff sees own scope only', (select (public.dashboard_summary() ->> 'total_staff')::bigint), 1);

    perform test.login(null);
    r := r || test.expect('db admin: audit UPDATE blocked', $$update public.audit_logs set note = 'x'$$, 'audit_logs_are_append_only');
    r := r || test.expect('db admin: audit DELETE blocked', $$delete from public.audit_logs$$, 'audit_logs_are_append_only');

    raise exception 'TEST_ROLLBACK';
  exception when others then
    if sqlerrm <> 'TEST_ROLLBACK' then
      r := r || jsonb_build_object('name', 'UNEXPECTED ERROR', 'ok', false, 'info', sqlerrm);
    end if;
  end;
  perform set_config('request.jwt.claims', '', false);

  return query
    select (x.ord)::int, case when (x.v->>'ok')::boolean then 'PASS' else 'FAIL' end, x.v->>'name', x.v->>'info'
    from jsonb_array_elements(r) with ordinality as x(v, ord);
end $f$;

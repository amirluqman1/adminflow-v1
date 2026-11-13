-- AdminFlow V1 — 007: re-issue the bootstrap Owner invitation (DB admin only)
--
-- Why: app.bootstrap_company() returns the Owner's invitation token ONCE. If that token is lost,
-- or expires (7 days) before the Owner signs up, nobody can log in to create a new one, because
-- create_invitation() needs a logged-in Owner/Admin. This helper closes that gap.
--
-- Safety:
--   * lives in schema `app` (not exposed by the Data API) and is NOT granted to `authenticated`;
--   * only works while the group has NO active Owner account (after that, the Owner uses
--     create_invitation() in the app, which is audited with a real actor);
--   * revokes any pending invitation of that employee first (one pending per employee);
--   * the plaintext token is returned once and never stored (SHA-256 hash only); audited as
--     invitation.reissue.

begin;

create or replace function app.reissue_owner_invitation(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_emp public.employees; v_email text; v_token text; v_exp timestamptz; v_id uuid;
begin
  if exists (select 1 from public.profiles
              where company_id = p_company_id and role = 'owner' and is_active) then
    perform app.fail('owner_exists', 'This group already has an active Owner. Use create_invitation in the app.');
  end if;

  -- the bootstrap Owner = employee of the most recent owner-role invitation, without an account
  select e.* into v_emp
    from public.account_invitations i
    join public.employees e on e.id = i.employee_id and e.company_id = i.company_id
   where i.company_id = p_company_id and i.role = 'owner'
     and not exists (select 1 from public.profiles p where p.employee_id = e.id)
   order by i.created_at desc
   limit 1;
  if v_emp.id is null then perform app.fail('not_found', 'No Owner invitation found for this group.'); end if;
  if v_emp.status <> 'active' then perform app.fail('employee_inactive', 'Owner employee is inactive.'); end if;
  v_email := lower(trim(v_emp.email));
  if v_email is null or v_email = '' then perform app.fail('email_required', 'Owner employee has no email.'); end if;

  perform app.label('invitation.revoke', 'Replaced by a re-issued Owner invitation');
  update public.account_invitations set status = 'revoked', revoked_at = now()
   where employee_id = v_emp.id and status = 'pending';

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_exp   := now() + interval '7 days';
  perform app.label('invitation.reissue', 'Owner invitation re-issued by DB admin');
  insert into public.account_invitations (company_id, employee_id, email, role, token_hash, expires_at)
  values (p_company_id, v_emp.id, v_email, 'owner', extensions.digest(v_token, 'sha256'), v_exp)
  returning id into v_id;

  return jsonb_build_object('invitation_id', v_id, 'owner_invitation_token', v_token,
                            'email', v_email, 'expires_at', v_exp);
end $$;

revoke execute on function app.reissue_owner_invitation(uuid) from public;

commit;

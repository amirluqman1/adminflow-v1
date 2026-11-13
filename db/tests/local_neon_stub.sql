-- Local-only stub that imitates what Neon provides (Data API roles, pg_session_jwt, neon_auth).
-- NEVER run this on Neon.
create role neondb_owner login;
create role authenticated nologin;
create role anonymous nologin;
grant authenticated, anonymous to neondb_owner;
create database neondb owner neondb_owner;
\c neondb
create schema auth;
create function auth.user_id() returns text language sql stable as
  $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub' $$;
create function auth.uid() returns uuid language sql stable as
  $$ select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
grant usage on schema auth to public;
create schema neon_auth;
create table neon_auth."user" (id uuid primary key, email text not null, "emailVerified" boolean not null default false, name text);
grant usage on schema neon_auth to neondb_owner;
grant select on neon_auth."user" to neondb_owner;
alter schema public owner to neondb_owner;

-- test auth users (what Neon Auth sign-up would create)
insert into neon_auth."user" (id, email, "emailVerified", name) values
 ('00000000-0000-0000-0000-0000000000a1', 'owner@example.com',  true,  'Test Owner'),
 ('00000000-0000-0000-0000-0000000000a2', 'admin@example.com',  true,  'Test Admin'),
 ('00000000-0000-0000-0000-0000000000a3', 'mgr.a@example.com',  true,  'Manager A'),
 ('00000000-0000-0000-0000-0000000000a4', 'mgr.b@example.com',  true,  'Manager B'),
 ('00000000-0000-0000-0000-0000000000a5', 'staff.a@example.com', true, 'Staff A'),
 ('00000000-0000-0000-0000-0000000000a6', 'staff.b@example.com', true, 'Staff B'),
 ('00000000-0000-0000-0000-0000000000a7', 'unverified@example.com', false, 'Unverified'),
 ('00000000-0000-0000-0000-0000000000a9', 'stranger@example.com', true, 'Stranger'),
 ('00000000-0000-0000-0000-0000000000b1', 'owner2@example.com', true, 'Other Co Owner');


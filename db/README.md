# Database

| File | Purpose |
|---|---|
| `migrations/001_schema.sql` | Enums, 9 tables, constraints, indexes |
| `migrations/002_auth_helpers_rls.sql` | Identity helpers (`app.my_*`), RLS policies, SELECT-only grants, `task_overview` view |
| `migrations/003_audit.sql` | Automatic audit triggers, append-only protection |
| `migrations/004_rpc.sql` | All write functions (the app's write API), dashboard, bootstrap |
| `migrations/005_legal_entities.sql` | Group → Syarikat → Outlet: `legal_entities` table, outlet link, Owner-only RPCs |
| `migrations/006_entity_scoped_admin.sql` | Admin limited to own Syarikat (`admin_entities`), employee Syarikat, Admin self-approval + Owner `notifications` |
| `migrations/007_reissue_owner_invitation.sql` | DB-admin-only `app.reissue_owner_invitation()` for a lost/expired bootstrap Owner token |
| `tests/security_tests.sql` | Installs `test.run_all()` — 155 security checks, auto-rollback |
| `tests/local_neon_stub.sql` | Imitates Neon roles/auth for a local Postgres. Never run on Neon |

Migrations 001–007 are applied to the Neon **development** branch (2026-11-13, 155/155 PASS).
Production is untouched.

## Run the tests

On Neon `development` (SQL Editor or MCP):

```sql
select * from test.run_all();          -- every row should be PASS; data is rolled back
```

The `development` branch needs these Neon Auth users (emailVerified = true except `unverified@`):
`owner@ admin@ admin.b@ mgr.a@ mgr.b@ staff.a@ staff.b@ unverified@ stranger@ owner2@` — all `@example.com`.

Locally (Postgres 16+ with btree_gist/pgcrypto):

```bash
psql -U postgres -f db/tests/local_neon_stub.sql
for f in db/migrations/00*.sql; do psql -U neondb_owner -d neondb -v ON_ERROR_STOP=1 -f "$f"; done
psql -U neondb_owner -d neondb -f db/tests/security_tests.sql
psql -U neondb_owner -d neondb -c "select * from test.run_all()"
```

## Create the real company (Phase 3, DB admin only)

```sql
select app.bootstrap_company('Group Utama', 'Owner Full Name', 'owner@email',
  '[{"name":"Syarikat A","registration_no":"...","outlets":["Outlet 1"]},
    {"name":"Syarikat B","outlets":["Outlet 2"]}]');
-- returns a one-time owner invitation token; the owner signs up with that email,
-- verifies it, and calls rpc('accept_invitation', { p_token })
```

If the Owner token is lost or expires before the Owner signs up (DB admin only, works only while the group
has no active Owner):

```sql
select app.reissue_owner_invitation((select id from public.companies where name = 'Group Utama'));
-- returns a new owner_invitation_token; the old one stops working
```
Tip: read the result as JSON text (`select app.reissue_owner_invitation(...)::text`) so the token is not
truncated by the tool. Never paste it into commits, issues or logs.

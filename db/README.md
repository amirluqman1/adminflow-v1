# Database

| File | Purpose |
|---|---|
| `migrations/001_schema.sql` | Enums, 9 tables, constraints, indexes |
| `migrations/002_auth_helpers_rls.sql` | Identity helpers (`app.my_*`), RLS policies, SELECT-only grants, `task_overview` view |
| `migrations/003_audit.sql` | Automatic audit triggers, append-only protection |
| `migrations/004_rpc.sql` | All write functions (the app's write API), dashboard, bootstrap |
| `tests/security_tests.sql` | Installs `test.run_all()` — 98 security checks, auto-rollback |
| `tests/local_neon_stub.sql` | Imitates Neon roles/auth for a local Postgres. Never run on Neon |

Migrations were applied to the Neon **development** branch on 2026-11-13. Production is untouched.

## Run the tests

On Neon `development` (SQL Editor or MCP):

```sql
select * from test.run_all();          -- every row should be PASS; data is rolled back
```

The `development` branch needs these Neon Auth users (emailVerified = true except `unverified@`):
`owner@ admin@ mgr.a@ mgr.b@ staff.a@ staff.b@ unverified@ stranger@ owner2@` — all `@example.com`.

Locally (Postgres 16+ with btree_gist/pgcrypto):

```bash
psql -U postgres -f db/tests/local_neon_stub.sql
for f in db/migrations/00*.sql; do psql -U neondb_owner -d neondb -v ON_ERROR_STOP=1 -f "$f"; done
psql -U neondb_owner -d neondb -f db/tests/security_tests.sql
psql -U neondb_owner -d neondb -c "select * from test.run_all()"
```

## Create the real company (Phase 3, DB admin only)

```sql
select app.bootstrap_company('Company Name Sdn Bhd', 'Owner Full Name', 'owner@email',
                             array['Outlet 1', 'Outlet 2', 'Outlet 3']);
-- returns a one-time owner invitation token; the owner signs up with that email,
-- verifies it, and calls rpc('accept_invitation', { p_token })
```

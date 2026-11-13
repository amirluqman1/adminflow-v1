# Database

| File | Purpose |
|---|---|
| `migrations/001_schema.sql` | Enums, 9 tables, constraints, indexes |
| `migrations/002_auth_helpers_rls.sql` | Identity helpers (`app.my_*`), RLS policies, SELECT-only grants, `task_overview` view |
| `migrations/003_audit.sql` | Automatic audit triggers, append-only protection |
| `migrations/004_rpc.sql` | All write functions (the app's write API), dashboard, bootstrap |
| `migrations/005_legal_entities.sql` | Group → Syarikat → Outlet: `legal_entities` table, outlet link, Owner-only RPCs |
| `migrations/006_bootstrap_group.sql` | `app.bootstrap_group(...)`: Group + Syarikat + linked outlets + Owner invite in one step (DB admin only) |
| `tests/security_tests.sql` | Installs `test.run_all()` — 116 security checks, auto-rollback |
| `tests/local_neon_stub.sql` | Imitates Neon roles/auth for a local Postgres. Never run on Neon |

Status on 2026-11-13 (checked directly on Neon):
- `development`: 001–004 applied. **005 and 006 are NOT applied yet** (`legal_entities` does not exist there).
- Local Postgres 16: 001–006 + tests = **116/116 PASS**.
- `production`: untouched.

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

## Create the real Group (Phase 3, DB admin only, on `development` first)

Apply 005 and 006, reinstall the tests, run them (all PASS), then:

```sql
select app.bootstrap_group('Group Utama', 'Muhammad Amir Luqman', '<owner email>', '[
  {"name": "Amir Food Industry Services", "outlets": ["Amir Food Industry Services"]},
  {"name": "Lubok Sarapan",               "outlets": ["Lubok Sarapan"]},
  {"name": "Restoran 3 Intan",            "outlets": ["Restoran 3 Intan"]}
]'::jsonb);
```
Syarikat names are temporary (1 Syarikat = 1 outlet, no SSM no.); the Owner corrects them in
the app (Syarikat & Outlet page). The call returns a one-time `owner_invitation_token`
(never commit it). The Owner opens `<app url>#/jemputan/<token>`, signs up with that email,
enters the 6-digit email code, and the invitation is accepted automatically.

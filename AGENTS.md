# AGENTS.md — rules for AI coding agents (Claude, Codex, others)

This repository is worked on by more than one AI agent. Read this file and `docs/` before changing anything.

## Project
AdminFlow V1: an admin system for one Malaysian F&B company (~20 staff, 3 outlets).
Roles: Owner, Admin, Manager, Staff. Some employees have no login.

## Stack (decided, do not change without owner approval)
- Neon Postgres 18, project `adminflow-v1`, AWS Singapore.
- Neon Managed Better Auth for login (JWT `sub` = `neon_auth.user.id`).
- Neon Data API (PostgREST-style) for reads (`from(...)`) and writes (`rpc(...)`).
- Frontend: plain HTML/CSS/JS (Vite allowed). No framework decision yet.
- Neon Functions only when the database cannot do the job (for example, sending email).

## Branches
- Neon branch `production`: **never** run migrations or tests here without the owner's explicit approval.
- Neon branch `development` (id `br-old-hat-b3z70ypx`): all development and testing happens here.
  Always call it "development" (never "dev") in code, docs and messages — owner preference.
- `production` is NOT protected (Free plan has no protected branches). Never delete, reset or
  restore it, and never copy a `development` connection string anywhere (see docs/database.md).
- Git: never push to `main` directly; use your own feature branch and a PR.

## Non-negotiable security rules
1. API users (`authenticated`) get **SELECT only** on tables. All writes go through
   `SECURITY DEFINER` functions in `db/migrations/004_rpc.sql`. Never grant INSERT/UPDATE/DELETE.
2. Every table has RLS enabled with a SELECT policy scoped by `app.my_company_id()`.
3. Identity comes only from `auth.uid()` (pg_session_jwt). Never trust a user id sent by the client.
4. Every new write function must: call `app.require_me()`, check role/outlet rules,
   call `app.label('<entity>.<action>', note)` before writing, and be granted to `authenticated` explicitly.
5. `audit_logs` is append-only. Do not add UPDATE/DELETE paths.
6. No hard deletes of business data. Use status fields.
7. New functions in `public` are callable via the Data API. Helpers go in schema `app`
   (not exposed). Extensions live in schema `extensions`.
8. Never commit secrets, connection strings or invitation tokens.
9. Do not use Supabase-only functions (`auth.jwt()` claims shapes, `auth.role()`, etc.).

## Business rules (approved by the owner)
- Structure: one Group (`companies`) → several Syarikat (`legal_entities`, Owner-only) → outlets.
- ONLY the Owner sees across Syarikat. An Admin sees/manages only the Syarikat the Owner assigned
  (`admin_entities`, Owner-only). Admins may create/edit outlets inside their own Syarikat.
- Role `manager` is shown in the UI as **"Admin Outlet"** (outlet-scoped). Keep the DB enum `manager`.
- Every outlet belongs to a Syarikat; every employee has a Syarikat (NULL = group level, Owner-only).
- Leave approval: Staff → Admin Outlet (own outlets) / Admin (own Syarikat) / Owner.
  Admin Outlet → Admin (own Syarikat) / Owner. Admin → Owner, OR the Admin self-approves
  (Owner exception: flagged `self_approved`, audited `leave.self_approve`, Owner notified).
  Owner → another Owner; a sole Owner's leave is auto-approved. Staff and Admin Outlets never
  approve their own leave. Rejection needs a reason.
- Roles ("Option C"): Staff ↔ Manager by Owner, or Admin inside own Syarikat. Anything involving Admin/Owner by Owner only.
  Nobody changes their own role. The last active Owner cannot be removed.
- Managers can cover several outlets; Owner (any) or Admin (own Syarikat) assigns them.
- Leave on behalf / task updates on behalf are allowed only for employees **without** an active login.
- Tasks: To Do → In Progress → Completed → Verified (or Cancelled with reason).
  The assignee cannot verify their own task.
- Leave types and balances: simple enum now; full balance tracking is a later phase.

## How to change the database
1. Add a new numbered file `db/migrations/00N_description.sql` (never edit applied migrations).
2. Run it locally and run `db/tests/security_tests.sql` (see `db/README.md`): all tests must PASS.
3. Apply to Neon `development`, then run `select * from test.run_all();` on `development`: all PASS.
4. Add tests for every new rule in `db/tests/security_tests.sql`.
5. Update `docs/database.md`.

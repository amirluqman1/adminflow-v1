# AdminFlow V1 — Master brief & roadmap

Source of truth for any new session or agent. Read with `AGENTS.md` (rules) and `docs/database.md` (DB).
Talk to the owner in **Bahasa Melayu Malaysia, santai but detailed**; never let something important
look unimportant. Explain before each phase and **get approval before starting it**.
Never make destructive changes without explicit authorization.

## 1. Product
Professional, mobile-first administration system for the owner's family F&B business in Malaysia:
~20 employees, 3 Syarikat, 1 outlet each today (structure supports many outlets per Syarikat).
Secure, maintainable, cost-efficient (Neon Free plan), beginner-friendly.
Do **not** modify BizProfit Pro or its Supabase database (separate product, same owner).

| Syarikat | SSM | Outlet |
|---|---|---|
| AMIR FOOD INDUSTRY SERVICES | UT0027949-W | Amir Food |
| Kedai Tiga Intan | 201503015155 (UT0008144-V) | Restoran 3 Intan |
| RA World Resources | 003705782-H | Lubok Sarapan |

Group name: left blank in the UI (internal name "Group Utama"). Owner: Muhammad Amir Luqman.

## 2. Roles (UI labels)
- **Owner** — everything, across all Syarikat; user roles, reports, audit history.
- **Admin** — only the Syarikat the Owner assigned: employees, leave, tasks, outlets, reports, audit of that Syarikat.
  Can approve own leave (Owner notified). Cannot promote anyone to Admin/Owner.
- **Admin Outlet** (DB role `manager`) — own outlets: staff, leave approvals, tasks. Never own leave.
- **Staff** — own profile, submit/track leave, update assigned tasks.
Optional login: `employees` = all workers; `profiles` = workers with login. Employees without login
still get leave records and tasks, updated on their behalf by authorised people. History is kept
when accounts are activated/deactivated. The real actor of every action is stored.

## 3. MVP features
- **Staff management**: add/edit/deactivate; search & filter by Syarikat, outlet, position, status,
  login access; profile & employment info; optional invitation & activation.
- **Leave**: submit; review by authorised roles; approve/reject with reasons; record on behalf of
  no-login staff; no unauthorised/self approvals (except Admin rule above); full history.
  Leave types simple enum now; leave balances = later phase.
- **Tasks**: create/assign (with or without login); To Do → In Progress → Completed → Verified /
  Cancelled; deadlines & overdue; verification by authorised person (never the assignee); history.
- **Dashboard & reports**: total staff, active accounts, staff per outlet & per Syarikat, pending
  leave, open & overdue tasks, notifications; role-specific.
- **Audit history**: employee changes, leave decisions, task updates, account activation, role and
  Syarikat/outlet assignments — actor, record, action, timestamp; append-only.

## 4. UI/UX
Modern corporate minimalist. Mobile-first, responsive desktop sidebar, mobile bottom navigation,
light mode, professional typography, clear status badges, search & filtering, proper loading /
empty / error states, minimal animation. UI language: Bahasa Melayu.

Colours: Navy `#142D39` · Teal `#137D70` · Background `#F5F7F9` · Border `#D9E2E8`.

Eight screens:
1. Login & Account (sign in, email verification, accept invitation)
2. Dashboard (role-specific)
3. Staff Directory
4. Staff Profile
5. Leave Management
6. Task Management
7. Activity History (audit)
8. Settings & Access (Syarikat, outlets, roles, Admin/Admin Outlet assignments, invitations)

## 5. Stack
Neon Postgres 18 (project `adminflow-v1`, AWS Singapore) · Neon Managed Better Auth · Neon Data API
(reads via `from()`, writes via `rpc()`) · Neon Functions only where the DB cannot do it (e.g. sending
invitation emails) · Frontend HTML/CSS/JS (Vite allowed) · Hosting: to be decided (static host such as
Cloudflare Pages / Netlify / Vercel). Neon branches: `production` (untouched; NOT protectable on Free
plan) and `development` (all work). Always say "development", never "dev".

## 6. Phases
| Phase | Scope | Status |
|---|---|---|
| 1 | Neon connection & architecture assessment | ✅ Done |
| 2 | Schema, relationships, RLS, audit (migrations 001–004) | ✅ Done on Neon `development` |
| 2+ | Group → Syarikat → Outlet (005), Admin scoped to Syarikat + Admin self-approval + notifications (006) | ✅ 149/149 tests locally · ⏳ apply & test on Neon `development` |
| 3 | Auth, invitations, roles — **approved by owner** | ⏳ Next |
| 4 | Employee management + Staff Directory / Profile UI | — |
| 5 | Leave & Task Management UI, Activity History | — |
| 6 | Security testing, UI refinement, deployment (production) | — |

### Phase 3 plan (approved)
1. Apply migrations 005–006 on `development`; create Neon Auth test user `admin.b@example.com`
   (emailVerified=true); reinstall `db/tests/security_tests.sql`; `select * from test.run_all()` → 149 PASS.
2. Run `db/seed/real_setup.sql` on `development` with the owner's email (given in chat; never commit
   the email or the returned token).
3. Harden Neon Auth on `development`: disable Google login, require email verification,
   set trusted origins, keep localhost only for development.
4. Login & Account screen: sign up → verify email → accept invitation (`rpc('accept_invitation')`).
5. Invitation link delivery (small Neon Function or manual link copy for MVP — ask owner).
6. Real HTTP test through the Data API (needs network access to the Neon auth/apirest hosts;
   request it through the environment tools if blocked).

### Later phases (not now)
Leave balances & configurable leave types, MC attachments, production protection (paid plan),
scheduled backups, Admin Outlet label review.

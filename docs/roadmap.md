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
| 2+ | Group → Syarikat → Outlet (005), Admin scoped to Syarikat + Admin self-approval + notifications (006), Owner invite re-issue (007) | ✅ Applied on Neon `development` · 155/155 tests PASS (local + `development`) |
| 3 | Auth, invitations, roles — **approved by owner** | 🟡 In progress (steps 1, 2, 4, 6 done · 3 & 5 waiting on owner) |
| 4 | Employee management + Staff Directory / Profile UI | — |
| 5 | Leave & Task Management UI, Activity History | — |
| 6 | Security testing, UI refinement, deployment (production) | — |

### Phase 3 plan (approved) — status 2026-11-13
1. ✅ Migrations 005–006 (+ new 007) applied on `development`; Neon Auth test user `admin.b@example.com`
   created (emailVerified=true); `db/tests/security_tests.sql` reinstalled; `test.run_all()` → **155/155 PASS**.
2. ✅ `db/seed/real_setup.sql` run on `development` with the owner's email (not committed): Group Utama,
   3 Syarikat, 3 outlets, Owner employee. The first token was lost (runner printed `[Object]`), so it was
   re-issued with the new `app.reissue_owner_invitation()` (migration 007). Pending, expires 2026-11-20.
   The token is handed to the owner privately, never committed.
3. ⏳ Harden Neon Auth on `development` — **blocked, needs owner OK**: the agent's tool permission refused
   changing Neon Auth settings. To do (Console → `development` → Auth, or let the agent do it after approval):
   remove Google login; turn on "require email verification" + "send verification email on sign-up";
   keep `allow_localhost` (development only); add the real app domain to trusted domains once hosting is chosen.
   Until then an **unverified** sign-up can still sign in (it sees no data, and `accept_invitation` still
   refuses unverified emails — tested).
4. ✅ Login & Account screen in `web/` (Vite + `@neondatabase/neon-js`, Bahasa Melayu, mobile-first):
   sign in, sign up, verify email (6-digit OTP), forgot password (OTP), accept invitation (link `/#invite=<token>`
   or pasted code), "not linked" screen, minimal role home. E2E tested in Chromium against `development`.
5. ⏳ Invitation link delivery — **owner to choose**: (a) manual: Owner/Admin copies the link from the app and
   sends it via WhatsApp (zero cost, works now), or (b) automatic email via a small Neon Function + email provider.
6. ✅ Real HTTP tests through Neon Auth + Data API: `web/scripts/http-smoke.mjs` 21/21 PASS (RLS, grants,
   RPC errors, hidden `app` schema, anonymous/forged JWT); plus a full positive flow (accept invitation,
   create employee, audit actor) in a separate test group.

### Data on `development` (test only)
- Group Utama (real structure, Owner invitation pending).
- "HTTP Test Co (development only)": throwaway group for HTTP/E2E tests — logins `http.test@`, `e2e.n2@`,
  `smoke.stranger@` (unlinked) at example.com; other example.com users are for `test.run_all()`.
  Fully isolated from Group Utama by RLS (tested). Never copy to production.

### Later phases (not now)
Leave balances & configurable leave types, MC attachments, production protection (paid plan),
scheduled backups, Admin Outlet label review.

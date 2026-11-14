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
| 3 | Auth, invitations, roles — **approved by owner** | ✅ Done on `development` (2026-11-14) |
| 4 | Employee management, Staff Directory / Profile, Settings & Access UI | ✅ Done on `development` (2026-11-14) |
| 5 | Leave & Task Management UI, Activity History, notifications | ✅ Done on `development` (2026-11-14) |
| 6 | Security testing, UI refinement, deployment (production) | ⏳ Next — explain scope and get owner approval first |

### Phase 3 plan (approved) — done 2026-11-14
1. ✅ Migrations 005–006 (+ new 007) applied on `development`; Neon Auth test user `admin.b@example.com`
   created (emailVerified=true); `db/tests/security_tests.sql` reinstalled; `test.run_all()` → **155/155 PASS**.
2. ✅ `db/seed/real_setup.sql` run on `development` with the owner's email (not committed): Group Utama,
   3 Syarikat, 3 outlets, Owner employee. The first token was lost (runner printed `[Object]`), so it was
   re-issued with the new `app.reissue_owner_invitation()` (migration 007). Pending, expires 2026-11-20.
   The token is handed to the owner privately, never committed.
3. ✅ Neon Auth hardened on `development` by the owner (Console → branch `development` → Settings → Auth):
   Google removed (`providers: []`), "Verify at Sign-up" ON with **verification code**, sign-up/sign-in with
   email ON, Allow Localhost ON (development only). Verified 2026-11-14: unverified sign-in → 403
   `EMAIL_NOT_VERIFIED`; Google sign-in → `PROVIDER_NOT_SUPPORTED`; the app sends unverified users to "Sahkan emel".
   Note: Google was also removed on `production` by mistake (Console defaults to the production branch).
   Harmless — production is unused and Google must be off there anyway. All other production Auth settings are
   still default. **Lesson: always check the branch picker in Neon Console before changing settings.**
   Trusted domains: add the real app domain when hosting is chosen (Phase 6).
4. ✅ Login & Account screen in `web/` (Vite + `@neondatabase/neon-js`, Bahasa Melayu, mobile-first):
   sign in, sign up, verify email (6-digit OTP), forgot password (OTP), accept invitation (link `/#invite=<token>`
   or pasted code), "not linked" screen, minimal role home. E2E tested in Chromium against `development`.
5. ✅ Invitation link delivery — **owner chose (a) manual**. Home screen of Owner/Admin has "Jemput staf":
   lists active employees without a login (RLS-scoped), choose role (Admin: Staff/Admin Outlet; Owner: all),
   "Buat pautan" → `rpc('create_invitation')` → link shown **once** with "Salin pautan" and "Hantar WhatsApp"
   (wa.me share text). Making a new link revokes the old one (confirm dialog). Employees without email are
   shown as not invitable. E2E tested: Owner makes an Admin Outlet link → invitee signs up → accepts → role
   "Admin Outlet", and does not see the invite panel. Adding employees in the UI comes in Phase 4.
6. ✅ Real HTTP tests through Neon Auth + Data API: `web/scripts/http-smoke.mjs` 21/21 PASS (RLS, grants,
   RPC errors, hidden `app` schema, anonymous/forged JWT); plus a full positive flow (accept invitation,
   create employee, audit actor) in a separate test group.

### Data on `development` (test only)
- Group Utama (real structure, Owner invitation pending).
- "HTTP Test Co (development only)": throwaway group for HTTP/E2E tests — logins `http.test@`, `e2e.n2@`,
  `smoke.stranger@` (unlinked) at example.com; other example.com users are for `test.run_all()`.
  Fully isolated from Group Utama by RLS (tested). Never copy to production.

### Phase 4 (approved, done 2026-11-14) — incl. Settings & Access (owner asked to include it)
UI only; no database change (all rules already in migrations 001–007).
- **App shell** (`web/src/app.js`): desktop sidebar (navy), mobile bottom navigation, hash router
  (`#/`, `#/staf`, `#/staf/baru`, `#/staf/<id>`, `#/staf/<id>/edit`, `#/profil`, `#/tetapan`).
  Menu per role: Owner/Admin → Utama, Staf, Profil saya, Tetapan · Admin Outlet → Utama, Staf, Profil saya ·
  Staff → Utama, Profil saya. Pages guard against late loads drawing over a newer page (`ctx.seq`).
- **Utama**: role-specific counters (dashboard_summary), staff per Syarikat / outlet, "Belum ada akaun" shortcut.
- **Direktori Staf**: search (name, no., email, phone, position) + filters Syarikat, outlet/HQ, position,
  status, login access (aktif / ditutup / jemputan menunggu / tiada login). RLS decides who is listed.
- **Tambah / Edit pekerja**: all employment fields, Syarikat → outlet cascade (Owner may choose group level),
  client validation for phone/email; database errors shown in BM (duplicates, wrong Syarikat, …).
- **Profil Staf**: info; account & access — invite link (role limited by caller), revoke, change role
  (with note), close/reopen login, Admin Outlet outlets (chips), Admin Syarikat (Owner only);
  deactivate (reason required: closes login + revokes invites) / reactivate. No self role/status controls.
- **Tetapan & Akses**: Syarikat (Owner add/edit/deactivate), outlets (Owner; Admin in own Syarikat; code
  auto-uppercase), overview of Admin ↔ Syarikat and Admin Outlet ↔ outlet, pending invitations with revoke.
- UI permissions live in `web/src/perm.js` and only hide buttons; the database still enforces every rule.
- Tested: browser E2E on `development` with Owner, Admin, Admin Outlet and Staff logins — 45/45 checks
  (scope isolation: Admin never sees Syarikat B or the group Owner; Admin Outlet sees own outlet only;
  Staff has no directory). Test data lives only in "HTTP Test Co (development only)" (`p4.*@example.com`).
- Note: rapid repeated sign-ins are rate-limited by Neon Auth (seen in scripts only; real users unaffected).

### Phase 5 (approved, done 2026-11-14)
UI only; no database change.
- **Cuti** (`#/cuti`): tabs "Perlu tindakan" (with count) / "Cuti saya" / "Semua" (search, status, type).
  Apply (type, dates, reason; end ≥ start), record on behalf of **no-login** staff, approve (note optional),
  reject (reason required, applicant sees it), cancel pending. Admin "Lulus sendiri" with warning (Owner notified,
  tagged). Overlap refused in BM. Buttons follow the approval matrix (`perm.js` mirrors `review_leave`).
- **Tugasan** (`#/tugasan`, `#/tugasan/<id>`): tabs "Tugasan saya" / "Perlu disahkan" / "Semua"; filters
  open / overdue / status / outlet; overdue first. Create/edit (assignee limited to scope, due date-time, priority).
  Flow To Do → Sedang dibuat → Selesai → Disahkan; send back (reason) and cancel (reason); assignee never verifies
  own task; managers update status on behalf of no-login staff only; timeline of who/when. Actions lock after
  success until the page refreshes (no double transitions).
- **Sejarah Aktiviti** (`#/aktiviti`, Owner/Admin): audit trail with BM action names, actor, target, note,
  field-by-field changes in BM; filters category / employee / date range; "Muat lagi" paging (50).
- **Utama**: personal + scope counters linking to Cuti/Tugasan; notifications list with "Tanda semua dibaca".
- **Profil Staf**: links to that person's leave, tasks and activity.
- Phone navigation: max 5 buttons; extra items under **"Lagi"** (Owner/Admin: Profil saya, Aktiviti, Tetapan).
- Tested on `development`: Phase 5 E2E 42/42 (all four roles, incl. on-behalf, send-back, self-approve +
  Owner notification, audit filters) and Phase 4 E2E re-run 45/45 (no regressions).
- Known limit (RLS by design): Staff do not see the *name* of who approved/rejected their leave (only date +
  note), because they cannot read other people's records. Can be added later with a small DB view if wanted.

### Hosting decision (owner, 2026-11-14)
- **Now (repo public): GitHub Pages**, free for public repos. URL `https://amirluqman1.github.io/adminflow-v1/`.
  Built by `.github/workflows/deploy-pages.yml` from `main` only, with `npm run build:pages` (`web/.env.pages`,
  sub-path `/adminflow-v1/`), pointing at Neon **`development`**. Owner sets Settings → Pages → Source:
  GitHub Actions, and adds `https://amirluqman1.github.io` to Neon Auth trusted domains on `development`.
- **When the repo goes private: Cloudflare Pages** (free, allowed for business use, unlimited bandwidth,
  500 builds/month — build `main` only), pointing at Neon **`production`** (Phase 6, owner approval).
  Vercel Hobby is not allowed for commercial use. GitHub Pages on a private repo needs a paid GitHub plan.
- Owner decided to keep the company details (Syarikat names, SSM numbers, owner name) in the public repo.

### Phase 6 plan (to propose to the owner)
Security review & automated tests in the repo (E2E scripts, HTTP smoke), UI polish, real-device check, choose
hosting, then **production**: apply 001–007, harden Auth (trusted domain, Allow Localhost off, own SMTP
optional), seed real company, owner sign-up. Production steps need explicit owner approval.

### Later phases (not now)
Leave balances & configurable leave types, MC attachments, production protection (paid plan),
scheduled backups, Admin Outlet label review.

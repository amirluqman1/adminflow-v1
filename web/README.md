# AdminFlow web app

Plain HTML/CSS/JS + Vite, using `@neondatabase/neon-js` (Neon Auth + Data API). UI in Bahasa Melayu.
Done: Login & Account (Phase 3); app shell, Utama, Direktori Staf, Profil Staf, Tetapan & Akses (Phase 4);
Cuti, Tugasan, Sejarah Aktiviti, notifications (Phase 5). All eight screens of the brief exist.

## Code map

| File | Purpose |
|---|---|
| `src/main.js` | Entry: login, sign-up, email code, forgot password, accept invitation, not-linked |
| `src/app.js` | Signed-in shell (sidebar / bottom nav) and hash router; `ctx.seq` stale-render guard |
| `src/store.js` | Loads "who am I" + Syarikat/outlets, and staff with accounts/invites/assignments (RLS-scoped) |
| `src/perm.js` | Which buttons to show per role (mirror of DB rules — the DB still enforces them) |
| `src/api.js` | Neon client, BM error messages, invite token capture |
| `src/ui.js` | Escaping, dates, modal dialog, toast, busy buttons |
| `src/invite.js` | One-time invite link with copy + WhatsApp |
| `src/pages/*.js` | dashboard, staff-list, staff-form, staff-profile, settings, leave, tasks, activity |

## Run locally (against Neon `development`)

```bash
cd web
npm install
cp .env.example .env.development.local   # fill in the development Auth + Data API URLs
npm run dev                               # http://localhost:5173
```

`.env*.local` is git-ignored. Only use `development` URLs here; production URLs belong only in the hosting
provider's settings (Phase 6).

## Builds

| Command | Base path | Backend |
|---|---|---|
| `npm run dev` / `npm run build` | `/` | `.env.development.local` (git-ignored) |
| `npm run build:pages` | `/adminflow-v1/` | Neon `development`: URLs in `.github/workflows/deploy-pages.yml` (CI) or `.env.pages` locally (git-ignored) |

## Account flow

1. Owner/Admin opens **Jemput staf** on the home screen, picks a role and taps **Buat pautan**
   (`rpc('create_invitation')`), then sends `https://<app>/#invite=<token>` with **Salin pautan** or
   **Hantar WhatsApp**. The link is shown once; a new link revokes the old one. The token sits in the URL fragment, so it is never sent to a server;
   the app stores it in `localStorage` and removes it from the address bar.
2. The invitee signs up with the **invited email**, enters the 6-digit code from the verification email.
3. The app calls `rpc('accept_invitation', { p_token })`; the database checks the email matches and is verified.
4. Home shows the role (Owner / Admin / Admin Outlet / Staff) and a few counters.

A login without an invitation sees the "Akaun belum dipautkan" screen and no data (RLS).

## HTTP smoke test

Read-only checks through the real Auth + Data API with an **unlinked, verified** login:

```bash
SMOKE_EMAIL=... SMOKE_PASSWORD=... node --env-file=.env.development.local scripts/http-smoke.mjs
```

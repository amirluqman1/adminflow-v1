# AdminFlow web app

Plain HTML/CSS/JS + Vite, using `@neondatabase/neon-js` (Neon Auth + Data API). UI in Bahasa Melayu.
Phase 3 delivers the **Login & Account** screen; later phases add the other seven screens.

## Run locally (against Neon `development`)

```bash
cd web
npm install
cp .env.example .env.development.local   # fill in the development Auth + Data API URLs
npm run dev                               # http://localhost:5173
```

`.env*.local` is git-ignored. Only use `development` URLs here; production URLs belong only in the hosting
provider's settings (Phase 6).

## Account flow

1. Owner/Admin creates the employee and an invitation (`rpc('create_invitation')`), then shares
   `https://<app>/#invite=<token>`. The token sits in the URL fragment, so it is never sent to a server;
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

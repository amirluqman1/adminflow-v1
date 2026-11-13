# AdminFlow web (Phase 3)

Plain HTML/CSS/JS + Vite + `@neon/neon-js` (Neon Auth + Data API). Mobile-first, Bahasa Melayu UI.

| Page | Route | Who |
|---|---|---|
| Log masuk / Daftar / Sahkan email (OTP) / Lupa kata laluan | `#/masuk` `#/daftar` `#/sahkan` `#/lupa` | Everyone |
| Invitation link | `#/jemputan/<token>` | Invitee. Token stays in the URL fragment (never sent to a server), kept in `sessionStorage`, accepted automatically after sign-in + verified email |
| Utama (dashboard) | `#/` | Every linked account; numbers scoped by RLS |
| Akaun & Jemputan | `#/akaun` | Owner, Admin: add employee, invite / resend / revoke, change role, (de)activate login |
| Syarikat & Outlet | `#/struktur` | Owner (Syarikat + outlets), Admin (outlets) |

Rules: reads with `client.from()`, writes only with `client.rpc()`. The UI hides buttons that would be
refused, but the database checks every rule again. Error codes map to BM in `src/errors.js`.

```bash
cd web && npm install
cp .env.example .env.development   # fill in the development Auth + Data API URLs (Neon Console)
npm run dev                 # uses .env.development (Neon branch "development")
npm run build:development   # build against development
npm run build               # production build: needs .env.production (not committed) — fails loudly without it
```
`.env.*` files are git-ignored. They hold only the public Auth and Data API URLs, never a connection string.

Tested so far: build + browser smoke test (Playwright, phone size) with Neon mocked. Not yet tested
against live Neon (`development` endpoint was unreachable from the cloud session).

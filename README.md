# AdminFlow V1

Mobile-first staff, leave and task administration for a Malaysian F&B company (~20 staff, 3 outlets).

- Database & security design: [`docs/database.md`](docs/database.md)
- Rules for AI agents and contributors: [`AGENTS.md`](AGENTS.md)
- Migrations and tests: [`db/`](db/README.md)
- Web app (Phase 3): [`web/`](web/README.md)

## Progress

| Phase | Status |
|---|---|
| 1. Neon assessment | ✅ Done |
| 2. Schema, RLS, audit | ✅ 001–004 on Neon `development`. 005–006 pass locally (116/116), **not yet applied to `development`** |
| 3. Auth, invitations, roles (UI + Neon Auth hardening) | 🔄 UI built (`web/`), tested with mocked Neon. Pending: Neon Auth hardening, real-data bootstrap, live test |
| 4. Staff management UI | — |
| 5. Leave & task UI | — |
| 6. Security testing, polish, deployment | — |

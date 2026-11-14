# AdminFlow V1

Mobile-first staff, leave and task administration for a Malaysian F&B company (~20 staff, 3 outlets).

- **Brief, phases & what's next: [`docs/roadmap.md`](docs/roadmap.md)**
- Database & security design: [`docs/database.md`](docs/database.md)
- Rules for AI agents and contributors: [`AGENTS.md`](AGENTS.md)
- Migrations and tests: [`db/`](db/README.md)
- Web app (Login & Account): [`web/`](web/README.md)

## Progress

| Phase | Status |
|---|---|
| 1. Neon assessment | ✅ Done |
| 2. Schema, RLS, audit | ✅ Done on Neon `development` (155/155 security tests pass) |
| 3. Auth, invitations, roles (UI + Neon Auth hardening) | ✅ Done on `development` |
| 4. Staff management UI | ⏳ Next (needs owner approval) |
| 5. Leave & task UI | — |
| 6. Security testing, polish, deployment | — |

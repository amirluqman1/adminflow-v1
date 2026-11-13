# AdminFlow V1 — Database design (Phase 2)

Status: 001–004 applied on Neon `development`; 005–006 pass all 149 security tests locally and are
pending on Neon (connector outage). Production not touched.

## Architecture

```
Browser (HTML/CSS/JS + @neon/neon-js)
  │ sign in → Neon Managed Better Auth → JWT (sub = neon_auth.user.id, role = authenticated)
  ├── READ   client.from('employees').select(...)   → Data API → RLS filters rows
  └── WRITE  client.rpc('submit_leave', {...})      → SECURITY DEFINER function checks rules + audits
Postgres schemas:
  public      tables (SELECT only for API users) + RPC functions (exposed)
  app         private helpers (not exposed by the Data API)
  extensions  btree_gist, pgcrypto (not exposed)
  neon_auth   managed by Neon (users, sessions)
```

## Tables

| Table | Purpose | Key rules |
|---|---|---|
| `companies` | The family **Group** (one login scope) | Every row below has `company_id` |
| `legal_entities` | Each registered **Syarikat** (Sdn Bhd + SSM no.) | Owner-only create/edit; many outlets per Syarikat |
| `outlets` | Branches, each linked to a Syarikat (`legal_entity_id`) | Unique name/code per group |
| `employees` | All workers, with or without login | `outlet_id` null = HQ. Status active/inactive, never deleted |
| `profiles` | Login accounts (employee ↔ Neon Auth user) | 1 per employee, `auth_user_id` unique, holds `role` |
| `manager_outlets` | Which outlets a Manager ("Admin Outlet") covers | Owner, or Admin inside own Syarikat |
| `admin_entities` | Which Syarikat an Admin covers | Owner only |
| `notifications` | In-app notifications (e.g. Admin self-approved leave → Owner) | Recipient-only; written by functions |
| `account_invitations` | Invitation-only onboarding | Token stored as SHA-256 hash, 7-day expiry, one pending per employee |
| `leave_requests` | Leave | No overlapping pending/approved leave (exclusion constraint); reject needs reason |
| `tasks` | Tasks | Status flow enforced; overdue computed in `task_overview` |
| `audit_logs` | Audit trail | Written by triggers only; UPDATE/DELETE/TRUNCATE blocked |

Composite foreign keys `(company_id, id)` make cross-company links impossible at database level.

## Group → Syarikat → Outlet

```
companies (Group: the family business, one Owner login sees everything)
  └── legal_entities (Syarikat A Sdn Bhd, Syarikat B Sdn Bhd, ...)
        └── outlets (one or many per Syarikat) ── manager_outlets ── Managers
```
Reports can be grouped per outlet or per Syarikat (`dashboard_summary().staff_by_entity`).
Admins are restricted to the Syarikat the Owner assigns (`admin_entities`); only the Owner sees across Syarikat.

## Who can see what (RLS)

| | Owner | Admin | Admin Outlet (manager) | Staff |
|---|---|---|---|---|
| employees / profiles / leave | whole group | own Syarikat + self | own outlets + self | self |
| tasks | whole group | own Syarikat, created by self | own outlets, created by self | assigned to self |
| outlets / Syarikat | all | own Syarikat | own outlets | own outlet |
| audit_logs | all | own Syarikat only | ❌ | ❌ |
| account_invitations | all | own Syarikat | ❌ | ❌ |
| notifications | own | own | own | own |

A login with no active profile (not invited, or deactivated) sees nothing.

## Write API (RPC)

| Function | Who |
|---|---|
| `create_legal_entity`, `update_legal_entity`, `assign_admin_entity`, `remove_admin_entity` | Owner only |
| `create_outlet(p_name, p_legal_entity_id, p_code, p_address)`, `update_outlet` | Owner; Admin inside own Syarikat |
| `mark_notification_read(p_notification_id \| null=all)` | Everyone (own notifications) |
| `create_employee` | Owner, Admin |
| `update_employee` | Owner (all), Admin (not Owner), Manager (own-outlet staff only) |
| `set_employee_status` | Owner, Admin (not Owner/Admin targets); deactivation also disables login & revokes invites |
| `change_role` | Staff↔Manager: Owner/Admin. Involving Owner/Admin: Owner only. Never self. Last Owner protected |
| `set_account_active` | Owner, Admin (not Owner/Admin accounts). Never self. Last Owner protected |
| `assign_manager_outlet`, `remove_manager_outlet` | Owner, Admin |
| `create_invitation`, `revoke_invitation` | Owner, Admin (Owner/Admin invites: Owner only). Returns token once |
| `accept_invitation(p_token)` | Signed-in user with verified email matching the invitation |
| `submit_leave` | Self; on behalf of no-login employees by Owner/Admin/Manager (own outlet) |
| `review_leave(p_leave_id, p_approve, p_note)` | Approval matrix in `AGENTS.md`; only an Admin may approve own leave (Owner notified) |
| `cancel_leave` | Applicant (pending only); on behalf for no-login employees |
| `create_task`, `update_task` | Owner, Admin, Manager (own outlets) |
| `set_task_status` | Assignee: todo/in_progress/completed. Manager+: verify, send back (reason), cancel (reason). No self-verify |
| `dashboard_summary()` | Everyone; numbers automatically scoped by RLS |

Errors: SQLSTATE `42501` (HTTP 403) with message `not_authorized` / `forbidden`;
SQLSTATE `P0001` (HTTP 400) with codes `not_found`, `leave_overlap`, `reason_required`,
`invalid_transition`, `last_owner`, `email_not_verified`, `invalid_invitation`, `already_linked`,
`email_required`, `employee_inactive`, `not_pending`, `task_locked`, `not_a_manager`, `already_has_account`.
`detail` holds an English explanation; the UI shows a Bahasa Melayu message per code.

## Audit actions
`company.bootstrap, outlet.create/update, employee.create/update/deactivate/reactivate,
account.activate/deactivate/role_change, manager_outlet.assign/remove, invitation.create/revoke/accept,
leave.submit/submit_on_behalf/submit_auto_approved/approve/reject/cancel,
task.create/update/reassign/status_in_progress/status_todo/status_completed/verify/send_back/cancel`.
Each row stores the real actor (`actor_profile_id`, `actor_auth_user_id`), affected employee,
old/new data (invitation token hashes stripped) and timestamp.

## Known limits / later phases
- Neon Free plan cannot protect the `production` branch (limit reached). Be careful with production.
- Neon Auth still allows open sign-up and Google login; tightened in Phase 3. Unlinked users see nothing.
- Leave balances, leave type configuration, attachments (MC slips): later phase.
- Real HTTP tests through the Data API need network access to `*.neon.tech` from the dev machine (Phase 3).

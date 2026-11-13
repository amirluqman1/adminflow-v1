// HTTP smoke test through the real Neon Auth + Data API (read-only checks, writes nothing).
//
// Usage (from web/):
//   SMOKE_EMAIL=... SMOKE_PASSWORD=... node --env-file=.env.development.local scripts/http-smoke.mjs
// SMOKE_EMAIL must be a verified login that is NOT linked to any AdminFlow employee ("stranger").
// Never point this at production without the owner's approval.
const AUTH = process.env.VITE_NEON_AUTH_URL;
const API = process.env.VITE_NEON_DATA_API_URL;
const { SMOKE_EMAIL: email, SMOKE_PASSWORD: password } = process.env;
const ORIGIN = process.env.SMOKE_ORIGIN || 'http://localhost:5173';
if (!AUTH || !API || !email || !password) {
  console.error('Set VITE_NEON_AUTH_URL, VITE_NEON_DATA_API_URL, SMOKE_EMAIL, SMOKE_PASSWORD');
  process.exit(2);
}

let failed = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  → ' + info}`); if (!ok) failed++; };

// 1. sign in → session cookie → JWT
const signIn = await fetch(`${AUTH}/sign-in/email`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
  body: JSON.stringify({ email, password }),
});
check('auth: sign in', signIn.ok, signIn.status);
const cookie = (signIn.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
const tok = await fetch(`${AUTH}/token`, { headers: { Cookie: cookie, Origin: ORIGIN } }).then((r) => r.json()).catch(() => ({}));
check('auth: JWT issued', typeof tok.token === 'string' && tok.token.split('.').length === 3);
const H = { Authorization: `Bearer ${tok.token}`, 'Content-Type': 'application/json' };

const get = (path, headers = H) => fetch(`${API}/${path}`, { headers });
const rpc = (fn, body = {}) => fetch(`${API}/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(body) });

// 2. unlinked login sees nothing (RLS)
for (const t of ['companies', 'legal_entities', 'outlets', 'employees', 'profiles', 'leave_requests', 'tasks', 'audit_logs', 'account_invitations', 'notifications']) {
  const r = await get(`${t}?select=id&limit=1`);
  const rows = r.ok ? await r.json() : null;
  check(`rls: unlinked user sees no ${t}`, Array.isArray(rows) && rows.length === 0, `${r.status} ${JSON.stringify(rows)}`);
}

// 3. writes are blocked
let r = await fetch(`${API}/employees`, { method: 'POST', headers: H, body: JSON.stringify({ full_name: 'x' }) });
check('grants: direct INSERT denied (403)', r.status === 403, r.status);
r = await fetch(`${API}/audit_logs?id=not.is.null`, { method: 'DELETE', headers: H });
check('grants: direct DELETE on audit_logs denied (403)', r.status === 403, r.status);
r = await rpc('create_employee', { p_full_name: 'x' });
check('rpc: write RPC refused for unlinked login (403 not_authorized)', r.status === 403 && (await r.json()).message === 'not_authorized', r.status);
r = await rpc('accept_invitation', { p_token: '00'.repeat(32) });
check('rpc: bogus invitation rejected (400 invalid_invitation)', r.status === 400 && (await r.json()).message === 'invalid_invitation', r.status);

// 4. private schemas / helpers are not exposed
r = await rpc('bootstrap_company', {});
check('api: app.bootstrap_company not exposed', r.status === 404, r.status);
r = await rpc('reissue_owner_invitation', {});
check('api: app.reissue_owner_invitation not exposed', r.status === 404, r.status);

// 5. no / forged token
r = await get('employees?select=id', { 'Content-Type': 'application/json' });
check('api: anonymous request rejected (401)', r.status === 401, r.status);
r = await get('employees?select=id', { Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4Iiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQifQ.abc' });
check('api: forged JWT rejected (401)', r.status === 401, r.status);

// 6. dashboard works and is empty
r = await rpc('dashboard_summary');
const d = r.ok ? await r.json() : {};
check('rpc: dashboard_summary → role null, 0 staff', r.ok && d.role === null && d.total_staff === 0, JSON.stringify(d));

console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
process.exit(failed ? 1 : 0);

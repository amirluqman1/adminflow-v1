// Hash router + signed-in state. Identity always comes from the Neon Auth session (JWT `sub`);
// the database decides what each role may see and do (RLS + SECURITY DEFINER RPCs).
import { auth, currentUser, select, rpc } from './neon.js';
import { $, esc, render, toast, ROLE_BM } from './ui.js';
import { bm } from './errors.js';
import { signIn, signUp, verify, forgot } from './pages/auth.js';
import { home } from './pages/home.js';
import { accounts } from './pages/accounts.js';
import { structure } from './pages/structure.js';

export const state = { user: null, profile: null, employee: null };
const INVITE_KEY = 'af_invite';

export async function loadMe() {
  state.user = await currentUser();
  state.profile = state.employee = null;
  if (!state.user) return;
  const [p] = await select('profiles', 'id,role,employee_id,is_active', q => q.eq('auth_user_id', state.user.id));
  if (p?.is_active) {
    state.profile = p;
    [state.employee] = await select('employees', 'id,full_name,outlet_id', q => q.eq('id', p.employee_id));
  }
}

export const go = path => { if (location.hash !== '#' + path) location.hash = path; else route(); };

const PUBLIC = { '/masuk': signIn, '/daftar': signUp, '/sahkan': verify, '/lupa': forgot };
const PRIVATE = { '/': home, '/akaun': accounts, '/struktur': structure };
const STAFF_ADMIN = new Set(['/akaun', '/struktur']);

function parse() {
  const [path, query = ''] = location.hash.slice(1).split('?');
  const parts = (path || '/').split('/').filter(Boolean);
  return { path: '/' + (parts[0] ?? ''), arg: parts[1], params: new URLSearchParams(query) };
}

async function acceptPendingInvite() {
  const token = sessionStorage.getItem(INVITE_KEY);
  if (!token || state.profile) return;
  try {
    await rpc('accept_invitation', { p_token: token });
    sessionStorage.removeItem(INVITE_KEY);
    await loadMe();
    toast('Jemputan diterima. Selamat datang!');
  } catch (e) {
    if (['invalid_invitation', 'already_linked'].includes(e.message)) sessionStorage.removeItem(INVITE_KEY);
    toast(bm(e), 'error');
  }
}

function nav() {
  const bar = $('#topbar');
  bar.hidden = !state.user;
  const role = state.profile?.role;
  const links = [['/', 'Utama']];
  if (role === 'owner' || role === 'admin') links.push(['/akaun', 'Akaun'], ['/struktur', 'Syarikat']);
  $('#nav').innerHTML = state.profile ? links.map(([h, t]) => `<a href="#${h}">${t}</a>`).join('') : '';
}

export async function route() {
  const { path, arg, params } = parse();
  if (path === '/jemputan' && arg) {           // token stays in the URL fragment, never sent to a server
    sessionStorage.setItem(INVITE_KEY, arg);
    history.replaceState(null, '', location.pathname + '#/');
  }
  try {
    if (PUBLIC[path]) { if (!state.user || path === '/sahkan') { nav(); return PUBLIC[path](params); } return go('/'); }
    if (!state.user) return go('/masuk');
    if (!state.user.emailVerified) return go('/sahkan?email=' + encodeURIComponent(state.user.email));
    await acceptPendingInvite();
    nav();
    if (!state.profile) return notLinked();
    if (STAFF_ADMIN.has(path) && !['owner', 'admin'].includes(state.profile.role)) return go('/');
    return (PRIVATE[path] ?? home)(params);
  } catch (e) {
    render(`<section class="card"><h1>Ralat</h1><p class="error">${esc(bm(e))}</p><a href="#/">Kembali</a></section>`);
  }
}

function notLinked() {
  const hasInvite = !!sessionStorage.getItem(INVITE_KEY);
  render(`<section class="card">
    <h1>Akaun belum dipautkan</h1>
    <p>Anda log masuk sebagai <b>${esc(state.user.email)}</b>, tetapi akaun ini belum dipautkan kepada mana-mana pekerja.</p>
    <p class="muted">AdminFlow hanya melalui jemputan. ${hasInvite ? 'Jemputan anda belum dapat diterima — pastikan email jemputan sama dengan email log masuk ini.' : 'Minta Owner atau Admin hantar pautan jemputan kepada email ini.'}</p>
  </section>`);
}

$('#signOut').addEventListener('click', async () => {
  await auth.signOut();
  Object.assign(state, { user: null, profile: null, employee: null });
  go('/masuk');
});

window.addEventListener('hashchange', route);
loadMe().catch(() => {}).finally(route);
export { ROLE_BM };

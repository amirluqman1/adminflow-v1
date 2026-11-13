// Single Neon client for the whole app: auth (Neon Managed Better Auth) + Data API.
// Reads: client.from(...). Writes: client.rpc(...) only (tables are SELECT-only for API users).
import { createClient } from '@neondatabase/neon-js';

const authUrl = import.meta.env.VITE_NEON_AUTH_URL;
const dataApiUrl = import.meta.env.VITE_NEON_DATA_API_URL;

export const configured = Boolean(authUrl && dataApiUrl);

export const client = configured
  ? createClient({ auth: { url: authUrl }, dataApi: { url: dataApiUrl } })
  : null;

export const ROLE_LABEL = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Admin Outlet', // DB role `manager` is shown as "Admin Outlet"
  staff: 'Staff',
};

// Database error codes (see docs/database.md) → Bahasa Melayu
const DB_MESSAGES = {
  not_authorized: 'Akaun anda belum dipautkan kepada AdminFlow atau sudah dinyahaktifkan.',
  forbidden: 'Anda tiada kebenaran untuk tindakan ini.',
  invalid_invitation: 'Pautan jemputan tidak sah, sudah digunakan, dibatalkan atau tamat tempoh. Minta jemputan baharu daripada Owner/Admin.',
  email_not_verified: 'Sila sahkan emel anda dahulu.',
  already_linked: 'Log masuk ini sudah dipautkan kepada akaun AdminFlow.',
  employee_inactive: 'Rekod pekerja ini tidak aktif. Hubungi Owner/Admin.',
  already_has_account: 'Pekerja ini sudah mempunyai akaun.',
  email_required: 'Alamat emel diperlukan.',
  not_found: 'Rekod tidak dijumpai.',
};

// Neon Auth error codes (neon-js normalises Better Auth errors to snake_case) → Bahasa Melayu
const AUTH_MESSAGES = {
  invalid_credentials: 'Emel atau kata laluan salah.',
  email_address_invalid: 'Format emel tidak sah.',
  user_already_exists: 'Emel ini sudah didaftarkan. Sila log masuk.',
  email_exists: 'Emel ini sudah didaftarkan. Sila log masuk.',
  email_not_confirmed: 'Emel belum disahkan. Kami hantar kod pengesahan ke emel anda.',
  weak_password: 'Kata laluan terlalu lemah atau pendek (sekurang-kurangnya 8 aksara).',
  over_request_rate_limit: 'Terlalu banyak cubaan. Tunggu sebentar dan cuba lagi.',
  over_email_send_rate_limit: 'Terlalu banyak emel dihantar. Tunggu beberapa minit dan cuba lagi.',
  user_not_found: 'Akaun dengan emel ini tidak dijumpai.',
  session_expired: 'Sesi tamat. Sila log masuk semula.',
  session_not_found: 'Sesi tamat. Sila log masuk semula.',
};

// OTP errors arrive as generic 400s; the server message tells them apart.
function otpMessage(error) {
  const m = String(error.message || '').toLowerCase();
  if (m.includes('expired')) return 'Kod sudah tamat tempoh. Tekan "Hantar semula kod".';
  if (m.includes('too many')) return 'Terlalu banyak cubaan salah. Tekan "Hantar semula kod".';
  if (m.includes('otp') || m.includes('invalid code')) return 'Kod tidak sah. Semak semula emel anda.';
  return '';
}

export function messageFor(error) {
  if (!error) return '';
  const code = error.code || '';
  if (DB_MESSAGES[error.message]) return DB_MESSAGES[error.message]; // Data API: message = our code
  const otp = otpMessage(error);
  if (otp) return otp;
  if (AUTH_MESSAGES[code]) return AUTH_MESSAGES[code];
  if (error.status === 429) return AUTH_MESSAGES.over_request_rate_limit;
  if (error instanceof TypeError || /fetch|network/i.test(error.message || '')) {
    return 'Tiada sambungan ke pelayan. Semak internet anda dan cuba lagi.';
  }
  return 'Ralat tidak dijangka. Cuba lagi; jika berterusan, hubungi Owner/Admin.';
}

// Every call returns { data, error } and never throws, so screens can show a message.
export async function call(fn) {
  try {
    const res = await fn();
    if (res && typeof res === 'object' && ('error' in res || 'data' in res)) {
      return { data: res.data ?? null, error: res.error ?? null };
    }
    return { data: res, error: null };
  } catch (e) {
    return { data: null, error: e };
  }
}

// ---------------------------------------------------------------- invitation token (from link)
// Invite links look like  https://<app>/#invite=<token>  — the fragment never reaches any server.
const INVITE_KEY = 'adminflow.invite';

export function captureInviteFromUrl() {
  const m = /(?:^#|&)invite=([0-9a-f]{64})(?:&|$)/i.exec(location.hash);
  if (m) {
    saveInvite(m[1].toLowerCase());
    history.replaceState(null, '', location.pathname + location.search); // remove token from the address bar
  }
}

export function saveInvite(token) {
  try { localStorage.setItem(INVITE_KEY, token); } catch { /* storage blocked: keep in memory */ }
  memoryInvite = token;
}
let memoryInvite = null;

export function getInvite() {
  try { return localStorage.getItem(INVITE_KEY) || memoryInvite; } catch { return memoryInvite; }
}

export function clearInvite() {
  memoryInvite = null;
  try { localStorage.removeItem(INVITE_KEY); } catch { /* ignore */ }
}

// AdminFlow — Login & Account (Phase 3)
// Screens: sign in · sign up · verify email (OTP) · forgot password · accept invitation · not linked · home
import {
  client, configured, call, messageFor, ROLE_LABEL,
  captureInviteFromUrl, getInvite, saveInvite, clearInvite,
} from './api.js';

const app = document.getElementById('app');
const state = { email: '', notice: '' };

// ---------------------------------------------------------------- tiny view helpers
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function render(html) {
  app.innerHTML = html;
  const first = app.querySelector('input:not([type=hidden])');
  if (first && !first.value) first.focus();
}

function alertBox(kind, text) {
  return text ? `<div class="alert ${kind}" role="${kind === 'error' ? 'alert' : 'status'}">${esc(text)}</div>` : '';
}

function takeNotice() {
  const n = state.notice; state.notice = ''; return alertBox('ok', n);
}

// Wire a form: disables the button while busy and shows the error inside the form.
function onSubmit(form, handler) {
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    const box = form.querySelector('.form-error');
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Sila tunggu…'; box.innerHTML = '';
    const err = await handler(Object.fromEntries(new FormData(form)));
    if (err && form.isConnected) {
      box.innerHTML = alertBox('error', err);
      btn.disabled = false; btn.textContent = label;
    }
  });
}

function on(id, fn) { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); }

// ---------------------------------------------------------------- routing
async function start() {
  if (!configured) {
    render(`<h1>Konfigurasi belum lengkap</h1>
      <p class="muted">Tetapkan VITE_NEON_AUTH_URL dan VITE_NEON_DATA_API_URL (lihat web/.env.example).</p>`);
    return;
  }
  captureInviteFromUrl();
  await route();
}

// Decide which screen to show from the current session + database link.
async function route() {
  render('<p class="muted">Memuatkan…</p>');
  const { data, error } = await call(() => client.auth.getSession());
  if (error) return showSignIn(messageFor(error));
  const user = data?.user;
  if (!user) return getInvite() ? showSignUp() : showSignIn();
  state.email = user.email;
  if (!user.emailVerified) return showVerify({ send: true });

  // Is this login linked to an AdminFlow account? (role is null when not linked)
  const summary = await call(() => client.rpc('dashboard_summary'));
  if (summary.error) return showError(messageFor(summary.error));
  if (summary.data?.role) { clearInvite(); return showHome(user, summary.data); }
  if (getInvite()) return showAccept(user);
  return showNotLinked(user);
}

// ---------------------------------------------------------------- screens
function inviteBanner() {
  return getInvite()
    ? '<div class="alert ok" role="status">Anda ada jemputan AdminFlow. Daftar atau log masuk dengan emel yang dijemput untuk menerimanya.</div>'
    : '';
}

function showSignIn(error = '') {
  render(`
    <h1>Log masuk</h1>
    <p class="muted">Masuk ke AdminFlow dengan emel dan kata laluan anda.</p>
    ${takeNotice()}${inviteBanner()}${alertBox('error', error)}
    <form id="f" novalidate>
      <label>Emel <input name="email" type="email" autocomplete="email" inputmode="email" required value="${esc(state.email)}"></label>
      <label>Kata laluan <input name="password" type="password" autocomplete="current-password" required></label>
      <div class="form-error"></div>
      <button class="primary" type="submit">Log masuk</button>
    </form>
    <div class="row">
      <button class="link" id="to-forgot" type="button">Lupa kata laluan?</button>
      <button class="link" id="to-signup" type="button">Daftar akaun baharu</button>
    </div>`);
  on('to-signup', () => showSignUp());
  on('to-forgot', () => showForgot());
  onSubmit(document.getElementById('f'), async ({ email, password }) => {
    state.email = email.trim().toLowerCase();
    if (!state.email || !password) return 'Isi emel dan kata laluan.';
    const { error } = await call(() => client.auth.signIn.email({ email: state.email, password }));
    if (error?.code === 'email_not_confirmed') return showVerify({ send: true });
    if (error) return messageFor(error);
    await route();
  });
}

function showSignUp(error = '') {
  render(`
    <h1>Daftar akaun</h1>
    <p class="muted">Gunakan emel yang sama dengan jemputan daripada Owner/Admin.
      Tanpa jemputan, akaun tidak boleh melihat apa-apa data.</p>
    ${inviteBanner()}${alertBox('error', error)}
    <form id="f" novalidate>
      <label>Nama penuh <input name="name" autocomplete="name" required></label>
      <label>Emel <input name="email" type="email" autocomplete="email" inputmode="email" required value="${esc(state.email)}"></label>
      <label>Kata laluan <span class="hint">Sekurang-kurangnya 8 aksara</span>
        <input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
      <label>Ulang kata laluan <input name="password2" type="password" autocomplete="new-password" required></label>
      <div class="form-error"></div>
      <button class="primary" type="submit">Daftar</button>
    </form>
    <div class="row"><span class="muted">Sudah ada akaun?</span>
      <button class="link" id="to-signin" type="button">Log masuk</button></div>`);
  on('to-signin', () => showSignIn());
  onSubmit(document.getElementById('f'), async ({ name, email, password, password2 }) => {
    state.email = email.trim().toLowerCase();
    if (!name.trim() || !state.email) return 'Isi nama dan emel.';
    if (password.length < 8) return AUTH_SHORT;
    if (password !== password2) return 'Kata laluan tidak sama.';
    const { data, error } = await call(() => client.auth.signUp.email({ name: name.trim(), email: state.email, password }));
    if (error) return messageFor(error);
    // Verification required → no session yet; otherwise continue (route sends the code if needed).
    if (!data?.token && data?.user && !data.user.emailVerified) return showVerify({ send: true });
    await route();
  });
}
const AUTH_SHORT = 'Kata laluan terlalu pendek (sekurang-kurangnya 8 aksara).';

async function sendCode(type = 'email-verification') {
  return call(() => client.auth.emailOtp.sendVerificationOtp({ email: state.email, type }));
}

async function showVerify({ send = false } = {}) {
  let notice = '';
  if (send) {
    const { error } = await sendCode();
    if (error) return renderVerify(messageFor(error), '');
    notice = `Kod 6 digit telah dihantar ke ${state.email}. Semak juga folder Spam.`;
  }
  renderVerify('', notice);
}

function renderVerify(error, notice) {
  render(`
    <h1>Sahkan emel</h1>
    <p class="muted">Masukkan kod pengesahan yang dihantar ke <b>${esc(state.email)}</b>.</p>
    ${alertBox('ok', notice)}${alertBox('error', error)}
    <form id="f" novalidate>
      <label>Kod pengesahan
        <input name="otp" class="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required></label>
      <div class="form-error"></div>
      <button class="primary" type="submit">Sahkan</button>
    </form>
    <div class="row">
      <button class="link" id="resend" type="button">Hantar semula kod</button>
      <button class="link" id="to-signin" type="button">Kembali ke log masuk</button>
    </div>`);
  on('to-signin', async () => { await call(() => client.auth.signOut()); showSignIn(); });
  on('resend', async (ev) => {
    const btn = ev.currentTarget; btn.disabled = true;
    const { error } = await sendCode();
    renderVerify(error ? messageFor(error) : '', error ? '' : 'Kod baharu telah dihantar.');
    // simple cooldown so people don't spam the mail sender
    const again = document.getElementById('resend');
    if (again) { again.disabled = true; setTimeout(() => { if (again.isConnected) again.disabled = false; }, 30000); }
  });
  onSubmit(document.getElementById('f'), async ({ otp }) => {
    if (!/^\d{6}$/.test(otp.trim())) return 'Masukkan 6 digit kod.';
    const { error } = await call(() => client.auth.emailOtp.verifyEmail({ email: state.email, otp: otp.trim() }));
    if (error) return messageFor(error);
    const s = await call(() => client.auth.getSession());
    if (!s.data?.user) { state.notice = 'Emel disahkan. Sila log masuk.'; return showSignIn(); }
    await route();
  });
}

function showForgot(error = '') {
  render(`
    <h1>Lupa kata laluan</h1>
    <p class="muted">Kami akan hantar kod 6 digit ke emel anda untuk menetapkan kata laluan baharu.</p>
    ${alertBox('error', error)}
    <form id="f" novalidate>
      <label>Emel <input name="email" type="email" autocomplete="email" inputmode="email" required value="${esc(state.email)}"></label>
      <div class="form-error"></div>
      <button class="primary" type="submit">Hantar kod</button>
    </form>
    <div class="row"><button class="link" id="to-signin" type="button">Kembali ke log masuk</button></div>`);
  on('to-signin', () => showSignIn());
  onSubmit(document.getElementById('f'), async ({ email }) => {
    state.email = email.trim().toLowerCase();
    if (!state.email) return 'Isi emel.';
    const { error } = await sendCode('forget-password');
    // Same message whether or not the email exists (no account enumeration).
    if (error && error.status !== 404) return messageFor(error);
    showReset();
  });
}

function showReset() {
  render(`
    <h1>Kata laluan baharu</h1>
    <p class="muted">Jika ${esc(state.email)} berdaftar, kod telah dihantar. Masukkan kod dan kata laluan baharu.</p>
    <form id="f" novalidate>
      <label>Kod <input name="otp" class="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></label>
      <label>Kata laluan baharu <span class="hint">Sekurang-kurangnya 8 aksara</span>
        <input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
      <div class="form-error"></div>
      <button class="primary" type="submit">Tetapkan kata laluan</button>
    </form>
    <div class="row"><button class="link" id="to-signin" type="button">Kembali ke log masuk</button></div>`);
  on('to-signin', () => showSignIn());
  onSubmit(document.getElementById('f'), async ({ otp, password }) => {
    if (!/^\d{6}$/.test(otp.trim())) return 'Masukkan 6 digit kod.';
    if (password.length < 8) return AUTH_SHORT;
    const { error } = await call(() => client.auth.emailOtp.resetPassword({ email: state.email, otp: otp.trim(), password }));
    if (error) return messageFor(error);
    state.notice = 'Kata laluan telah ditukar. Sila log masuk.';
    showSignIn();
  });
}

function whoBlock(user) {
  return `<div class="who"><b>${esc(user.name || user.email)}</b><span class="email">${esc(user.email)}</span></div>`;
}

function showAccept(user, error = '') {
  render(`
    <h1>Terima jemputan</h1>
    <p class="muted">Anda telah dijemput menyertai AdminFlow. Terima jemputan untuk memautkan log masuk ini kepada rekod pekerja anda.</p>
    ${whoBlock(user)}${alertBox('error', error)}
    <form id="f">
      <div class="form-error"></div>
      <button class="primary" type="submit">Terima jemputan</button>
    </form>
    <div class="stack">
      <button class="secondary" id="discard" type="button">Bukan saya / buang jemputan ini</button>
      <button class="link" id="signout" type="button">Log keluar</button>
    </div>`);
  on('signout', signOut);
  on('discard', () => { clearInvite(); route(); });
  onSubmit(document.getElementById('f'), async () => {
    const { error: e } = await call(() => client.rpc('accept_invitation', { p_token: getInvite() }));
    if (e) {
      if (e.message === 'invalid_invitation' || e.message === 'already_linked') clearInvite();
      if (e.message === 'email_not_verified') return showVerify({ send: true });
      if (e.message === 'forbidden') return 'Jemputan ini untuk emel lain. Log keluar dan log masuk dengan emel yang dijemput.';
      return messageFor(e);
    }
    clearInvite();
    state.notice = 'Jemputan diterima. Selamat datang ke AdminFlow!';
    await route();
  });
}

function showNotLinked(user) {
  render(`
    <h1>Akaun belum dipautkan</h1>
    ${whoBlock(user)}
    <p class="muted">Log masuk ini belum dipautkan kepada mana-mana pekerja. Minta pautan jemputan daripada Owner atau Admin,
      kemudian buka pautan itu pada peranti ini. Jika anda ada kod jemputan, tampal di bawah.</p>
    <form id="f" novalidate>
      <label>Kod jemputan <input name="token" autocomplete="off" spellcheck="false" placeholder="64 aksara"></label>
      <div class="form-error"></div>
      <button class="secondary" type="submit">Guna kod jemputan</button>
    </form>
    <div class="row"><button class="link" id="signout" type="button">Log keluar</button></div>`);
  on('signout', signOut);
  onSubmit(document.getElementById('f'), async ({ token }) => {
    const t = token.trim().replace(/^.*invite=/, '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(t)) return 'Kod jemputan tidak sah. Salin keseluruhan pautan atau kod.';
    saveInvite(t);
    showAccept(user);
  });
}

function showHome(user, s) {
  const role = ROLE_LABEL[s.role] || s.role;
  const stat = (n, label) => `<div class="stat"><b>${Number(n) || 0}</b><span>${esc(label)}</span></div>`;
  render(`
    ${takeNotice()}
    <h1>Selamat datang</h1>
    ${whoBlock(user)}
    <p><span class="badge">${esc(role)}</span></p>
    <div class="stats">
      ${stat(s.total_staff, 'Jumlah staf')}
      ${stat(s.active_accounts, 'Akaun aktif')}
      ${stat(s.pending_leave, 'Cuti menunggu')}
      ${stat(s.open_tasks, 'Tugasan terbuka')}
    </div>
    <p class="muted">Papan pemuka penuh, direktori staf, cuti dan tugasan akan datang dalam fasa seterusnya.</p>
    <div class="stack"><button class="secondary" id="signout" type="button">Log keluar</button></div>`);
  on('signout', signOut);
}

function showError(text) {
  render(`<h1>Ralat</h1>${alertBox('error', text)}
    <div class="stack"><button class="primary" id="retry" type="button">Cuba lagi</button>
    <button class="link" id="signout" type="button">Log keluar</button></div>`);
  on('retry', route);
  on('signout', signOut);
}

async function signOut() {
  await call(() => client.auth.signOut());
  state.notice = 'Anda telah log keluar.';
  showSignIn();
}

start();

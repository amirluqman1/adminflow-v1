// Sign in, sign up, email verification (OTP) and password reset — Neon Auth (Better Auth).
import { auth } from '../neon.js';
import { esc, render, onSubmit, toast, $ } from '../ui.js';
import { loadMe, go, state } from '../main.js';

// Better Auth calls resolve to { data, error } — turn error into a throw.
const must = async p => { const r = await p; if (r?.error) throw new Error(r.error.message || r.error.code || 'Ralat'); return r?.data ?? r; };
const sendOtp = email => must(auth.emailOtp.sendVerificationOtp({ email, type: 'email-verification' }));

export function signIn(params) {
  render(`<section class="card narrow">
    <h1>Log masuk</h1>
    <form id="f">
      <label>Email<input name="email" type="email" autocomplete="email" required value="${esc(params.get('email'))}"></label>
      <label>Kata laluan<input name="password" type="password" autocomplete="current-password" required minlength="8"></label>
      <p class="error"></p>
      <button type="submit">Log masuk</button>
    </form>
    <p class="row"><a href="#/daftar">Daftar (ada jemputan)</a><a href="#/lupa">Lupa kata laluan?</a></p>
  </section>`);
  onSubmit($('#f'), async ({ email, password }) => {
    const r = await auth.signIn.email({ email, password });
    if (r?.error) {
      if (r.error.status === 403 || /verif/i.test(r.error.message || '')) {   // email not verified yet
        await sendOtp(email).catch(() => {});
        return go('/sahkan?email=' + encodeURIComponent(email));
      }
      throw new Error(r.error.message);
    }
    await loadMe();
    go('/');
  });
}

export function signUp() {
  render(`<section class="card narrow">
    <h1>Daftar akaun</h1>
    <p class="muted">Guna <b>email yang sama</b> dengan email dalam jemputan anda.</p>
    <form id="f">
      <label>Nama penuh<input name="name" autocomplete="name" required minlength="2" maxlength="120"></label>
      <label>Email<input name="email" type="email" autocomplete="email" required></label>
      <label>Kata laluan<input name="password" type="password" autocomplete="new-password" required minlength="8"></label>
      <p class="error"></p>
      <button type="submit">Daftar</button>
    </form>
    <p class="row"><a href="#/masuk">Sudah ada akaun? Log masuk</a></p>
  </section>`);
  onSubmit($('#f'), async ({ name, email, password }) => {
    await must(auth.signUp.email({ name: name.trim(), email: email.trim().toLowerCase(), password }));
    await sendOtp(email.trim().toLowerCase()).catch(() => {});   // harmless if Neon already sent one
    go('/sahkan?email=' + encodeURIComponent(email.trim().toLowerCase()));
  });
}

export function verify(params) {
  const email = params.get('email') || '';
  render(`<section class="card narrow">
    <h1>Sahkan email</h1>
    <p>Kami telah hantar kod 6 digit ke <b>${esc(email)}</b>. Semak juga folder spam.</p>
    <form id="f">
      <label>Kod pengesahan<input name="otp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label>
      <p class="error"></p>
      <button type="submit">Sahkan</button>
    </form>
    <p class="row"><button type="button" class="link" id="resend">Hantar semula kod</button><a href="#/masuk">Log masuk</a></p>
  </section>`);
  onSubmit($('#f'), async ({ otp }) => {
    await must(auth.emailOtp.verifyEmail({ email, otp: otp.trim() }));
    await loadMe();
    toast('Email disahkan.');
    go(state.user ? '/' : '/masuk?email=' + encodeURIComponent(email));   // auto sign-in after verification
  });
  $('#resend').onclick = async () => {
    try { await sendOtp(email); toast('Kod baru dihantar.'); } catch (e) { toast('Gagal hantar kod. Cuba sebentar lagi.', 'error'); }
  };
}

export function forgot() {
  render(`<section class="card narrow">
    <h1>Lupa kata laluan</h1>
    <form id="f1">
      <label>Email<input name="email" type="email" autocomplete="email" required></label>
      <p class="error"></p>
      <button type="submit">Hantar kod</button>
    </form>
    <form id="f2" hidden>
      <label>Kod dari email<input name="otp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required></label>
      <label>Kata laluan baru<input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
      <p class="error"></p>
      <button type="submit">Tukar kata laluan</button>
    </form>
    <p class="row"><a href="#/masuk">Kembali ke log masuk</a></p>
  </section>`);
  let email = '';
  onSubmit($('#f1'), async d => {
    email = d.email.trim().toLowerCase();
    await must(auth.forgetPassword.emailOtp({ email }));
    $('#f1').hidden = true; $('#f2').hidden = false;
    toast('Jika email ini berdaftar, kod telah dihantar.');
  });
  onSubmit($('#f2'), async ({ otp, password }) => {
    await must(auth.emailOtp.resetPassword({ email, otp: otp.trim(), password }));
    toast('Kata laluan ditukar. Sila log masuk.');
    go('/masuk?email=' + encodeURIComponent(email));
  });
}

// Manual invitation delivery (Phase 3 step 5, option a): show the link once with copy + WhatsApp.
import { esc, fmtDate } from './ui.js';

export function inviteLink(token) {
  // origin + path, so it also works when the app lives under a sub-path (GitHub Pages: /adminflow-v1/)
  return `${location.origin}${location.pathname}#invite=${token}`;
}

// Renders the one-time link for an invitation returned by rpc('create_invitation').
export function showInviteLink(out, name, inv) {
  const link = inviteLink(inv.token);
  const text = `Assalamualaikum ${name}, anda dijemput ke AdminFlow. Buka pautan ini dan daftar dengan emel ${inv.email}:\n${link}\n(Sah sehingga ${fmtDate(inv.expires_at)}. Jangan kongsi pautan ini.)`;
  out.innerHTML = `
    <div class="alert ok" role="status">Pautan dibuat untuk <b>${esc(inv.email)}</b>, sah sehingga ${esc(fmtDate(inv.expires_at))}.
      Pautan ini hanya dipaparkan <b>sekali</b> — salin atau hantar sekarang.</div>
    <input class="link-box" readonly value="${esc(link)}" aria-label="Pautan jemputan">
    <div class="actions">
      <button class="primary copy" type="button">Salin pautan</button>
      <a class="btn secondary" target="_blank" rel="noopener noreferrer"
         href="https://wa.me/?text=${encodeURIComponent(text)}">Hantar WhatsApp</a>
    </div>`;
  const box = out.querySelector('.link-box');
  box.addEventListener('focus', () => box.select());
  const copyBtn = out.querySelector('.copy');
  copyBtn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(link); copyBtn.textContent = 'Disalin ✓'; }
    catch { box.focus(); box.select(); copyBtn.textContent = 'Tekan & tahan untuk salin'; }
  });
}

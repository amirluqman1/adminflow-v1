// "Jemput staf" — manual invitation delivery (Phase 3 step 5, option a).
// Owner/Admin creates an invitation link and sends it themselves (copy or WhatsApp).
// The database decides who may invite whom (create_invitation); this screen only shows the choices.
import { client, call, messageFor, ROLE_LABEL } from './api.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function inviteLink(token) {
  return `${location.origin}/#invite=${token}`;
}

function fmtDate(iso) {
  try { return new Date(iso).toLocaleDateString('ms-MY', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return iso; }
}

// Roles this user may offer. Owner: everything; Admin: Staff / Admin Outlet only.
function roleOptions(myRole) {
  const roles = myRole === 'owner' ? ['staff', 'manager', 'admin', 'owner'] : ['staff', 'manager'];
  return roles.map((r) => `<option value="${r}">${ROLE_LABEL[r]}</option>`).join('');
}

// Loads active employees without a login, plus their pending invitation (if any). RLS scopes the rows.
async function loadCandidates() {
  const [emps, profs, invs] = await Promise.all([
    call(() => client.from('employees').select('id, full_name, email, position, status').eq('status', 'active').order('full_name')),
    call(() => client.from('profiles').select('employee_id')),
    call(() => client.from('account_invitations').select('employee_id, role, expires_at').eq('status', 'pending')),
  ]);
  const error = emps.error || profs.error || invs.error;
  if (error) return { error };
  const linked = new Set((profs.data || []).map((p) => p.employee_id));
  const now = Date.now();
  const pending = new Map((invs.data || [])
    .filter((i) => new Date(i.expires_at).getTime() > now)
    .map((i) => [i.employee_id, i]));
  return { data: (emps.data || []).filter((e) => !linked.has(e.id)).map((e) => ({ ...e, pending: pending.get(e.id) })) };
}

export async function renderInvitePanel(container, myRole) {
  container.innerHTML = '<p class="muted">Memuatkan senarai pekerja…</p>';
  const { data, error } = await loadCandidates();
  if (error) { container.innerHTML = `<div class="alert error" role="alert">${esc(messageFor(error))}</div>`; return; }
  if (!data.length) {
    container.innerHTML = '<p class="muted">Semua pekerja aktif sudah ada akaun. Pekerja baharu boleh ditambah dalam fasa Direktori Staf.</p>';
    return;
  }
  container.innerHTML = `<ul class="invite-list">${data.map((e) => `
    <li class="invite-item" data-id="${e.id}">
      <div class="invite-who">
        <b>${esc(e.full_name)}</b>
        <span class="muted">${esc(e.position || '')}${e.position && e.email ? ' · ' : ''}${esc(e.email || '')}</span>
        ${e.pending ? `<span class="badge pending">Jemputan ${esc(ROLE_LABEL[e.pending.role])} menunggu · tamat ${esc(fmtDate(e.pending.expires_at))}</span>` : ''}
      </div>
      ${e.email ? `
        <div class="invite-actions">
          <select aria-label="Peranan untuk ${esc(e.full_name)}">${roleOptions(myRole)}</select>
          <button class="secondary make" type="button">${e.pending ? 'Buat pautan baharu' : 'Buat pautan'}</button>
        </div>
        <div class="invite-out"></div>`
      : '<p class="muted small">Tiada emel — tambah emel dahulu untuk menjemput. (Pekerja tanpa login masih boleh direkod cuti/tugasan.)</p>'}
    </li>`).join('')}</ul>`;

  container.querySelectorAll('.make').forEach((btn) => btn.addEventListener('click', async () => {
    const li = btn.closest('.invite-item');
    const out = li.querySelector('.invite-out');
    const role = li.querySelector('select').value;
    if (li.querySelector('.badge.pending') &&
        !confirm('Pautan lama akan dibatalkan dan tidak boleh digunakan lagi. Teruskan?')) return;
    btn.disabled = true; btn.textContent = 'Sila tunggu…'; out.innerHTML = '';
    const { data: inv, error: e } = await call(() => client.rpc('create_invitation', { p_employee_id: li.dataset.id, p_role: role }));
    btn.disabled = false; btn.textContent = 'Buat pautan baharu';
    if (e) { out.innerHTML = `<div class="alert error" role="alert">${esc(messageFor(e))}</div>`; return; }
    showLink(out, li.querySelector('b').textContent, inv);
  }));
}

function showLink(out, name, inv) {
  const link = inviteLink(inv.token);
  const text = `Assalamualaikum ${name}, anda dijemput ke AdminFlow. Buka pautan ini dan daftar dengan emel ${inv.email}:\n${link}\n(Sah sehingga ${fmtDate(inv.expires_at)}. Jangan kongsi pautan ini.)`;
  out.innerHTML = `
    <div class="alert ok" role="status">Pautan dibuat untuk <b>${esc(inv.email)}</b>, sah sehingga ${esc(fmtDate(inv.expires_at))}.
      Pautan ini hanya dipaparkan <b>sekali</b> — salin atau hantar sekarang.</div>
    <input class="link-box" readonly value="${esc(link)}" aria-label="Pautan jemputan">
    <div class="invite-actions">
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

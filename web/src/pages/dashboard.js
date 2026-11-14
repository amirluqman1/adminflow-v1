// Utama — role-specific summary. Numbers come from dashboard_summary(), already scoped by RLS.
import { client, call, ROLE_LABEL } from '../api.js';
import { esc, toast } from '../ui.js';
import { canManage, canSeeDirectory } from '../perm.js';

export async function renderDashboard(ctx, el) {
  const seq = ctx.seq;
  const { data: s, error } = await call(() => client.rpc('dashboard_summary'));
  if (error) throw error;
  const name = ctx.me.employee?.full_name || ctx.user.email;
  const stat = (n, label, href) => {
    const inner = `<b>${Number(n) || 0}</b><span>${esc(label)}</span>`;
    return href ? `<a class="stat" href="${href}">${inner}</a>` : `<div class="stat">${inner}</div>`;
  };

  let noLogin = '';
  if (canManage(ctx)) {
    const [emps, profs] = await Promise.all([
      call(() => client.from('employees').select('id').eq('status', 'active')),
      call(() => client.from('profiles').select('employee_id')),
    ]);
    if (!emps.error && !profs.error) {
      const linked = new Set(profs.data.map((p) => p.employee_id));
      noLogin = emps.data.filter((e) => !linked.has(e.id)).length;
    }
  }

  if (ctx.stale(seq)) return;
  const byEntity = (s.staff_by_entity || []).map((x) => `<li><span>${esc(x.legal_entity_name)}</span><b>${x.count}</b></li>`).join('');
  const byOutlet = (s.staff_by_outlet || []).map((x) => `<li><span>${esc(x.outlet_name)}</span><b>${x.count}</b></li>`).join('');

  el.innerHTML = `
    <div class="page-head">
      <div><h1>Selamat datang, ${esc(name.split(' ')[0])}</h1>
        <p class="muted">${esc(ROLE_LABEL[ctx.me.role])}${ctx.me.role === 'admin' ? ' · Syarikat yang diberi oleh Owner' : ''}</p></div>
    </div>
    <div class="stats">
      ${canSeeDirectory(ctx) ? stat(s.total_staff, 'Staf aktif', '#/staf') : ''}
      ${canManage(ctx) ? stat(s.active_accounts, 'Akaun aktif') : ''}
      ${canManage(ctx) ? stat(noLogin, 'Belum ada akaun', '#/staf?login=none') : ''}
      ${stat(s.my_open_tasks, 'Tugasan saya', '#/tugasan?tab=saya')}
      ${stat(s.my_pending_leave, 'Cuti saya menunggu', '#/cuti?tab=saya')}
      ${canSeeDirectory(ctx) ? stat(s.pending_leave, 'Cuti menunggu (skop)', '#/cuti?tab=semua') : ''}
      ${canSeeDirectory(ctx) ? stat(s.open_tasks, 'Tugasan terbuka (skop)', '#/tugasan?tab=semua') : ''}
      ${canSeeDirectory(ctx) ? stat(s.awaiting_verification, 'Tunggu pengesahan', '#/tugasan?tab=sahkan') : ''}
      ${stat(s.overdue_tasks, 'Tugasan lewat', canSeeDirectory(ctx) ? '#/tugasan?tab=semua' : '#/tugasan?tab=saya')}
    </div>
    ${byEntity || byOutlet ? `
      <div class="grid-2">
        ${byEntity ? `<section class="panel"><h2>Staf ikut Syarikat</h2><ul class="kv">${byEntity}</ul></section>` : ''}
        ${byOutlet ? `<section class="panel"><h2>Staf ikut outlet</h2><ul class="kv">${byOutlet}</ul></section>` : ''}
      </div>` : ''}
    <section class="panel" id="notif"></section>`;
  renderNotifications(ctx, el.querySelector('#notif'), s.unread_notifications);
}

async function renderNotifications(ctx, sec, unread) {
  const seq = ctx.seq;
  const { data, error } = await call(() => client.from('notifications').select('*').order('created_at', { ascending: false }).limit(10));
  if (ctx.stale(seq) || !sec.isConnected) return;
  if (error) { sec.innerHTML = '<h2>Notifikasi</h2><p class="muted small">Gagal memuatkan notifikasi.</p>'; return; }
  const when = (iso) => new Date(iso).toLocaleString('ms-MY', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const href = (n) => (n.entity_type === 'leave_requests' ? '#/cuti?tab=semua' : n.entity_type === 'tasks' && n.entity_id ? `#/tugasan/${n.entity_id}` : null);
  sec.innerHTML = `
    <div class="panel-head"><h2>Notifikasi${unread ? ` <span class="count">${unread}</span>` : ''}</h2>
      ${unread ? '<button class="link" type="button" id="read-all">Tanda semua dibaca</button>' : ''}</div>
    ${data.length ? `<ul class="notifs">${data.map((n) => `
      <li class="${n.read_at ? '' : 'unread'}">
        ${href(n) ? `<a href="${href(n)}">` : '<div>'}<b>${esc(n.title)}</b>${n.body ? `<span class="small">${esc(n.body)}</span>` : ''}
        <span class="muted small">${esc(when(n.created_at))}</span>${href(n) ? '</a>' : '</div>'}
      </li>`).join('')}</ul>` : '<p class="muted small">Tiada notifikasi.</p>'}`;
  sec.querySelector('#read-all')?.addEventListener('click', async () => {
    const r = await call(() => client.rpc('mark_notification_read', { p_notification_id: null }));
    if (r.error) return toast('Gagal mengemas kini notifikasi.', 'error');
    sec.querySelectorAll('.unread').forEach((li) => li.classList.remove('unread'));
    sec.querySelector('.count')?.remove(); sec.querySelector('#read-all')?.remove();
  });
}

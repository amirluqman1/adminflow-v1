// Utama — role-specific summary. Numbers come from dashboard_summary(), already scoped by RLS.
import { client, call, ROLE_LABEL } from '../api.js';
import { esc } from '../ui.js';
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
      ${stat(s.pending_leave, 'Cuti menunggu')}
      ${stat(s.open_tasks, 'Tugasan terbuka')}
      ${stat(s.overdue_tasks, 'Tugasan lewat')}
      ${stat(s.unread_notifications, 'Notifikasi baharu')}
    </div>
    ${byEntity || byOutlet ? `
      <div class="grid-2">
        ${byEntity ? `<section class="panel"><h2>Staf ikut Syarikat</h2><ul class="kv">${byEntity}</ul></section>` : ''}
        ${byOutlet ? `<section class="panel"><h2>Staf ikut outlet</h2><ul class="kv">${byOutlet}</ul></section>` : ''}
      </div>` : ''}
    <p class="muted small">Cuti, tugasan dan sejarah aktiviti akan ditambah dalam Fasa 5.</p>`;
}

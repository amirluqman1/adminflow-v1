// Home: greeting + numbers from dashboard_summary() (already scoped by RLS for each role).
import { rpc } from '../neon.js';
import { esc, render, ROLE_BM } from '../ui.js';
import { state } from '../main.js';

export async function home() {
  const s = await rpc('dashboard_summary');
  const role = state.profile.role;
  const boss = role === 'owner' || role === 'admin';
  const tile = (n, label, warn) => `<div class="tile${warn && n > 0 ? ' warn' : ''}"><b>${Number(n) || 0}</b><span>${label}</span></div>`;
  const list = (rows, key) => rows.length
    ? `<ul class="list">${rows.map(r => `<li><span>${esc(r[key])}</span><b>${r.count}</b></li>`).join('')}</ul>`
    : '<p class="muted">Tiada data lagi.</p>';
  render(`
    <section class="card">
      <h1>Hai, ${esc(state.employee?.full_name || state.user.name || state.user.email)}</h1>
      <p><span class="badge">${ROLE_BM[role]}</span></p>
    </section>
    <section class="tiles">
      ${tile(s.total_staff, boss ? 'Pekerja aktif' : 'Pekerja dalam skop')}
      ${tile(s.pending_leave, 'Cuti menunggu', true)}
      ${tile(s.open_tasks, 'Tugasan terbuka')}
      ${tile(s.overdue_tasks, 'Tugasan lewat', true)}
      ${tile(s.my_open_tasks, 'Tugasan saya')}
      ${tile(s.my_pending_leave, 'Cuti saya menunggu')}
    </section>
    ${boss ? `<section class="card"><h2>Pekerja ikut Syarikat</h2>${list(s.staff_by_entity, 'legal_entity_name')}</section>
              <section class="card"><h2>Pekerja ikut outlet</h2>${list(s.staff_by_outlet, 'outlet_name')}</section>` : ''}
    <p class="muted center">Modul cuti & tugasan: Fasa 5.</p>`);
}

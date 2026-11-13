// Database error codes (docs/database.md) → Bahasa Melayu for the UI.
const BM = {
  not_authorized: 'Anda tiada akses untuk tindakan ini.',
  forbidden: 'Anda tiada kebenaran untuk tindakan ini.',
  not_found: 'Rekod tidak dijumpai.',
  leave_overlap: 'Tarikh cuti bertindih dengan cuti lain.',
  reason_required: 'Sila nyatakan sebab.',
  invalid_transition: 'Status ini tidak boleh ditukar begitu.',
  last_owner: 'Owner terakhir tidak boleh dibuang atau dinyahaktif.',
  email_not_verified: 'Sahkan email anda dahulu sebelum terima jemputan.',
  invalid_invitation: 'Jemputan tidak sah, sudah digunakan, dibatalkan atau tamat tempoh.',
  already_linked: 'Akaun log masuk ini sudah dipautkan kepada pekerja.',
  email_required: 'Email diperlukan untuk menghantar jemputan.',
  employee_inactive: 'Pekerja ini tidak aktif.',
  not_pending: 'Permohonan ini bukan lagi dalam status menunggu.',
  task_locked: 'Tugasan ini sudah dikunci.',
  not_a_manager: 'Akaun ini bukan Manager.',
  already_has_account: 'Pekerja ini sudah ada akaun. Aktifkan semula akaun itu.',
  entities_required: 'Sekurang-kurangnya satu Syarikat diperlukan.',
};

export function bm(err) {
  if (!err) return 'Ralat tidak diketahui.';
  const msg = String(err.message || err);
  if (BM[msg]) return BM[msg];
  if (err.code === '23505') return 'Nama atau nombor ini sudah digunakan.';
  if (err.code === '23514') return 'Maklumat tidak sah. Semak semula borang.';
  if (err.code === '42501' || /permission denied/i.test(msg)) return BM.forbidden;
  if (/fetch|network/i.test(msg)) return 'Tiada sambungan internet. Cuba lagi.';
  // Better Auth messages
  if (/invalid email or password/i.test(msg)) return 'Email atau kata laluan salah.';
  if (/already exists/i.test(msg)) return 'Email ini sudah didaftarkan. Sila log masuk.';
  if (/password.*(short|least)/i.test(msg)) return 'Kata laluan terlalu pendek (sekurang-kurangnya 8 aksara).';
  if (/otp|code/i.test(msg)) return 'Kod pengesahan salah atau tamat tempoh.';
  return msg;
}

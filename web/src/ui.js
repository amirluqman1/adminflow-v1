// Shared UI helpers: escaping, formatting, alerts, toast, modal dialog, busy buttons.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const EMP_TYPE = {
  full_time: 'Sepenuh masa',
  part_time: 'Separuh masa',
  contract: 'Kontrak',
  intern: 'Pelatih',
};

export function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('ms-MY', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return iso; }
}

export function alertBox(kind, text) {
  return text ? `<div class="alert ${kind}" role="${kind === 'error' ? 'alert' : 'status'}">${esc(text)}</div>` : '';
}

export function options(list, selected, { empty } = {}) {
  const opts = list.map(([v, label]) =>
    `<option value="${esc(v)}"${String(v) === String(selected ?? '') ? ' selected' : ''}>${esc(label)}</option>`);
  if (empty !== undefined) opts.unshift(`<option value=""${selected ? '' : ' selected'}>${esc(empty)}</option>`);
  return opts.join('');
}

// ---------------------------------------------------------------- toast
let toastTimer;
export function toast(text, kind = 'ok') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.className = `toast ${kind} show`;
  el.textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

// ---------------------------------------------------------------- busy button
// Runs fn while the button shows "Sila tunggu…"; returns fn's result.
export async function busy(btn, fn) {
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Sila tunggu…';
  try { return await fn(); }
  finally { if (btn.isConnected) { btn.disabled = false; btn.textContent = label; } }
}

// ---------------------------------------------------------------- modal dialog
// fields: [{ name, label, type: text|textarea|select|checkbox|date|email|tel, value, options: [[v,l]], required, hint, maxlength }]
// onSubmit(values) → returns an error string to keep the dialog open, or nothing to close it.
// Resolves with the values when confirmed, or null when cancelled.
export function dialog({ title, message = '', fields = [], confirm = 'Simpan', danger = false, onSubmit }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    dlg.innerHTML = `
      <form method="dialog" novalidate>
        <h2>${esc(title)}</h2>
        ${message ? `<p class="muted">${esc(message)}</p>` : ''}
        ${fields.map(fieldHtml).join('')}
        <div class="form-error"></div>
        <div class="modal-actions">
          <button type="button" class="secondary" data-cancel>Batal</button>
          <button type="submit" class="${danger ? 'danger' : 'primary'}">${esc(confirm)}</button>
        </div>
      </form>`;
    document.body.appendChild(dlg);
    const form = dlg.querySelector('form');
    const close = (val) => { dlg.close(); dlg.remove(); resolve(val); };
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    dlg.querySelector('[data-cancel]').addEventListener('click', () => close(null));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const values = readForm(form, fields);
      const missing = fields.find((f) => f.required && !String(values[f.name] ?? '').trim());
      const box = form.querySelector('.form-error');
      if (missing) { box.innerHTML = alertBox('error', `Sila isi: ${missing.label}`); return; }
      if (onSubmit) {
        const btn = form.querySelector('button[type=submit]');
        const err = await busy(btn, () => onSubmit(values));
        if (err) { box.innerHTML = alertBox('error', err); return; }
      }
      close(values);
    });
    dlg.showModal();
    const first = form.querySelector('input:not([type=checkbox]), select, textarea');
    if (first) first.focus();
  });
}

function fieldHtml(f) {
  const id = `f-${f.name}`;
  const hint = f.hint ? ` <span class="hint">${esc(f.hint)}</span>` : '';
  const req = f.required ? ' required' : '';
  const max = f.maxlength ? ` maxlength="${f.maxlength}"` : '';
  if (f.type === 'checkbox') {
    return `<label class="check"><input type="checkbox" name="${f.name}" id="${id}"${f.value ? ' checked' : ''}> ${esc(f.label)}</label>`;
  }
  if (f.type === 'select') {
    return `<label for="${id}">${esc(f.label)}${hint}<select name="${f.name}" id="${id}"${req}>${options(f.options, f.value, f.empty !== undefined ? { empty: f.empty } : {})}</select></label>`;
  }
  if (f.type === 'textarea') {
    return `<label for="${id}">${esc(f.label)}${hint}<textarea name="${f.name}" id="${id}" rows="3"${req}${max}>${esc(f.value ?? '')}</textarea></label>`;
  }
  return `<label for="${id}">${esc(f.label)}${hint}<input type="${f.type || 'text'}" name="${f.name}" id="${id}" value="${esc(f.value ?? '')}"${req}${max}${f.upper ? ' data-upper' : ''}></label>`;
}

function readForm(form, fields) {
  const out = {};
  for (const f of fields) {
    const el = form.elements[f.name];
    out[f.name] = f.type === 'checkbox' ? el.checked : el.value.trim();
    if (f.upper && out[f.name]) out[f.name] = out[f.name].toUpperCase();
  }
  return out;
}

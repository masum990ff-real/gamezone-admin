// Shared admin-panel UI: toasts, modals (S1 — never alert/confirm/prompt),
// drawer, pagination, loading/empty/error states. No dependencies.
const UI = (() => {
  const ICONS = {
    dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.6c2.8.4 5 2.7 5 5.4"/>',
    bell: '<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M4 12.5l5 5L20 6.5"/>',
    alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5"/><circle cx="12" cy="18" r="0.5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="8" r="0.5"/>',
    inbox: '<path d="M3 13l3-8h12l3 8v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 13h6l1.5 2h3L15 13h6"/>',
  };
  function icon(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  function fmtDate(v) {
    if (!v) return '—';
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
  }

  // Toasts: success / error / info, auto-dismiss, stacked.
  function toast(kind, message) {
    let host = document.getElementById('toasts');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toasts';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = 'toast ' + (kind === 'ok' ? 'ok' : kind === 'err' ? 'err' : 'info');
    el.innerHTML = icon(kind === 'ok' ? 'check' : kind === 'err' ? 'alert' : 'info') + '<span>' + esc(message) + '</span>';
    host.appendChild(el);
    while (host.children.length > 4) host.removeChild(host.firstChild);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .25s'; setTimeout(() => el.remove(), 260); }, 4200);
  }

  // Base modal: focus trap, Esc to close, backdrop click closes (unless locked).
  function openModal(html, opts) {
    const o = opts || {};
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = '<div class="modal glass" role="dialog" aria-modal="true">' + html + '</div>';
    const modal = backdrop.firstChild;
    const prevFocus = document.activeElement;
    function focusables() {
      return Array.from(modal.querySelectorAll('button, textarea, input, select, summary, [tabindex]'))
        .filter((el) => !el.disabled && el.offsetParent !== null);
    }
    function close() {
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      document.body.style.overflow = '';
      if (prevFocus && prevFocus.focus) prevFocus.focus();
    }
    function onKey(e) {
      if (e.key === 'Escape' && !o.locked) { e.stopPropagation(); close(); }
      if (e.key === 'Tab') {
        const f = focusables();
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    if (!o.locked) backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(backdrop);
    document.body.style.overflow = 'hidden';
    const f = focusables();
    if (f.length) f[0].focus();
    return { backdrop, modal, close };
  }

  function setLoading(btn, loading, label) {
    if (loading) {
      btn.dataset.label = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> ' + esc(label || 'Working...');
    } else {
      btn.disabled = false;
      if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
    }
  }

  // Styled confirm modal (replaces confirm()).
  function confirmModal(title, body, confirmLabel, danger, onConfirm) {
    const m = openModal(
      '<h3>' + esc(title) + '</h3><p class="modal-sub">' + esc(body) + '</p>'
      + '<div class="modal-err" id="mErr"></div>'
      + '<div class="modal-actions"><button class="btn btn-secondary" id="mCancel">Cancel</button>'
      + '<button class="btn ' + (danger ? 'btn-danger' : 'btn-primary') + '" id="mOk">' + esc(confirmLabel) + '</button></div>',
    );
    m.modal.querySelector('#mCancel').addEventListener('click', m.close);
    const okBtn = m.modal.querySelector('#mOk');
    okBtn.addEventListener('click', async () => {
      setLoading(okBtn, true);
      try {
        await onConfirm();
        m.close();
      } catch (err) {
        const box = m.modal.querySelector('#mErr');
        box.textContent = (err && err.message) || 'Request failed.';
        box.style.display = 'block';
        setLoading(okBtn, false);
      }
    });
    return m;
  }

  // Ban-reason modal: quick-pick chips + textarea with counter + validation.
  const BAN_REASONS = ['Cheating / hacking', 'Fake or duplicate account', 'Abusive behavior', 'Payment fraud', 'Other'];
  function reasonModal(userLabel, onBan) {
    const m = openModal(
      '<h3>Ban user</h3><p class="modal-sub">The reason below will be shown to the user.</p>'
      + '<div class="user-summary">' + esc(userLabel) + '</div>'
      + '<div class="chip-pick" id="mChips">' + BAN_REASONS.map((r) => '<button type="button">' + esc(r) + '</button>').join('') + '</div>'
      + '<label class="label" for="mReason">Ban reason (required, 5-200 characters)</label>'
      + '<textarea class="field" id="mReason" rows="3" maxlength="200" placeholder="Enter the reason for this ban"></textarea>'
      + '<div class="char-count"><span id="mCount">0</span>/200</div>'
      + '<div class="modal-err" id="mErr"></div>'
      + '<div class="modal-actions"><button class="btn btn-secondary" id="mCancel">Cancel</button>'
      + '<button class="btn btn-danger" id="mOk">Ban user</button></div>',
    );
    const area = m.modal.querySelector('#mReason');
    const count = m.modal.querySelector('#mCount');
    const errBox = m.modal.querySelector('#mErr');
    const okBtn = m.modal.querySelector('#mOk');
    area.addEventListener('input', () => { count.textContent = String(area.value.length); });
    m.modal.querySelectorAll('#mChips button').forEach((b) => b.addEventListener('click', () => {
      area.value = b.textContent;
      count.textContent = String(area.value.length);
      area.focus();
    }));
    m.modal.querySelector('#mCancel').addEventListener('click', m.close);
    let busy = false;
    okBtn.addEventListener('click', async () => {
      if (busy) return; // no double submission
      const reason = area.value.trim();
      if (reason.length < 5) {
        errBox.textContent = 'Please enter at least 5 characters.';
        errBox.style.display = 'block';
        area.focus();
        return;
      }
      busy = true;
      errBox.style.display = 'none';
      setLoading(okBtn, true, 'Banning...');
      try {
        await onBan(reason);
        m.close();
      } catch (err) {
        errBox.textContent = (err && err.message) || 'Could not ban user.';
        errBox.style.display = 'block';
        setLoading(okBtn, false);
        busy = false; // modal stays open for retry
      }
    });
    return m;
  }

  // Pagination control data helper.
  function pagerText(page, limit, total, noun) {
    const pages = Math.max(1, Math.ceil(total / limit));
    return 'Page ' + page + ' of ' + pages + ' (' + total + ' ' + (noun || 'items') + ')';
  }
  function skeletonRows(cols, n) {
    let s = '';
    for (let i = 0; i < (n || 4); i += 1) {
      s += '<div class="skeleton" style="height:18px;margin:10px 0"></div>';
    }
    return s;
  }
  function emptyState(title, sub) {
    return '<div class="state">' + icon('inbox') + '<div><b>' + esc(title) + '</b></div><div>' + esc(sub || '') + '</div></div>';
  }
  function errorState(message) {
    return '<div class="state">' + icon('alert') + '<div><b>Could not load.</b></div><div>' + esc(message) + '</div>'
      + '<div style="margin-top:12px"><button class="btn btn-secondary btn-sm" data-retry="1">Retry</button></div></div>';
  }

  // Phone drawer.
  function initDrawer() {
    const btn = document.getElementById('menuBtn');
    const scrim = document.getElementById('scrim');
    if (btn) btn.addEventListener('click', () => document.body.classList.toggle('drawer-open'));
    if (scrim) scrim.addEventListener('click', () => document.body.classList.remove('drawer-open'));
  }

  return {
    icon, esc, fmtDate, toast, openModal, setLoading, confirmModal, reasonModal,
    pagerText, skeletonRows, emptyState, errorState, initDrawer,
  };
})();

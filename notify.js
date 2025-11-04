/* notify.js
   Manager Notifications (bell + dropdown)
   - Shows only if current user role === 'manager'
   - Badge = count of pending journal_entries
   - Live updates via Supabase Realtime on INSERT/UPDATE
*/

(function () {
    function ready(fn){ document.readyState !== 'loading' ? fn() : document.addEventListener('DOMContentLoaded', fn); }
  
    ready(async function () {
      // 1) Ensure Supabase client exists
      const db = (window && window.supabaseClient) ? window.supabaseClient : null;
      if (!db) {
        console.warn('[notify.js] supabaseClient not found. Make sure notify.js is loaded AFTER auth.js.');
        return;
      }
  
      // 2) Detect role
      const username = (typeof localStorage !== 'undefined' && localStorage.getItem('username')) || 'User';
      let role = 'accountant';
      try {
        const { data, error } = await db
          .from('users')
          .select('role')
          .eq('username', username)
          .maybeSingle();
        if (!error && data && data.role) role = String(data.role).toLowerCase();
      } catch (e) {
        console.warn('[notify.js] Unable to read users.role', e);
      }
  
      if (role !== 'manager') return; // Bell is for managers only
  
      // 3) Inject styles
      injectStyles(
  `.notif-wrap{position:relative;margin-left:.75rem}
  .notif-bell{position:relative;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9999px;border:1px solid #e5e7eb;background:#fff;cursor:pointer}
  .notif-bell:hover{background:#f8fafc}
  .notif-badge{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;padding:0 4px;background:#dc2626;color:#fff;border-radius:9999px;font-size:11px;line-height:18px;text-align:center;font-weight:700;display:none}
  .notif-dd{position:absolute;top:42px;right:0;width:320px;max-height:360px;overflow:auto;background:#fff;border:1px solid #e5e7eb;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);display:none;z-index:9999}
  .notif-dd header{padding:.55rem .7rem;font-weight:600;background:#f8fafc;border-bottom:1px solid #e5e7eb}
  .notif-item{display:flex;gap:.55rem;padding:.6rem .7rem;align-items:flex-start;text-decoration:none;color:#0f172a}
  .notif-item:hover{background:#f1f5f9}
  .notif-item .meta{font-size:12px;color:#64748b}
  .notif-empty{padding:.9rem .8rem;color:#475569}
  .notif-dot{width:8px;height:8px;margin-top:.35rem;border-radius:9999px;background:#22c55e;flex-shrink:0}`
      );
  
      // 4) Build bell in header
      const topbar = document.querySelector('header.topbar');
      if (!topbar) {
        console.warn('[notify.js] No header.topbar found.');
        return;
      }
      const userBlock = topbar.querySelector('.user') || topbar.lastElementChild;
  
      const wrap = document.createElement('div');
      wrap.className = 'notif-wrap';
      wrap.innerHTML = [
        '<button class="notif-bell" id="notifBellBtn" aria-label="Notifications" title="Notifications">',
        '  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">',
        '    <path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 1 0-14 0v5l-2 2v1h18v-1l-2-2Z" stroke="#0f172a" stroke-width="1.25" fill="none"></path>',
        '  </svg>',
        '  <span class="notif-badge" id="notifBadge">0</span>',
        '</button>',
        '<div class="notif-dd" id="notifDropdown">',
        '  <header>Pending Journal Entries</header>',
        '  <div id="notifList"><div class="notif-empty">No pending entries.</div></div>',
        '</div>'
      ].join('');
  
      userBlock?.parentNode?.insertBefore(wrap, userBlock);
  
      const bellBtn = wrap.querySelector('#notifBellBtn');
      const badge   = wrap.querySelector('#notifBadge');
      const dd      = wrap.querySelector('#notifDropdown');
      const list    = wrap.querySelector('#notifList');
  
      bellBtn.addEventListener('click', () => {
        dd.style.display = (dd.style.display === 'block') ? 'none' : 'block';
      });
      document.addEventListener('click', (e) => {
        if (!wrap.contains(e.target)) dd.style.display = 'none';
      });
  
      // 5) Load pending list initially
      await loadPending();
  
      // 6) Realtime updates
      // NOTE: Requires Supabase Realtime enabled for table journal_entries
      try {
        const channel = db.channel('journal_notify');
        channel.on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'journal_entries' },
          (payload) => {
            const row = payload?.new;
            if (row?.status === 'pending') {
              pulse(bellBtn);
              loadPending();
            }
          }
        ).on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'journal_entries' },
          (payload) => {
            // Whenever status changes, refresh list (handles approve/reject)
            if (payload?.new) loadPending();
          }
        ).subscribe();
      } catch (e) {
        console.warn('[notify.js] Realtime subscribe failed:', e);
      }
  
      async function loadPending() {
        try {
          const { data, error } = await db
            .from('journal_entries')
            .select('entry_id, date, created_by, total_debit, total_credit, status')
            .eq('status', 'pending')
            .order('date', { ascending: false })
            .limit(50);
          if (error) {
            console.warn('[notify.js] loadPending error:', error.message);
            renderList([]);
            return;
          }
          renderList(data || []);
        } catch (e) {
          console.warn('[notify.js] loadPending exception:', e);
          renderList([]);
        }
      }
  
      function renderList(items) {
        // Badge
        const count = items.length;
        if (count > 0) {
          badge.style.display = 'inline-block';
          badge.textContent = String(count);
        } else {
          badge.style.display = 'none';
        }
  
        // Items
        if (!items.length) {
          list.innerHTML = '<div class="notif-empty">No pending entries.</div>';
          return;
        }
  
        list.innerHTML = items.map(e => {
          const dateStr = e.date ? new Date(e.date).toLocaleDateString() : '';
          const amount  = Number(e.total_debit || 0).toFixed(2);
          return (
            `<a class="notif-item" href="journal.html?entry_id=${encodeURIComponent(e.entry_id)}">` +
            `  <span class="notif-dot"></span>` +
            `  <div>` +
            `    <div><strong>Journal #${e.entry_id}</strong> • $${amount}</div>` +
            `    <div class="meta">Submitted by ${escapeHtml(e.created_by||'N/A')} on ${dateStr}</div>` +
            `  </div>` +
            `</a>`
          );
        }).join('');
      }
  
      // Helpers
      function injectStyles(css) {
        const el = document.createElement('style');
        el.textContent = css;
        document.head.appendChild(el);
      }
      function pulse(el) {
        if (!el || !el.animate) return;
        el.animate(
          [{ transform: 'scale(1)' }, { transform: 'scale(1.1)' }, { transform: 'scale(1)' }],
          { duration: 300 }
        );
      }
      function escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, (m) => ({
          '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
        }[m]));
      }
    });
  })();
  
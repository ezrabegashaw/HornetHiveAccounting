/* notify.js
   Manager Notifications (bell + dropdown, PNG icon)
   - Bell stays white
   - Positioned at top-right of header
   - Header bar uses site green; text white
   - Clicking any notification opens journal.html (manager can approve/reject there)
*/

(function () {
    function ready(fn){ document.readyState !== 'loading' ? fn() : document.addEventListener('DOMContentLoaded', fn); }
  
    const BELL_SRC = './icons8-bell-24.png';
    const BRAND_GREEN = '#15803d'; // your KSU-style green
  
    ready(async function () {
      const db = window.supabaseClient;
      if (!db) {
        console.warn('[notify.js] supabaseClient not found. Load notify.js AFTER auth.js.');
        return;
      }
  
      // --- Identify role ---
      const username = localStorage.getItem('username') || 'User';
      let role = 'accountant';
      try {
        const { data } = await db.from('users').select('role').eq('username', username).maybeSingle();
        if (data?.role) role = String(data.role).toLowerCase();
      } catch (e) {
        console.warn('[notify.js] Unable to read users.role', e);
      }
  
      if (role !== 'manager') return;
  
      // --- Inject styles ---
      injectStyles(`
        .notif-wrap{position:relative}
        header.topbar{position:relative;display:flex;justify-content:space-between;align-items:center}
        header.topbar .user{margin-left:auto;display:flex;align-items:center;gap:.5rem}
        .notif-bell{position:relative;display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:9999px;border:none;background:transparent;cursor:pointer}
        .notif-bell:hover{background:rgba(255,255,255,0.15)}
        .notif-bell img{display:block;width:22px;height:22px;filter:none}
        .notif-badge{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;padding:0 4px;background:#dc2626;color:#fff;border-radius:9999px;font-size:11px;line-height:18px;text-align:center;font-weight:700;display:none}
        .notif-dd{position:absolute;top:42px;right:0;width:320px;max-height:360px;overflow:auto;background:#fff;border:1px solid #e5e7eb;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);display:none;z-index:9999}
        .notif-dd header{padding:.6rem .75rem;font-weight:700;background:${BRAND_GREEN};color:#fff;border-top-left-radius:10px;border-top-right-radius:10px}
        .notif-item{display:flex;gap:.55rem;padding:.6rem .7rem;align-items:flex-start;text-decoration:none;color:#0f172a}
        .notif-item:hover{background:#f1f5f9}
        .notif-item .meta{font-size:12px;color:#64748b}
        .notif-empty{padding:.9rem .8rem;color:#475569}
        .notif-dot{width:8px;height:8px;margin-top:.35rem;border-radius:9999px;background:#22c55e;flex-shrink:0}
      `);
  
      // --- Build bell icon ---
      const topbar = document.querySelector('header.topbar');
      if (!topbar) return console.warn('[notify.js] No header.topbar found.');
      const userBlock = topbar.querySelector('.user');
      const mount = userBlock || topbar;
  
      const wrap = document.createElement('div');
      wrap.className = 'notif-wrap';
      wrap.innerHTML = `
        <button class="notif-bell" id="notifBellBtn" aria-label="Notifications" title="Notifications">
          <img src="${BELL_SRC}" alt="Notifications">
          <span class="notif-badge" id="notifBadge">0</span>
        </button>
        <div class="notif-dd" id="notifDropdown">
          <header>Pending Journal Entries</header>
          <div id="notifList"><div class="notif-empty">No pending entries.</div></div>
        </div>
      `;
      mount.appendChild(wrap);
  
      const bellBtn = wrap.querySelector('#notifBellBtn');
      const badge = wrap.querySelector('#notifBadge');
      const dd = wrap.querySelector('#notifDropdown');
      const list = wrap.querySelector('#notifList');
  
      bellBtn.addEventListener('click', () => {
        dd.style.display = dd.style.display === 'block' ? 'none' : 'block';
      });
      document.addEventListener('click', e => {
        if (!wrap.contains(e.target)) dd.style.display = 'none';
      });
  
      // --- Load initial notifications ---
      await loadPending();
  
      // --- Real-time updates ---
      try {
        const channel = db.channel('journal_notify_png');
        channel
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'journal_entries' }, payload => {
            if (payload?.new?.status === 'pending') {
              pulse(bellBtn);
              loadPending();
            }
          })
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'journal_entries' }, () => loadPending())
          .subscribe();
      } catch (e) {
        console.warn('[notify.js] Realtime subscribe failed:', e);
      }
  
      // --- Functions ---
      async function loadPending() {
        try {
          const { data, error } = await db
            .from('journal_entries')
            .select('entry_id, date, created_by, total_debit, total_credit, status')
            .eq('status', 'pending')
            .order('date', { ascending: false })
            .limit(50);
          if (error) return renderList([]);
          renderList(data || []);
        } catch {
          renderList([]);
        }
      }
  
      function renderList(items) {
        const count = items.length;
        badge.style.display = count ? 'inline-block' : 'none';
        badge.textContent = count ? String(count) : '';
  
        if (!count) {
          list.innerHTML = '<div class="notif-empty">No pending entries.</div>';
          return;
        }
  
        list.innerHTML = items
          .map(e => {
            const dateStr = e.date ? new Date(e.date).toLocaleDateString() : '';
            const amount = Number(e.total_debit || 0).toFixed(2);
            return `
              <a class="notif-item" href="journal.html">
                <span class="notif-dot"></span>
                <div>
                  <div><strong>Journal #${e.entry_id}</strong> • $${amount}</div>
                  <div class="meta">Submitted by ${escapeHtml(e.created_by || 'N/A')} on ${dateStr}</div>
                </div>
              </a>
            `;
          })
          .join('');
      }
  
      function injectStyles(css) {
        const el = document.createElement('style');
        el.textContent = css;
        document.head.appendChild(el);
      }
  
      function pulse(el) {
        if (!el || !el.animate) return;
        el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.1)' }, { transform: 'scale(1)' }], { duration: 300 });
      }
  
      function escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
      }
    });
  })();
  
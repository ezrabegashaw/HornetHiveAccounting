// eventLogs.js

// Use the Supabase client from auth.js if available; fallback if needed
let db = window.supabaseClient;
if (!db && window.supabase) {
  const SUPABASE_URL = "https://rsthdogcmqwcdbqppsrm.supabase.co";
  const SUPABASE_ANON_KEY = "your-anon-key-here"; // replace with your anon key
  db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// ------- DOM -------
const logsEl = document.getElementById('logs');
const qEl = document.getElementById('q');
const actionEl = document.getElementById('actionFilter');
const fromEl = document.getElementById('fromDate');
const toEl = document.getElementById('toDate');
const applyBtn = document.getElementById('apply');
const clearBtn = document.getElementById('clear');
const prevBtn = document.getElementById('prevPage');
const nextBtn = document.getElementById('nextPage');
const pageInfo = document.getElementById('pageInfo');

// ------- Paging -------
const PAGE_SIZE = 20;
let currentPage = 1;
let cache = []; // locally filtered for paging

// ------- Helpers -------
function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

function pillClass(action) {
  if (action === 'add_account') return 'pill add';
  if (action === 'update_account') return 'pill update';
  if (action === 'deactivate_account') return 'pill deactivate';
  return 'pill';
}

function pickFields(obj) {
  if (!obj) return null;
  // Only fields you care to show in the “snapshot”
  const {
    account_number, account_name, account_category, account_subcategory,
    normal_side, statement_type, initial_balance, balance, account_order,
    account_description, user_id, date_added, is_active, comment
  } = obj;
  return {
    account_number, account_name, account_category, account_subcategory,
    normal_side, statement_type, initial_balance, balance, account_order,
    account_description, user_id, date_added, is_active, comment
  };
}

// Return set of keys that changed (to highlight)
function diffKeys(before, after) {
  const keys = new Set([
    ...Object.keys(before || {}),
    ...Object.keys(after || {})
  ]);
  const changed = [];
  for (const k of keys) {
    const b = before ? before[k] : undefined;
    const a = after ? after[k] : undefined;
    const bv = b == null ? '' : String(b);
    const av = a == null ? '' : String(a);
    if (bv !== av) changed.push(k);
  }
  return new Set(changed);
}

function renderKV(container, data, changedSet) {
  if (!data) {
    container.innerHTML = `<div class="empty">—</div>`;
    return;
  }
  const fields = Object.entries(data);
  if (!fields.length) {
    container.innerHTML = `<div class="empty">—</div>`;
    return;
  }
  const frag = document.createDocumentFragment();
  const wrap = document.createElement('div');
  wrap.className = 'kv';
  fields.forEach(([k, v]) => {
    const kEl = document.createElement('div');
    kEl.className = 'k';
    kEl.textContent = niceKey(k);
    const vEl = document.createElement('div');
    vEl.className = 'v';
    const text = v == null || v === '' ? '—' : String(v);
    vEl.textContent = text;
    if (changedSet?.has(k)) vEl.classList.add('changed');
    wrap.appendChild(kEl);
    wrap.appendChild(vEl);
  });
  frag.appendChild(wrap);
  container.innerHTML = '';
  container.appendChild(frag);
}

function niceKey(k) {
  return (k || '').replaceAll('_',' ').replace(/\b\w/g, m => m.toUpperCase());
}

// ------- Fetch & Filter -------
async function fetchEvents() {
  // Pull a reasonable window; you can increase if needed
  const { data, error } = await db
    .from('eventLog')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(500);

  if (error) {
    logsEl.innerHTML = `<div class="no-results" style="color:#b91c1c">Error loading logs: ${error.message}</div>`;
    return [];
  }
  return data || [];
}

function applyFilters(rows) {
  const q = (qEl.value || '').trim().toLowerCase();
  const action = actionEl.value || '';
  const from = fromEl.value ? new Date(fromEl.value + 'T00:00:00') : null;
  const to = toEl.value ? new Date(toEl.value + 'T23:59:59') : null;

  return rows.filter(r => {
    // Action filter
    if (action && r.action !== action) return false;

    // Date range (timestamp)
    const t = r.timestamp ? new Date(r.timestamp) : null;
    if (from && t && t < from) return false;
    if (to && t && t > to) return false;

    // Text search on account_number / account_name (in before or after)
    if (q) {
      let hit = false;
      try {
        const b = r.before ? JSON.parse(r.before) : null;
        const a = r.after ? JSON.parse(r.after) : null;
        const strings = [
          b?.account_number, b?.account_name,
          a?.account_number, a?.account_name
        ].filter(Boolean).map(x => String(x).toLowerCase());
        hit = strings.some(s => s.includes(q));
      } catch {}
      if (!hit) return false;
    }

    return true;
  });
}

// ------- Render -------
function renderPage() {
  const start = (currentPage - 1) * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  const slice = cache.slice(start, end);

  logsEl.innerHTML = '';
  if (!slice.length) {
    logsEl.innerHTML = `<div class="no-results">No matching events.</div>`;
  }

  slice.forEach(row => {
    let beforeObj = null, afterObj = null;
    try { beforeObj = row.before ? JSON.parse(row.before) : null; } catch {}
    try { afterObj = row.after ? JSON.parse(row.after) : null; } catch {}

    const beforePicked = pickFields(beforeObj);
    const afterPicked  = pickFields(afterObj);
    const changed = diffKeys(beforePicked || {}, afterPicked || {});

    const card = document.createElement('div');
    card.className = 'log-card';
    card.innerHTML = `
      <div class="log-meta">
        <span class="${pillClass(row.action)}">${row.action || 'event'}</span>
        <span class="pill">User ID: ${row.userId ?? 'N/A'}</span>
        <span class="pill">${fmtDateTime(row.timestamp)}</span>
      </div>
      <div class="snapshots">
        <div class="snapshot">
          <h4>Before</h4>
          <div class="kv before"></div>
        </div>
        <div class="snapshot">
          <h4>After</h4>
          <div class="kv after"></div>
        </div>
      </div>
    `;

    renderKV(card.querySelector('.before'), beforePicked, changed);
    renderKV(card.querySelector('.after'),  afterPicked,  changed);

    logsEl.appendChild(card);
  });

  const totalPages = Math.max(1, Math.ceil(cache.length / PAGE_SIZE));
  pageInfo.textContent = `${currentPage}/${totalPages}`;
  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= totalPages;
}

// ------- Init -------
async function init() {
  logsEl.innerHTML = `<div class="no-results">Loading…</div>`;
  const rows = await fetchEvents();
  cache = applyFilters(rows);
  currentPage = 1;
  renderPage();
}

applyBtn?.addEventListener('click', async () => {
  const rows = await fetchEvents();
  cache = applyFilters(rows);
  currentPage = 1;
  renderPage();
});

clearBtn?.addEventListener('click', async () => {
  qEl.value = '';
  actionEl.value = '';
  fromEl.value = '';
  toEl.value = '';
  const rows = await fetchEvents();
  cache = applyFilters(rows);
  currentPage = 1;
  renderPage();
});

prevBtn?.addEventListener('click', () => { if (currentPage > 1) { currentPage--; renderPage(); }});
nextBtn?.addEventListener('click', () => { const total = Math.ceil(cache.length / PAGE_SIZE); if (currentPage < total) { currentPage++; renderPage(); }});

document.addEventListener('DOMContentLoaded', init);

// Supabase client 
const db = window.supabaseClient;
if (!db) {
  console.error("eventLogs.js: window.supabaseClient is missing.");
}

// DOM 
const logsEl   = document.getElementById('logs');
const qEl      = document.getElementById('q');
const actionEl = document.getElementById('actionFilter');
const fromEl   = document.getElementById('fromDate');
const toEl     = document.getElementById('toDate');
const applyBtn = document.getElementById('apply');
const clearBtn = document.getElementById('clear');
const prevBtn  = document.getElementById('prevPage');
const nextBtn  = document.getElementById('nextPage');
const pageInfo = document.getElementById('pageInfo');

// Config / Paging 
const PAGE_SIZE = 20;
let currentPage = 1;
let cache = [];

// Helpers 
function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function pillClass(action) {
  const a = String(action || '').toLowerCase();
  if (a.includes('add') || a.includes('create')) return 'pill add';
  if (a.includes('deact') || a.includes('delete') || a.includes('reject')) return 'pill deactivate';
  return 'pill update';
}

function niceKey(k) {
  return (k || '').replaceAll('_', ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

// Pick a safe subset of fields to display; if object is small, show everything
function pickReadableFields(obj) {
  if (!obj) return null;
  const keys = Object.keys(obj);
  if (keys.length <= 24) {
    return obj;
  }

  const preferred = [
    'entity', 'entity_id', 'action',
    'account_number', 'account_name', 'account_category', 'account_subcategory',
    'normal_side', 'statement_type', 'initial_balance', 'balance',
    'account_order', 'account_description',
    'user_id', 'username', 'email', 'role', 'is_active',
    'date', 'status', 'total_debit', 'total_credit', 'description',
    'journal_entry_id'
  ];

  const out = {};
  preferred.forEach((k) => {
    if (k in obj) out[k] = obj[k];
  });

  for (const k of keys) {
    if (k in out) continue;
    const v = obj[k];
    if (v == null) continue;
    if (typeof v === 'object') continue;
    if (Object.keys(out).length >= 24) break;
    out[k] = v;
  }
  return out;
}

// Return set of keys that changed
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
  const entries = Object.entries(data);
  if (!entries.length) {
    container.innerHTML = `<div class="empty">—</div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  const wrap = document.createElement('div');
  wrap.className = 'kv';

  entries.forEach(([k, v]) => {
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

// Data access 

// Get distinct action values for dropdown
async function fetchDistinctActions() {
  try {
    const { data, error } = await db
      .from('event_log')
      .select('action')
      .neq('action', null);

    if (error) {
      console.error("fetchDistinctActions error:", error);
      return;
    }

    const set = new Set();
    (data || []).forEach((r) => {
      if (r?.action) set.add(r.action);
    });

    const options = Array.from(set).sort();
    actionEl.innerHTML =
      `<option value="">All actions</option>` +
      options.map((a) => `<option value="${a}">${a}</option>`).join('');
  } catch (e) {
    console.error("fetchDistinctActions exception:", e);
  }
}

// Fetch all events from event_log
async function fetchEvents() {
  try {
    const cols =
      'id, action, entity, entity_id, user_name, user_id, timestamp, before, after';
    const { data, error } = await db
      .from('event_log')
      .select(cols)
      .order('timestamp', { ascending: false })
      .limit(1000);

    if (error) {
      console.error("fetchEvents error:", error);
      logsEl.innerHTML =
        `<div class="no-results" style="color:#b91c1c">Error loading logs: ${error.message}</div>`;
      return [];
    }

    console.log("fetchEvents rows:", data);
    return data || [];
  } catch (e) {
    console.error("fetchEvents exception:", e);
    logsEl.innerHTML =
      `<div class="no-results" style="color:#b91c1c">Error loading logs.</div>`;
    return [];
  }
}

// Filter + Render 
function applyFilters(rows) {
  const q = (qEl.value || '').trim().toLowerCase();
  const action = actionEl.value || '';
  const from = fromEl.value ? new Date(fromEl.value + 'T00:00:00') : null;
  const to = toEl.value ? new Date(toEl.value + 'T23:59:59') : null;

  return rows.filter((r) => {
    if (action && r.action !== action) return false;

    const t = r.timestamp ? new Date(r.timestamp) : null;
    if (from && t && t < from) return false;
    if (to && t && t > to) return false;

    if (q) {
      let hit = false;

      const hay = [
        r.action,
        r.entity,
        r.entity_id,
        r.user_name,
        r.user_id
      ]
        .filter(Boolean)
        .map((x) => String(x).toLowerCase());

      try {
        let b = r.before ?? null;
        let a = r.after ?? null;

        if (typeof b === 'string') b = JSON.parse(b);
        if (typeof a === 'string') a = JSON.parse(a);

        const addl = [];
        [b, a].forEach((o) => {
          if (!o) return;
          [
            'account_number', 'account_name', 'journal_entry_id', 'date',
            'status', 'total_debit', 'total_credit',
            'username', 'email', 'role', 'description', 'name', 'id'
          ].forEach((k) => {
            if (o[k] != null) addl.push(String(o[k]).toLowerCase());
          });
        });
        hay.push(...addl);
      } catch (e) {
      }

      hit = hay.some((s) => s.includes(q));
      if (!hit) return false;
    }

    return true;
  });
}

function renderPage() {
  const start = (currentPage - 1) * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  const slice = cache.slice(start, end);

  logsEl.innerHTML = '';
  if (!slice.length) {
    logsEl.innerHTML = `<div class="no-results">No matching events.</div>`;
    return;
  }

  slice.forEach((row) => {
    let beforeObj = null,
      afterObj = null;

    try {
      if (row.before != null) {
        beforeObj =
          typeof row.before === 'string' ? JSON.parse(row.before) : row.before;
      }
    } catch (e) {
      console.warn("Bad before JSON:", e);
    }

    try {
      if (row.after != null) {
        afterObj =
          typeof row.after === 'string' ? JSON.parse(row.after) : row.after;
      }
    } catch (e) {
      console.warn("Bad after JSON:", e);
    }

    const beforePicked = pickReadableFields(beforeObj);
    const afterPicked = pickReadableFields(afterObj);
    const changed = diffKeys(beforePicked || {}, afterPicked || {});

    const card = document.createElement('div');
    card.className = 'log-card';

    const who = row.user_name || row.user_id || 'N/A';
    const ent = row.entity
      ? ` • ${row.entity}${row.entity_id ? ` #${row.entity_id}` : ''}`
      : '';

    card.innerHTML = `
      <div class="log-meta">
        <span class="${pillClass(row.action)}">${row.action || 'event'}</span>
        <span class="pill">By: ${who}${ent}</span>
        <span class="pill">${fmtDateTime(row.timestamp)}</span>
      </div>
      <div class="snapshot before"></div>
      <div class="snapshot after"></div>
    `;

    renderKV(card.querySelector('.before'), beforePicked, changed);
    renderKV(card.querySelector('.after'), afterPicked, changed);

    logsEl.appendChild(card);
  });

  const totalPages = Math.max(1, Math.ceil(cache.length / PAGE_SIZE));
  pageInfo.textContent = `${currentPage}/${totalPages}`;
  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= totalPages;
}

// Init 
async function init() {
  if (!db) {
    logsEl.innerHTML =
      `<div class="no-results" style="color:#b91c1c">Supabase client not found.</div>`;
    return;
  }

  logsEl.innerHTML = `<div class="no-results">Loading…</div>`;

  await fetchDistinctActions();
  const rows = await fetchEvents();

  // Rows from DB BEFORE filters
  console.log("Total events from DB:", rows.length);

  cache = applyFilters(rows);
  currentPage = 1;
  renderPage();
}

// Button events
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

prevBtn?.addEventListener('click', () => {
  if (currentPage > 1) {
    currentPage--;
    renderPage();
  }
});

nextBtn?.addEventListener('click', () => {
  const total = Math.ceil(cache.length / PAGE_SIZE);
  if (currentPage < total) {
    currentPage++;
    renderPage();
  }
});

document.addEventListener('DOMContentLoaded', init);

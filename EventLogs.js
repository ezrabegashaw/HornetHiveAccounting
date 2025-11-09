// eventLogs.js — friendlier wording, clear user, no "#id" suffix, before/after kept

// Use the Supabase client from auth.js if available; fallback if needed
let db = window.supabaseClient;
if (!db && window.supabase) {
  const SUPABASE_URL = "YOUR_URL";
  const SUPABASE_ANON_KEY = "YOUR_ANON_KEY";
  db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// ------- DOM -------
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

// ------- Config / Paging -------
const PAGE_SIZE = 20;
let currentPage = 1;
let cache = [];
let tableName = 'event_log'; // default; will auto-fallback to eventLog if needed

// ------- Helpers -------
function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

function titleCase(s){ return String(s||'').replace(/\w\S*/g, w => w[0].toUpperCase()+w.slice(1).toLowerCase()); }

function prettyAction(rawAction, entity, before, after) {
  const a = String(rawAction||'').toLowerCase();
  const e = String(entity||'').toLowerCase();

  // detect journal status transitions
  const beforeStatus = before && typeof before === 'object' ? String(before.status||'').toLowerCase() : '';
  const afterStatus  = after  && typeof after  === 'object' ? String(after.status ||'').toLowerCase()  : '';

  // ACCOUNTS
  if (e === 'accounts' || e === 'account') {
    if (a === 'insert' || a.includes('add')) return 'Account Added';
    if (a === 'update' || a.includes('edit') || a.includes('modify')) return 'Account Updated';
    if (a === 'delete' || a.includes('deactivate')) return 'Account Deactivated';
  }

  // USERS
  if (e === 'users' || e === 'user') {
    if (a === 'insert' || a.includes('add')) return 'User Added';
    if (a === 'update') return 'User Updated';
    if (a === 'delete' || a.includes('deactivate')) return 'User Deactivated';
  }

  // JOURNAL ENTRIES
  if (e === 'journal_entries' || e === 'journal entry' || e === 'journal') {
    if (beforeStatus && afterStatus && beforeStatus !== afterStatus) {
      if (afterStatus === 'approved') return 'Journal Entry Approved';
      if (afterStatus === 'rejected') return 'Journal Entry Rejected';
    }
    if (!before && after) {
      // brand new
      if (afterStatus === 'pending') return 'Journal Entry Submitted';
      return 'Journal Entry Added';
    }
    if (a === 'update') return 'Journal Entry Updated';
    if (a === 'delete') return 'Journal Entry Deleted';
  }

  // JOURNAL LINES (rarely interesting to end users—still show friendly)
  if (e === 'journal_lines' || e === 'journal line') {
    if (a === 'insert') return 'Journal Lines Added';
    if (a === 'update') return 'Journal Lines Updated';
    if (a === 'delete') return 'Journal Lines Deleted';
  }

  // Fallback: title-case with entity
  if (a) {
    if (a === 'insert') return `${titleCase(e||'Record')} Added`;
    if (a === 'update') return `${titleCase(e||'Record')} Updated`;
    if (a === 'delete') return `${titleCase(e||'Record')} Deleted`;
    return titleCase(a);
  }
  return 'Event';
}

function pillClass(friendlyAction) {
  const a = String(friendlyAction || '').toLowerCase();
  if (a.includes('added') || a.includes('submitted') || a.includes('approved')) return 'pill add';
  if (a.includes('deactivated') || a.includes('deleted') || a.includes('rejected')) return 'pill deactivate';
  return 'pill update';
}

function niceKey(k) {
  return (k || '').replaceAll('_',' ').replace(/\b\w/g, m => m.toUpperCase());
}

// Limit the amount of fields shown; prefer business-relevant
function pickReadableFields(obj) {
  if (!obj) return null;
  const keys = Object.keys(obj);
  if (keys.length <= 24) return obj;
  const preferred = [
    'account_number','account_name','account_category','account_subcategory',
    'normal_side','statement_type','initial_balance','balance','account_order',
    'account_description','is_active','date_added',
    'journal_entry_id','date','status','total_debit','total_credit','description',
    'username','email','role','user_id','user_name'
  ];
  const out = {};
  preferred.forEach(k => { if (k in obj) out[k] = obj[k]; });
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

function diffKeys(before, after) {
  const keys = new Set([...(Object.keys(before||{})), ...(Object.keys(after||{}))]);
  const changed = [];
  for (const k of keys) {
    const b = before ? before[k] : undefined;
    const a = after  ? after[k]  : undefined;
    const bv = b == null ? '' : String(b);
    const av = a == null ? '' : String(a);
    if (bv !== av) changed.push(k);
  }
  return new Set(changed);
}

function renderKV(container, data, changedSet) {
  if (!data) { container.innerHTML = `<div class="empty">—</div>`; return; }
  const entries = Object.entries(data);
  if (!entries.length) { container.innerHTML = `<div class="empty">—</div>`; return; }
  const frag = document.createDocumentFragment();
  const wrap = document.createElement('div');
  wrap.className = 'kv';
  entries.forEach(([k, v]) => {
    const kEl = document.createElement('div');
    kEl.className = 'k';
    kEl.textContent = niceKey(k);
    const vEl = document.createElement('div');
    vEl.className = 'v';
    vEl.textContent = (v == null || v === '') ? '—' : String(v);
    if (changedSet?.has(k)) vEl.classList.add('changed');
    wrap.appendChild(kEl);
    wrap.appendChild(vEl);
  });
  frag.appendChild(wrap);
  container.innerHTML = '';
  container.appendChild(frag);
}

// ------- Data access -------
async function resolveTableName() {
  try {
    const { error } = await db.from('event_log').select('id').limit(1);
    if (!error) { tableName = 'event_log'; return; }
  } catch {}
  tableName = 'eventLog'; // legacy fallback
}

async function fetchDistinctActions() {
  try {
    const { data, error } = await db.from(tableName).select('action,entity,before,after');
    if (error) return;
    const labels = new Set();
    (data || []).forEach(r => {
      let b = null, a = null;
      try { b = r.before ? JSON.parse(r.before) : null; } catch {}
      try { a = r.after  ? JSON.parse(r.after)  : null; } catch {}
      labels.add(prettyAction(r.action, r.entity, b, a));
    });
    const options = Array.from(labels).sort();
    actionEl.innerHTML = `<option value="">All actions</option>` +
      options.map(a => `<option value="${a}">${a}</option>`).join('');
  } catch {}
}

async function fetchEvents() {
  const cols = 'id, action, entity, entity_id, user_name, user_id, timestamp, before, after';
  const { data, error } = await db
    .from(tableName)
    .select(cols)
    .order('timestamp', { ascending: false })
    .limit(1000);
  if (error) {
    logsEl.innerHTML = `<div class="no-results" style="color:#b91c1c">Error loading logs: ${error.message}</div>`;
    return [];
  }
  return data || [];
}

// ------- Filter + Render -------
function applyFilters(rows) {
  const q = (qEl.value || '').trim().toLowerCase();
  const actionFilterFriendly = actionEl.value || '';
  const from = fromEl.value ? new Date(fromEl.value + 'T00:00:00') : null;
  const to = toEl.value ? new Date(toEl.value + 'T23:59:59') : null;

  return rows.filter(r => {
    // build friendly for this row (used for filter display)
    let b=null,a=null;
    try { b = r.before ? JSON.parse(r.before) : null; } catch {}
    try { a = r.after  ? JSON.parse(r.after)  : null; } catch {}
    const friendly = prettyAction(r.action, r.entity, b, a);

    if (actionFilterFriendly && friendly !== actionFilterFriendly) return false;

    const t = r.timestamp ? new Date(r.timestamp) : null;
    if (from && t && t < from) return false;
    if (to && t && t > to) return false;

    if (q) {
      const hay = [
        friendly, r.entity, r.user_name, r.user_id
      ].filter(Boolean).map(x => String(x).toLowerCase());

      try {
        const addl = [];
        [b, a].forEach(o => {
          if (!o) return;
          ['account_number','account_name','journal_entry_id','date','status','total_debit','total_credit','description','username','email','role','name']
            .forEach(k => { if (o[k] != null) addl.push(String(o[k]).toLowerCase()); });
        });
        hay.push(...addl);
      } catch {}

      if (!hay.some(s => s.includes(q))) return false;
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

  slice.forEach(row => {
    let beforeObj = null, afterObj = null;
    try { beforeObj = row.before ? JSON.parse(row.before) : null; } catch {}
    try { afterObj  = row.after  ? JSON.parse(row.after)  : null; } catch {}

    const friendly = prettyAction(row.action, row.entity, beforeObj, afterObj);
    const beforePicked = pickReadableFields(beforeObj);
    const afterPicked  = pickReadableFields(afterObj);
    const changed      = diffKeys(beforePicked || {}, afterPicked || {});

    const card = document.createElement('div');
    card.className = 'log-card';

    const who = row.user_name ?? row.user_id ?? 'N/A';
    const entityLabel = row.entity ? ` • ${titleCase(String(row.entity).replaceAll('_',' '))}` : '';

    // NOTE: we intentionally do NOT show "#id" after the entity to avoid "accounts #45"
    card.innerHTML = `
      <div class="log-meta">
        <span class="${pillClass(friendly)}">${friendly}</span>
        <span class="pill">By: ${who}${entityLabel}</span>
        <span class="pill">${fmtDateTime(row.timestamp)}</span>
      </div>
      <div class="snapshot before"></div>
      <div class="snapshot after"></div>
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
  await resolveTableName();
  await fetchDistinctActions();

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

const viewExpiredBtn = document.getElementById('viewExpired');
const expiredPopup = document.getElementById('expiredPopup');
const expiredList = document.getElementById('expiredList');
const closeExpired = document.getElementById('closeExpired');

// Show expired passwords popup
viewExpiredBtn?.addEventListener('click', async () => {
  expiredList.innerHTML = `<div>Loading expired passwords...</div>`;
  expiredPopup.style.display = 'flex';

  try {
    const { data, error } = await db
      .from('users')
      .select('username, old_passwords');

    if (error) {
      expiredList.innerHTML = `<div style="color:#b91c1c;">Error: ${error.message}</div>`;
      return;
    }

    if (!data || data.length === 0) {
      expiredList.innerHTML = `<div>No users found.</div>`;
      return;
    }

    const frag = document.createDocumentFragment();
    data.forEach(user => {
      const oldPwArray = Array.isArray(user.old_passwords) ? user.old_passwords : [];
      if (oldPwArray.length === 0) return; // skip users with no old passwords

      const wrapper = document.createElement('div');
      wrapper.style.borderBottom = '1px solid #e5e7eb';
      wrapper.style.padding = '0.6rem 0';

      const uname = document.createElement('div');
      uname.style.fontWeight = '600';
      uname.textContent = user.username || '(No username)';
      wrapper.appendChild(uname);

      const pwList = document.createElement('ul');
      pwList.style.marginLeft = '1rem';

      oldPwArray.forEach(pw => {
        const li = document.createElement('li');
        li.textContent = pw;
        pwList.appendChild(li);
      });

      wrapper.appendChild(pwList);
      frag.appendChild(wrapper);
    });


    expiredList.innerHTML = '';
    expiredList.appendChild(frag);

  } catch (err) {
    expiredList.innerHTML = `<div style="color:#b91c1c;">Error loading data: ${err.message}</div>`;
  }
});

// Close popup
closeExpired?.addEventListener('click', () => {
  expiredPopup.style.display = 'none';
});

document.addEventListener('DOMContentLoaded', init);

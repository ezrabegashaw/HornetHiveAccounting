// adminChartOfAccounts.js  (REPLACE THE WHOLE FILE WITH THIS)

// Use the Supabase client from auth.js if available; fallback if needed
let db = window.supabaseClient;
if (!db && window.supabase) {
  const SUPABASE_URL = "https://rsthdogcmqwcdbqppsrm.supabase.co";
  const SUPABASE_ANON_KEY = "your-anon-key-here";
  db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// ---------- DOM ----------
const addBtn = document.getElementById('addAccountBtn');
const popup = document.getElementById('popupOverlay');
const closePopupBtn = document.getElementById('closePopup');
const form = document.getElementById('accountForm');

const deactivateBtn = document.getElementById('deactivateAccountBtn');
const deactivateOverlay = document.getElementById('deactivatePopupOverlay');
const closeDeactivateBtn = document.getElementById('closeDeactivatePopup');
const deactivateForm = document.getElementById('deactivateForm');
const deactivateSelect = document.getElementById('deactivateAccountSelect');

const tableBody = document.getElementById('accountTableBody');
const searchBtn = document.getElementById('searchBtn');
const searchInput = document.getElementById('searchInput');

const ledgerPopup = document.getElementById('ledgerPopup');
const closeLedger = document.getElementById('closeLedger');
const ledgerTitle = document.getElementById('ledgerTitle');
const ledgerBody = document.getElementById('ledgerTableBody');

// ---------- Helpers ----------
function openModal(el){ el.classList.add('show'); }
function closeModal(el){ el.classList.remove('show'); }
function asMoney(n){ return Number(n || 0).toFixed(2); }
function isDigitsOnly(s){ return /^[0-9]+$/.test(String(s || '')); }

// NOTE: Your accounts.user_id is int4 (not the auth UUID). If you don't
// have an app-level numeric user id handy, set this to null (or 0) to
// satisfy the schema.
async function getNumericUserIdOrNull() {
  try {
    // If you have a mapping table from auth uid -> users.id, look it up here.
    // For now, return null to avoid type mismatch on int4.
    return null;
  } catch { return null; }
}

async function logEvent(action, before, after) {
  try {
    await db.from('eventLog').insert([{
      // eventLog schema assumed, adjust if yours differs
      userId: await getNumericUserIdOrNull(),
      timestamp: new Date().toISOString(),
      action,
      before: before ? JSON.stringify(before) : null,
      after: after ? JSON.stringify(after) : null
    }]);
  } catch (e) {
    console.warn('logEvent failed:', e?.message);
  }
}

// ---------- Load Accounts ----------
export async function loadAccounts(searchTerm = "") {
  let query = db.from('accounts').select('*').eq('is_active', true);
  if (searchTerm) {
    query = query.or(`account_name.ilike.%${searchTerm}%,account_number.ilike.%${searchTerm}%`);
  }
  const { data, error } = await query.order('account_number', { ascending: true });

  tableBody.innerHTML = '';
  if (error) {
    console.error("Error loading accounts:", error.message);
    tableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:red;">Error loading data</td></tr>';
    return;
  }
  if (!data?.length) {
    tableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;">No accounts found</td></tr>';
    return;
  }

  data.forEach(acc => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${acc.account_number}</td>
      <td><span class="ledger-link" data-num="${acc.account_number}" data-name="${acc.account_name}">${acc.account_name}</span></td>
      <td>${acc.account_category ?? ''}</td>
      <td>${acc.normal_side ?? ''}</td>
      <td>${asMoney(acc.balance ?? acc.initial_balance ?? 0)}</td>
      <td>${acc.user_id ?? 'N/A'}</td>
      <td>${acc.date_added ? new Date(acc.date_added).toLocaleDateString() : ''}</td>
      <td>${acc.comment || ''}</td>
    `;
    tableBody.appendChild(tr);
  });
}

// ---------- Ledger ----------
async function openLedger(accountNumber, accountName) {
  openModal(ledgerPopup);
  ledgerTitle.textContent = `Ledger for ${accountName} (${accountNumber})`;
  ledgerBody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Loading...</td></tr>';

  const { data, error } = await db
    .from('ledger')
    .select('*')
    .eq('account_number', accountNumber)
    .order('date', { ascending: true });

  if (error) {
    ledgerBody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:red;">Error loading ledger</td></tr>';
    console.error(error.message);
    return;
  }
  if (!data?.length) {
    ledgerBody.innerHTML = '<tr><td colspan="5" style="text-align:center;">No transactions found</td></tr>';
    return;
  }

  ledgerBody.innerHTML = '';
  data.forEach(entry => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${entry.date ? new Date(entry.date).toLocaleDateString() : ''}</td>
      <td>${entry.description || ''}</td>
      <td>${entry.debit ? Number(entry.debit).toFixed(2) : ''}</td>
      <td>${entry.credit ? Number(entry.credit).toFixed(2) : ''}</td>
      <td>${entry.balance ? Number(entry.balance).toFixed(2) : ''}</td>
    `;
    ledgerBody.appendChild(row);
  });
}

// ---------- Populate Deactivate Select ----------
async function populateDeactivateOptions() {
  const { data, error } = await db.from('accounts')
    .select('account_number, account_name')
    .eq('is_active', true)
    .order('account_number');
  deactivateSelect.innerHTML = '<option value="">-- Select an Account --</option>';
  if (error) return;
  (data || []).forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.account_number;
    opt.textContent = `${a.account_number} — ${a.account_name}`;
    deactivateSelect.appendChild(opt);
  });
}

// ---------- Add Account Submit ----------
async function submitAccount(e) {
  e.preventDefault();

  const account = {
    account_name: document.getElementById('account_name').value.trim(),
    account_number: document.getElementById('account_number').value.trim(),
    normal_side: document.getElementById('normal_side').value,
    account_category: document.getElementById('account_category').value.trim(),
    account_subcategory: document.getElementById('account_subcategory').value.trim() || null,
    // numeric columns -> send numbers (Supabase will accept strings but let's be explicit)
    initial_balance: Number(document.getElementById('initial_balance').value || 0),
    // IMPORTANT: your schema uses account_order (varchar) not "order"
    account_order: document.getElementById('account_order').value.trim() || null,
    statement_type: document.getElementById('statement_type').value,
    // IMPORTANT: your schema uses account_description (text) not "description"
    account_description: document.getElementById('account_description').value.trim() || null,
    comment: document.getElementById('comment').value.trim() || null,
    is_active: true,
    date_added: new Date().toISOString(),
    // user_id is int4, so use a numeric id from your app if you have one; otherwise null
    user_id: await getNumericUserIdOrNull()
  };

  // Basic validation
  if (!account.account_name) return alert('Account name is required.');
  if (!isDigitsOnly(account.account_number)) return alert('Account number must be digits only.');
  if (!account.normal_side) return alert('Please choose a Normal Side.');
  if (!account.account_category) return alert('Category is required.');
  if (!account.statement_type) return alert('Please choose a Statement Type.');

  // Duplicate check (name or number)
  const { data: existing, error: dupErr } = await db
    .from('accounts')
    .select('account_name, account_number')
    .or(`account_name.eq.${account.account_name},account_number.eq.${account.account_number}`)
    .limit(1);

  if (dupErr) {
    alert('Error checking duplicates: ' + dupErr.message);
    return;
  }
  if (existing && existing.length) {
    alert('Duplicate account name or number.');
    return;
  }

  // Insert
  const { error } = await db.from('accounts').insert([account]);
  if (error) {
    alert('Error adding account: ' + error.message);
    return;
  }

  await logEvent('add_account', null, account);
  alert('Account added successfully.');

  // Reset & close
  form.reset();
  closeModal(popup);

  // Refresh list
  await loadAccounts(searchInput.value.trim());
}

// ---------- Deactivate Submit ----------
async function submitDeactivate(e) {
  e.preventDefault();
  const acctNum = deactivateSelect.value;
  if (!acctNum) return;

  const { data: before } = await db.from('accounts').select('*').eq('account_number', acctNum).limit(1).maybeSingle();
  const { error } = await db.from('accounts')
    .update({ is_active: false })
    .eq('account_number', acctNum);

  if (error) { alert('Failed to deactivate: ' + error.message); return; }
  await logEvent('deactivate_account', before, { account_number: acctNum, is_active: false });

  alert('Account deactivated.');
  closeModal(deactivateOverlay);
  await loadAccounts(searchInput.value.trim());
}

// ---------- Events ----------
document.addEventListener('DOMContentLoaded', () => {
  // Initial table load
  loadAccounts();

  // Search
  searchBtn?.addEventListener('click', () => {
    loadAccounts(searchInput.value.trim());
  });

  // Open/close Add popup
  addBtn?.addEventListener('click', async () => { openModal(popup); });
  closePopupBtn?.addEventListener('click', () => closeModal(popup));
  popup?.addEventListener('click', (e) => { if (e.target === popup) closeModal(popup); });

  // Submit new account
  form?.addEventListener('submit', submitAccount);

  // Open/close Deactivate popup
  deactivateBtn?.addEventListener('click', async () => {
    await populateDeactivateOptions();
    openModal(deactivateOverlay);
  });
  closeDeactivateBtn?.addEventListener('click', () => closeModal(deactivateOverlay));
  deactivateOverlay?.addEventListener('click', (e) => { if (e.target === deactivateOverlay) closeModal(deactivateOverlay); });
  deactivateForm?.addEventListener('submit', submitDeactivate);

  // Ledger link clicks (event delegation)
  tableBody?.addEventListener('click', (e) => {
    const link = e.target.closest('.ledger-link');
    if (link) {
      const num = link.getAttribute('data-num');
      const name = link.getAttribute('data-name');
      openLedger(num, name);
    }
  });

  // Close ledger
  closeLedger?.addEventListener('click', () => closeModal(ledgerPopup));
  ledgerPopup?.addEventListener('click', (e) => { if (e.target === ledgerPopup) closeModal(ledgerPopup); });
});

// adminChartOfAccounts.js  (REPLACE THE WHOLE FILE WITH THIS)

// Use the Supabase client from auth.js if available; fallback if needed
let db = window.supabaseClient;
if (!db && window.supabase) {
  const SUPABASE_URL = "https://rsthdogcmqwcdbqppsrm.supabase.co";
  const SUPABASE_ANON_KEY = "your-anon-key-here"; // <-- replace with your anon key if needed
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

// (legacy) ledger popup elements (not used when deep-linking to ledger.html)
const ledgerPopup = document.getElementById('ledgerPopup');
const closeLedger = document.getElementById('closeLedger');

function openModal(el){ el?.classList.add('show'); }
function closeModal(el){ el?.classList.remove('show'); }
function asMoney(n){ return Number(n || 0).toFixed(2); }
function isDigitsOnly(s){ return /^[0-9]+$/.test(String(s || '')); }

// If you don’t have a numeric user id in your app, return null for accounts.user_id (int4)
async function getNumericUserIdOrNull() { return null; }

async function logEvent(action, before, after) {
  const { error } = await db.from('eventLog').insert([{
    userId: await getNumericUserIdOrNull(),
    timestamp: new Date().toISOString(),
    action,
    before: before ? JSON.stringify(before) : null,
    after:  after  ? JSON.stringify(after)  : null
  }]);
  if (error) console.warn('logEvent failed:', error.message);
}

// ---------- Load Accounts (Admin) ----------
export async function loadAccounts(searchTerm = "") {
  let query = db.from('v_account_balances')
    .select('*')
    .order('account_number', { ascending: true });

  if (searchTerm) {
    query = db.from('v_account_balances')
      .select('*')
      .or(`account_name.ilike.%${searchTerm}%,account_number.ilike.%${searchTerm}%`)
      .order('account_number', { ascending: true });
  }

  const { data, error } = await query;

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
      <td>
        <!-- ✅ Admin deep-link to ledger.html just like other roles -->
        <a href="ledger.html?account_id=${encodeURIComponent(acc.account_id)}" class="link">
          ${acc.account_name}
        </a>
      </td>
      <td>${acc.account_category ?? ''}</td>
      <td>${acc.normal_side ?? ''}</td>
      <td>${asMoney(acc.computed_balance)}</td>
      <td>${acc.user_id ?? 'N/A'}</td>
      <td>${acc.date_added ? new Date(acc.date_added).toLocaleDateString() : ''}</td>
      <td>${acc.comment || ''}</td>
    `;
    tableBody.appendChild(tr);
  });
}

/* NOTE:
   The ledger page (ledger.html) already renders a clickable posting reference (J-###)
   that links to journal.html?entry_id=###. By sending Admins to ledger.html via the
   account-name link above, Admins now also get “click ref → open journal entry”.
*/

// ---------- Deactivate dropdown ----------
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

// ---------- Add Account ----------
async function submitAccount(e) {
  e.preventDefault();

  const account = {
    account_name: document.getElementById('account_name').value.trim(),
    account_number: document.getElementById('account_number').value.trim(),
    normal_side: document.getElementById('normal_side').value,
    account_category: document.getElementById('account_category').value.trim(),
    account_subcategory: (document.getElementById('account_subcategory').value.trim() || null),
    initial_balance: Number(document.getElementById('initial_balance').value || 0),
    account_order: (document.getElementById('account_order').value.trim() || null),
    statement_type: document.getElementById('statement_type').value,
    account_description: (document.getElementById('account_description').value.trim() || null),
    comment: (document.getElementById('comment').value.trim() || null),
    is_active: true,
    date_added: new Date().toISOString(),
    user_id: await getNumericUserIdOrNull()
  };

  if (!account.account_name) return alert('Account name is required.');
  if (!isDigitsOnly(account.account_number)) return alert('Account number must be digits only.');
  if (!account.normal_side) return alert('Please choose a Normal Side.');
  if (!account.account_category) return alert('Category is required.');
  if (!account.statement_type) return alert('Please choose a Statement Type.');

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

  const { error } = await db.from('accounts').insert([account]);
  if (error) {
    alert('Error adding account: ' + error.message);
    return;
  }

  await logEvent('add_account', null, account);
  alert('Account added successfully.');
  form.reset();
  closeModal(popup);
  await loadAccounts(searchInput.value.trim());
}

// ---------- Deactivate ----------
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
  loadAccounts();

  searchBtn?.addEventListener('click', () => {
    loadAccounts(searchInput.value.trim());
  });
  searchInput?.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') loadAccounts(searchInput.value.trim());
  });

  // Add account popup
  addBtn?.addEventListener('click', () => openModal(popup));
  closePopupBtn?.addEventListener('click', () => closeModal(popup));
  popup?.addEventListener('click', (e) => { if (e.target === popup) closeModal(popup); });
  form?.addEventListener('submit', submitAccount);

  // Deactivate popup
  deactivateBtn?.addEventListener('click', async () => {
    await populateDeactivateOptions();
    openModal(deactivateOverlay);
  });
  closeDeactivateBtn?.addEventListener('click', () => closeModal(deactivateOverlay));
  deactivateOverlay?.addEventListener('click', (e) => { if (e.target === deactivateOverlay) closeModal(deactivateOverlay); });

  // Legacy popup close (not used now)
  closeLedger?.addEventListener('click', () => closeModal(ledgerPopup));
  ledgerPopup?.addEventListener('click', (e) => { if (e.target === ledgerPopup) closeModal(ledgerPopup); });
});

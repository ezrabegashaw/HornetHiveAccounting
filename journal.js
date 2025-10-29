// journal.js

// Supabase client (from auth.js)
const db = window.supabaseClient;

// --- Current user context (role & id) ---
let CURRENT_USER = {
  username: localStorage.getItem("username") || "User",
  id: null,     // users.id (int4)
  role: "accountant" // default; will be loaded from DB
};

document.addEventListener("DOMContentLoaded", async () => {
  await bootstrapUserRole();
  await populateAccountDropdowns();

  document.getElementById("addRowBtn").addEventListener("click", addJournalRow);
  document.getElementById("submitJournalBtn").addEventListener("click", submitJournalEntry);
  document.getElementById("resetJournalBtn").addEventListener("click", resetJournal);
  document.getElementById("statusFilter").addEventListener("change", loadJournalEntries);
  document.getElementById("filterBtn").addEventListener("click", loadJournalEntries);

  // Managers can see Actions column
  if (CURRENT_USER.role === "manager") {
    const actionsHeader = document.getElementById("actionsHeader");
    if (actionsHeader) actionsHeader.style.display = "";
  }

  // Load existing entries
  await loadJournalEntries();
});

async function bootstrapUserRole() {
  // Try to locate user by username in your "users" table
  try {
    const { data, error } = await db
      .from("users")
      .select("id, role, username")
      .eq("username", CURRENT_USER.username)
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      CURRENT_USER.id = data.id;
      CURRENT_USER.role = (data.role || "").toLowerCase(); // 'manager' or 'accountant'
    }
  } catch (e) {
    console.warn("bootstrapUserRole:", e?.message);
  }
}

// -------------------------
// Accounts dropdown support
// -------------------------
let accountOptions = [];

async function populateAccountDropdowns() {
  const { data, error } = await db
    .from("accounts")
    .select("account_id, account_name")
    .eq("is_active", true)
    .order("account_name", { ascending: true });

  if (error) {
    console.error("Error fetching accounts:", error);
    return;
  }

  accountOptions = data || [];
  addJournalRow(); // first row by default
}

function addJournalRow() {
  const tbody = document.getElementById("journalTableBody");
  const row = document.createElement("tr");

  const accountSelect = `<select class="accountSelect">
    <option value="">Select account</option>
    ${accountOptions.map(a => `<option value="${a.account_id}">${a.account_name}</option>`).join("")}
  </select>`;

  row.innerHTML = `
    <td>${accountSelect}</td>
    <td><input type="number" step="0.01" class="debitInput" placeholder="0.00"></td>
    <td><input type="number" step="0.01" class="creditInput" placeholder="0.00"></td>
    <td><input type="text" class="descriptionInput" placeholder="Description"></td>
    <td><button class="removeRowBtn">Remove</button></td>
  `;

  tbody.appendChild(row);
  row.querySelector(".removeRowBtn").addEventListener("click", () => row.remove());
}

function resetJournal() {
  const tbody = document.getElementById("journalTableBody");
  tbody.innerHTML = "";
  addJournalRow();
}

// -------------------------
// Submit journal entry
// -------------------------
async function submitJournalEntry() {
  const rows = document.querySelectorAll("#journalTableBody tr");
  if (!rows.length) return alert("No journal lines to submit.");

  let totalDebit = 0;
  let totalCredit = 0;
  const lines = [];

  for (const row of rows) {
    const accountId = row.querySelector(".accountSelect").value;
    const debit = parseFloat(row.querySelector(".debitInput").value) || 0;
    const credit = parseFloat(row.querySelector(".creditInput").value) || 0;
    const description = row.querySelector(".descriptionInput").value;

    if (!accountId) return alert("All rows must have an account selected.");
    if (debit < 0 || credit < 0) return alert("Amounts cannot be negative.");
    if (debit === 0 && credit === 0) return alert("Each row must have a debit or credit value.");

    totalDebit += debit;
    totalCredit += credit;

    lines.push({ account_id: Number(accountId), debit, credit, description });
  }

  if (Number(totalDebit.toFixed(2)) !== Number(totalCredit.toFixed(2))) {
    return alert("Total debits must equal total credits.");
  }

  // Rule: accountant -> pending, manager -> approved on submit
  const initialStatus = (CURRENT_USER.role === "manager") ? "approved" : "pending";

  const { data: entryData, error: entryError } = await db
    .from("journal_entries")
    .insert([{
      date: new Date().toISOString().slice(0, 10), // YYYY-MM-DD
      status: initialStatus,
      created_by: CURRENT_USER.username,
      total_debit: totalDebit,
      total_credit: totalCredit,
      description: null
    }])
    .select()
    .single();

  if (entryError || !entryData) {
    console.error("Error creating journal entry:", entryError);
    return alert("Failed to create journal entry.");
  }

  const journalEntryId = entryData.entry_id;

  const { error: linesError } = await db.from("journal_lines").insert(
    lines.map(l => ({ ...l, journal_entry_id: journalEntryId, created_at: new Date().toISOString() }))
  );

  if (linesError) {
    console.error("Error creating journal lines:", linesError);
    return alert("Failed to create journal lines.");
  }

  // If manager submitted and it's approved, post immediately
  if (initialStatus === "approved") {
    const postErr = await postApprovedEntryToLedger(journalEntryId);
    if (postErr) {
      console.error("Ledger post failed:", postErr);
      alert("Entry saved but posting to ledger failed. See console.");
    }
  }

  alert(`Journal entry ${initialStatus === "approved" ? "saved & approved" : "submitted for approval"}!`);
  resetJournal();
  loadJournalEntries();
}

// -------------------------
// Manager actions: approve / reject
// -------------------------
async function approveEntry(entryId) {
  // Update status
  const { error: upErr } = await db
    .from("journal_entries")
    .update({ status: "approved" })
    .eq("entry_id", entryId);

  if (upErr) {
    console.error(upErr);
    return alert("Failed to approve entry.");
  }

  // Post to ledger & update balances
  const postErr = await postApprovedEntryToLedger(entryId);
  if (postErr) {
    console.error(postErr);
    return alert("Approved, but ledger update failed. See console.");
  }

  alert("Entry approved and posted to ledger.");
  loadJournalEntries();
}

async function rejectEntry(entryId) {
  const comment = prompt("Enter rejection reason (required):");
  if (!comment || !comment.trim()) {
    return alert("A rejection comment is required.");
  }

  const { error } = await db
    .from("journal_entries")
    .update({ status: "rejected", description: `Rejected by ${CURRENT_USER.username}: ${comment.trim()}` })
    .eq("entry_id", entryId);

  if (error) {
    console.error(error);
    return alert("Failed to reject entry.");
  }

  alert("Entry rejected.");
  loadJournalEntries();
}

// -------------------------
// Ledger posting + balance update
// -------------------------
async function postApprovedEntryToLedger(entryId) {
  try {
    // Pull entry + lines + account details needed for ledger & balances
    const { data: lines, error: lErr } = await db
      .from("journal_lines")
      .select(`
        account_id,
        debit,
        credit,
        description,
        accounts!inner(account_id, account_number, account_name, normal_side, balance)
      `)
      .eq("journal_entry_id", entryId);

    if (lErr) return lErr;

    // Get entry date for ledger rows
    const { data: entry, error: eErr } = await db
      .from("journal_entries")
      .select("date")
      .eq("entry_id", entryId)
      .maybeSingle();

    if (eErr || !entry) return eErr || new Error("Entry not found");

    // For each line:
    for (const line of (lines || [])) {
      const acc = line.accounts;
      let currentBal = Number(acc.balance || 0);
      const lineDebit  = Number(line.debit || 0);
      const lineCredit = Number(line.credit || 0);

      const isDebitNormal = (acc.normal_side || "").toLowerCase() === "debit";
      const delta = isDebitNormal ? (lineDebit - lineCredit) : (lineCredit - lineDebit);
      const newBal = Number((currentBal + delta).toFixed(2));

      // Insert ledger row (now with journal_entry_id)
      const { error: ledErr } = await db.from("ledger").insert([{
        journal_entry_id: entryId,
        account_number: acc.account_number,
        account_name: acc.account_name,
        date: entry.date,                                  // DATE column
        description: line.description || `Journal #${entryId}`,
        debit: lineDebit || null,
        credit: lineCredit || null,
        balance: newBal,
        created_at: new Date().toISOString()
      }]);
      if (ledErr) return ledErr;

      // Update account balance
      const { error: balErr } = await db
        .from("accounts")
        .update({ balance: newBal })
        .eq("account_id", acc.account_id);
      if (balErr) return balErr;

      currentBal = newBal; // next line for same account uses updated balance
    }

    return null; // success
  } catch (e) {
    return e;
  }
}


// -------------------------
// Load journal entries (with manager actions)
// -------------------------
async function loadJournalEntries() {
  const status = document.getElementById("statusFilter").value || "pending";
  const startDate = document.getElementById("startDate").value;
  const endDate = document.getElementById("endDate").value;

  let query = db.from("journal_entries").select(`
    entry_id,
    date,
    status,
    total_debit,
    total_credit,
    description,
    journal_lines (
      account_id,
      debit,
      credit,
      description,
      accounts!inner(account_name)
    )
  `);

  if (status !== "all") query = query.eq("status", status);
  if (startDate) query = query.gte("date", startDate);
  if (endDate) query = query.lte("date", endDate);

  const { data, error } = await query.order("date", { ascending: false });

  const tbody = document.getElementById("journalEntriesTableBody");
  tbody.innerHTML = "";

  if (error) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:red;text-align:center;">Error loading entries</td></tr>`;
    console.error(error);
    return;
  }

  if (!data?.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;">No entries found</td></tr>`;
    return;
  }

  data.forEach(entry => {
    const linesHtml = (entry.journal_lines || [])
      .map(l => `${l.accounts.account_name}: D ${Number(l.debit||0).toFixed(2)} / C ${Number(l.credit||0).toFixed(2)}`)
      .join("<br>");

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${new Date(entry.date).toLocaleDateString()}</td>
      <td>${entry.status}${entry.status === 'rejected' && entry.description ? ` — ${escapeHtml(entry.description)}` : ""}</td>
      <td>${Number(entry.total_debit).toFixed(2)}</td>
      <td>${Number(entry.total_credit).toFixed(2)}</td>
      <td>${linesHtml}</td>
      <td><a href="journal.html?entry_id=${entry.entry_id}">View</a></td>
      <td class="mgrActions" style="display:${CURRENT_USER.role === "manager" ? "" : "none"};">
        ${entry.status === "pending" ? actionButtons(entry.entry_id) : ""}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function actionButtons(entryId) {
  // Small inline comment input + Approve/Reject buttons (manager only)
  // We'll delegate click handlers below
  return `
    <div style="display:flex;gap:.35rem;flex-wrap:wrap;align-items:center">
      <input type="text" placeholder="Comment (for reject)" data-comment-for="${entryId}" style="max-width:220px">
      <button class="btn btn-approve" data-approve="${entryId}">Approve</button>
      <button class="btn btn-reject" data-reject="${entryId}">Reject</button>
    </div>
  `;
}

// Delegate clicks for approve/reject
document.addEventListener("click", (e) => {
  const approveBtn = e.target.closest("[data-approve]");
  const rejectBtn  = e.target.closest("[data-reject]");
  if (approveBtn) {
    const entryId = Number(approveBtn.getAttribute("data-approve"));
    approveEntry(entryId);
  }
  if (rejectBtn) {
    const entryId = Number(rejectBtn.getAttribute("data-reject"));
    const input = document.querySelector(`[data-comment-for="${entryId}"]`);
    const comment = input ? input.value : "";
    if (!comment || !comment.trim()) {
      return alert("Please enter a rejection comment.");
    }
    // Temporarily store comment via prompt path (reuses function)
    // We’ll pass it through prompt to reuse validation/UI
    // But we can directly call rejectEntry with prompt override:
    const originalPrompt = window.prompt;
    window.prompt = () => comment;
    rejectEntry(entryId).finally(() => { window.prompt = originalPrompt; });
  }
});

// -------------------------
// Utils
// -------------------------
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, m =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])
  );
}

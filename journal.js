// journal.js

const db = window.supabaseClient;

document.addEventListener("DOMContentLoaded", async () => {
  // Initialize
  await populateAccountDropdowns();
  document.getElementById("addRowBtn").addEventListener("click", addJournalRow);
  document.getElementById("submitJournalBtn").addEventListener("click", submitJournalEntry);
  document.getElementById("resetJournalBtn").addEventListener("click", resetJournal);
  document.getElementById("statusFilter").addEventListener("change", loadJournalEntries);
  document.getElementById("filterBtn").addEventListener("click", loadJournalEntries);

  // Load existing entries
  await loadJournalEntries();
});

let accountOptions = [];

// -------------------------
// Populate accounts dropdown
// -------------------------
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

  accountOptions = data;

  // Add first row on load
  addJournalRow();
}

// -------------------------
// Add a new journal line row
// -------------------------
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

  row.querySelector(".removeRowBtn").addEventListener("click", () => {
    row.remove();
  });
}

// -------------------------
// Reset journal form
// -------------------------
function resetJournal() {
  const tbody = document.getElementById("journalTableBody");
  tbody.innerHTML = "";
  addJournalRow();
}

// -------------------------
// Validate and submit journal
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

    lines.push({ account_id: accountId, debit, credit, description });
  }

  if (totalDebit !== totalCredit) return alert("Total debits must equal total credits.");

  // Insert journal entry
  const { data: entryData, error: entryError } = await db.from("journal_entries").insert([{
    date: new Date().toISOString(),
    status: "pending",
    created_by: localStorage.getItem("username") || "Accountant",
    total_debit: totalDebit,
    total_credit: totalCredit,
  }]).select().single();

  if (entryError) {
    console.error("Error creating journal entry:", entryError);
    return alert("Failed to create journal entry.");
  }

  const journalEntryId = entryData.entry_id;

  // Insert journal lines
  const { error: linesError } = await db.from("journal_lines").insert(
    lines.map(l => ({ ...l, journal_entry_id: journalEntryId }))
  );

  if (linesError) {
    console.error("Error creating journal lines:", linesError);
    return alert("Failed to create journal lines.");
  }

  alert("Journal entry submitted successfully!");
  resetJournal();
  loadJournalEntries();
}

// -------------------------
// Load journal entries (search/filter)
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
    tbody.innerHTML = `<tr><td colspan="6" style="color:red;text-align:center;">Error loading entries</td></tr>`;
    console.error(error);
    return;
  }

  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;">No entries found</td></tr>`;
    return;
  }

  data.forEach(entry => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${new Date(entry.date).toLocaleDateString()}</td>
      <td>${entry.status}</td>
      <td>${entry.total_debit.toFixed(2)}</td>
      <td>${entry.total_credit.toFixed(2)}</td>
      <td>
        ${entry.journal_lines.map(l => `${l.accounts.account_name}: D ${l.debit.toFixed(2)} / C ${l.credit.toFixed(2)}`).join("<br>")}
      </td>
      <td><a href="journal.html?entry_id=${entry.entry_id}">View</a></td>
    `;
    tbody.appendChild(row);
  });
}

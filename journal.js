// journal.js
const db = window.supabaseClient;

// --- Current user context (role & id) ---
let CURRENT_USER = {
  username: localStorage.getItem("username") || "User",
  id: null,
  role: "accountant"
};

document.addEventListener("DOMContentLoaded", async () => {
  await bootstrapUserRole();
  await populateAccountDropdowns();

  // Compose events (entry form)
  document.getElementById("addRowBtn").addEventListener("click", addJournalRow);
  document.getElementById("submitJournalBtn").addEventListener("click", submitJournalEntry);
  document.getElementById("resetJournalBtn").addEventListener("click", resetJournal);

  // Filters (any field can be blank)
  document.getElementById("filterBtn")?.addEventListener("click", () => loadJournalEntries(false));
  document.getElementById("clearBtn")?.addEventListener("click", () => {
    const sf = document.getElementById("statusFilter"); if (sf) sf.value = "all";
    const sd = document.getElementById("startDate"); if (sd) sd.value = "";
    const ed = document.getElementById("endDate");   if (ed) ed.value = "";
    const es = document.getElementById("entrySearch"); if (es) es.value = "";
    loadJournalEntries(true); // show all
  });

  // Search (submitted section)
  document.getElementById("searchBtn")?.addEventListener("click", () => loadJournalEntries(false));
  document.getElementById("entrySearch")?.addEventListener("keyup", (e) => {
    if (e.key === "Enter") loadJournalEntries(false);
  });

  // Managers can see Actions column
  if (CURRENT_USER.role === "manager") {
    const actionsHeader = document.getElementById("actionsHeader");
    if (actionsHeader) actionsHeader.style.display = "";
  }

  // If opened as a PR deep-link (?entry_id=...), switch to "detail view"
  const params = new URLSearchParams(window.location.search);
  const entryId = params.get("entry_id");
  if (entryId) {
    await renderJournalDetailOnly(entryId);
  } else {
    // Normal page load -> show ALL entries initially
    await loadJournalEntries(true);
  }
});

async function bootstrapUserRole() {
  try {
    const { data, error } = await db
      .from("users")
      .select("id, role, username")
      .eq("username", CURRENT_USER.username)
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      CURRENT_USER.id = data.id;
      CURRENT_USER.role = (data.role || "").toLowerCase();
    }
  } catch (e) {
    console.warn("bootstrapUserRole:", e?.message);
  }
}

let accountOptions = [];
async function populateAccountDropdowns() {
  const { data, error } = await db
    .from("accounts")
    .select("account_id, account_name")
    .eq("is_active", true)
    .order("account_name");

  if (!error && data) accountOptions = data;
  addJournalRow();
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

async function submitJournalEntry() {
  const rows = document.querySelectorAll("#journalTableBody tr");
  if (!rows.length) return alert("No journal lines to submit.");

  let totalDebit = 0, totalCredit = 0;
  const lines = [];

  for (const row of rows) {
    const accountId = row.querySelector(".accountSelect").value;
    const debit = parseFloat(row.querySelector(".debitInput").value) || 0;
    const credit = parseFloat(row.querySelector(".creditInput").value) || 0;
    const description = row.querySelector(".descriptionInput").value;

    if (!accountId) return alert("All rows must have an account selected.");
    if (debit === 0 && credit === 0) return alert("Each row must have a debit or credit value.");

    totalDebit += debit;
    totalCredit += credit;
    lines.push({ account_id: Number(accountId), debit, credit, description });
  }

  if (Number(totalDebit.toFixed(2)) !== Number(totalCredit.toFixed(2))) {
    return alert("Total debits must equal total credits.");
  }

  const initialStatus = (CURRENT_USER.role === "manager") ? "approved" : "pending";

  const { data: entryData, error: entryError } = await db
    .from("journal_entries")
    .insert([{
      date: new Date().toISOString().slice(0, 10),
      status: initialStatus,
      created_by: CURRENT_USER.username,
      total_debit: totalDebit,
      total_credit: totalCredit
    }])
    .select()
    .single();

  if (entryError || !entryData) return alert("Failed to create journal entry.");
  const journalEntryId = entryData.entry_id;

  const { error: linesError } = await db.from("journal_lines").insert(
    lines.map(l => ({ ...l, journal_entry_id: journalEntryId, created_at: new Date().toISOString() }))
  );
  if (linesError) return alert("Failed to create journal lines.");

  if (initialStatus === "approved") {
    await postApprovedEntryToLedger(journalEntryId);
  }

  alert(`Journal entry ${initialStatus === "approved" ? "saved & approved" : "submitted for approval"}!`);
  resetJournal();
  loadJournalEntries(true);
}

async function approveEntry(entryId) {
  const { error: upErr } = await db
    .from("journal_entries")
    .update({ status: "approved" })
    .eq("entry_id", entryId);

  if (upErr) return alert("Failed to approve entry.");
  await postApprovedEntryToLedger(entryId);

  alert("Entry approved and posted to ledger.");
  loadJournalEntries(false);
}

async function rejectEntry(entryId) {
  const comment = prompt("Enter rejection reason (required):");
  if (!comment?.trim()) return alert("A rejection comment is required.");

  const { error } = await db
    .from("journal_entries")
    .update({ status: "rejected", description: `Rejected by ${CURRENT_USER.username}: ${comment.trim()}` })
    .eq("entry_id", entryId);

  if (error) return alert("Failed to reject entry.");
  alert("Entry rejected.");
  loadJournalEntries(false);
}

async function postApprovedEntryToLedger(entryId) {
  try {
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

    const { data: entry } = await db
      .from("journal_entries")
      .select("date")
      .eq("entry_id", entryId)
      .maybeSingle();

    for (const line of lines) {
      const acc = line.accounts;
      let currentBal = Number(acc.balance || 0);
      const isDebitNormal = (acc.normal_side || "").toLowerCase() === "debit";
      const delta = isDebitNormal
        ? (Number(line.debit || 0) - Number(line.credit || 0))
        : (Number(line.credit || 0) - Number(line.debit || 0));
      const newBal = Number((currentBal + delta).toFixed(2));

      await db.from("ledger").insert([{
        journal_entry_id: entryId,                // <-- PR back-link
        account_number: acc.account_number,
        account_name: acc.account_name,
        date: entry.date,
        description: line.description || `Journal #${entryId}`,
        debit: line.debit || null,
        credit: line.credit || null,
        balance: newBal,
        created_at: new Date().toISOString()
      }]);

      await db.from("accounts").update({ balance: newBal }).eq("account_id", acc.account_id);
    }
  } catch (e) { return e; }
}

// -------------------------
// Load journal entries (filters + search)
// -------------------------
async function loadJournalEntries(showAll) {
  // Read filters (exist only on the normal page, not in detail view)
  const status = showAll ? "all" : (document.getElementById("statusFilter")?.value || "all");
  const startDate = document.getElementById("startDate")?.value || "";
  const endDate   = document.getElementById("endDate")?.value   || "";
  const searchRaw = (document.getElementById("entrySearch")?.value || "").trim();
  const search = searchRaw.toLowerCase();

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
  if (endDate)   query = query.lte("date", endDate);

  const { data, error } = await query.order("date", { ascending: false });

  const tbody = document.getElementById("journalEntriesTableBody");
  if (!tbody) return; // when in detail view, this section is removed
  tbody.innerHTML = "";

  if (error) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:red;text-align:center;">Error loading entries</td></tr>`;
    return;
  }

  let rows = data || [];

  // client-side search: account name, amount, or date
  if (search) {
    const isNumeric = !isNaN(Number(search));
    rows = rows.filter(e => {
      const dateIso = e.date || "";
      const dateLocal = e.date ? new Date(e.date).toLocaleDateString().toLowerCase() : "";
      const dateMatch = dateIso.includes(search) || dateLocal.includes(search);

      const lines = e.journal_lines || [];
      const lineText = lines.map(l => (l.accounts?.account_name || "").toLowerCase()).join(" ");
      const nameMatch = lineText.includes(search);

      let amountMatch = false;
      if (isNumeric) {
        const target = Number(search).toFixed(2);
        if (
          Number(e.total_debit || 0).toFixed(2) === target ||
          Number(e.total_credit || 0).toFixed(2) === target
        ) {
          amountMatch = true;
        } else {
          amountMatch = lines.some(l =>
            Number(l.debit || 0).toFixed(2) === target ||
            Number(l.credit || 0).toFixed(2) === target
          );
        }
      }
      return dateMatch || nameMatch || amountMatch;
    });
  }

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;">No entries found</td></tr>`;
    return;
  }

  rows.forEach(entry => {
    const linesHtml = (entry.journal_lines || [])
      .map(l => `${l.accounts.account_name}: D ${Number(l.debit||0).toFixed(2)} / C ${Number(l.credit||0).toFixed(2)}`)
      .join("<br>");

    const canAct = CURRENT_USER.role === "manager" && entry.status === "pending";

    const tr = document.createElement("tr");
    tr.style.backgroundColor =
      entry.status === "approved" ? "#e7f7eb" : entry.status === "rejected" ? "#fde8e8" : "transparent";

    tr.innerHTML = `
      <td>${entry.date ? new Date(entry.date).toLocaleDateString() : ""}</td>
      <td>${entry.status}</td>
      <td>${Number(entry.total_debit).toFixed(2)}</td>
      <td>${Number(entry.total_credit).toFixed(2)}</td>
      <td>${linesHtml}</td>
      <td><a href="journal.html?entry_id=${entry.entry_id}">View</a></td>
      <td style="display:${CURRENT_USER.role === "manager" ? "" : "none"};">
        ${canAct ? actionButtons(entry.entry_id) : ""}
      </td>`;
    tbody.appendChild(tr);
  });
}

// -------------------------
// PR deep-link: show ONLY the single journal
// -------------------------
async function renderJournalDetailOnly(entryId) {
  // Remove the “Submitted Journal Entries” section & the compose buttons
  document.getElementById("submittedSection")?.remove();
  document.querySelector(".form-actions")?.remove();

  // Retitle the page
  const topTitle = document.getElementById("journalTopTitle");
  if (topTitle) topTitle.textContent = `Journal Entry #${entryId}`;
  document.title = `Journal Entry #${entryId}`;

  // Render the entry lines (read-only)
  const tbody = document.getElementById("journalTableBody");
  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;">Loading entry...</td></tr>`;

  const { data, error } = await db
    .from("journal_lines")
    .select(`
      debit, credit, description,
      accounts!inner(account_name)
    `)
    .eq("journal_entry_id", entryId);

  if (error || !data?.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:red;">No data found</td></tr>`;
    return;
  }

  tbody.innerHTML = "";
  data.forEach(line => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${line.accounts.account_name}</td>
      <td>${line.debit ? Number(line.debit).toFixed(2) : ""}</td>
      <td>${line.credit ? Number(line.credit).toFixed(2) : ""}</td>
      <td>${line.description || ""}</td>
      <td class="muted">—</td>`;
    tbody.appendChild(tr);
  });
}

function actionButtons(entryId) {
  return `
    <div style="display:flex;gap:.35rem;flex-wrap:wrap;align-items:center">
      <input type="text" placeholder="Comment (for reject)" data-comment-for="${entryId}" style="max-width:220px">
      <button class="btn btn-approve" data-approve="${entryId}">Approve</button>
      <button class="btn btn-reject" data-reject="${entryId}">Reject</button>
    </div>`;
}

// Approve/Reject button handling (only on the normal list view)
document.addEventListener("click", e => {
  const approveBtn = e.target.closest("[data-approve]");
  const rejectBtn = e.target.closest("[data-reject]");
  if (approveBtn) approveEntry(Number(approveBtn.getAttribute("data-approve")));
  if (rejectBtn) {
    const entryId = Number(rejectBtn.getAttribute("data-reject"));
    const input = document.querySelector(`[data-comment-for="${entryId}"]`);
    const comment = input?.value;
    if (!comment?.trim()) return alert("Please enter a rejection comment.");
    const originalPrompt = window.prompt;
    window.prompt = () => comment;
    rejectEntry(entryId).finally(() => { window.prompt = originalPrompt; });
  }
}
);

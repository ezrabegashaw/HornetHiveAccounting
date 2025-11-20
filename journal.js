// journal.js — with built-in event logging for journal + ledger

const db = window.supabaseClient;

// -----------------------------
// Simple event log helper (matches your table definition)
// -----------------------------
async function logEvent({ action, entity, entityId, before, after }) {
  if (!db) {
    alert("logEvent: supabaseClient is not available.");
    return;
  }

  const username =
    (window.CURRENT_USER && CURRENT_USER.username) ||
    localStorage.getItem("username") ||
    "N/A";
  const userId = (window.CURRENT_USER && CURRENT_USER.id) || null;

  const row = {
    action: action || "Event",             // text NOT NULL
    entity: entity || "Unknown",           // text NOT NULL (your table requires this)
    entity_id: entityId != null ? String(entityId) : null, // your column is text
    user_name: username,
    user_id: userId != null ? String(userId) : null,
    // timestamp has a DEFAULT in your table, so we can omit it OR set it
    // If we leave it out, Postgres will use now()
    before: before || null,                // jsonb
    after: after || null,                  // jsonb
  };

  try {
    const { error } = await db.from("event_log").insert([row]);
    if (error) {
      console.error("Error inserting into event_log:", error);
      alert("Error logging event: " + error.message);
    } else {
      console.log("Event logged:", row);
    }
  } catch (e) {
    console.error("Unexpected error logging event:", e);
    alert("Unexpected error logging event: " + (e.message || e));
  }
}


// --- Money formatting helper ---
function fmtMoney(value) {
  const num = Number(value || 0);
  return "$" + num.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// --- Current user context (role & id) ---
let CURRENT_USER = {
  username: localStorage.getItem("username") || "User",
  id: null,
  role: "accountant",
};

document.addEventListener("DOMContentLoaded", async () => {
  await bootstrapUserRole();
  await populateAccountDropdowns();

  // Compose events (entry form)
  document.getElementById("addRowBtn").addEventListener("click", addJournalRow);
  document
    .getElementById("submitJournalBtn")
    .addEventListener("click", submitJournalEntry);
  document
    .getElementById("resetJournalBtn")
    .addEventListener("click", resetJournal);

  // Filters (any field can be blank)
  document.getElementById("filterBtn")?.addEventListener("click", () =>
    loadJournalEntries(false)
  );
  document.getElementById("clearBtn")?.addEventListener("click", () => {
    const sf = document.getElementById("statusFilter");
    if (sf) sf.value = "all";
    const sd = document.getElementById("startDate");
    if (sd) sd.value = "";
    const ed = document.getElementById("endDate");
    if (ed) ed.value = "";
    const es = document.getElementById("entrySearch");
    if (es) es.value = "";
    loadJournalEntries(true); // show all
  });

  // Search (submitted section)
  document.getElementById("searchBtn")?.addEventListener("click", () =>
    loadJournalEntries(false)
  );
  document
    .getElementById("entrySearch")
    ?.addEventListener("keyup", (e) => {
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

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

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

  const accountSelect = document.createElement("select");
  accountSelect.className = "accountSelect";
  accountSelect.innerHTML = `<option value="">Select account</option>`;
  accountOptions.forEach((a) => {
    const opt = document.createElement("option");
    opt.value = String(a.account_id);
    opt.textContent = a.account_name;
    accountSelect.appendChild(opt);
  });

  const debit = document.createElement("input");
  debit.type = "number";
  debit.step = "0.01";
  debit.className = "debitInput";
  debit.placeholder = "0.00";

  const credit = document.createElement("input");
  credit.type = "number";
  credit.step = "0.01";
  credit.className = "creditInput";
  credit.placeholder = "0.00";

  const desc = document.createElement("input");
  desc.type = "text";
  desc.className = "descriptionInput";
  desc.placeholder = "Description";

  const removeBtn = document.createElement("button");
  removeBtn.className = "removeRowBtn";
  removeBtn.type = "button";
  removeBtn.textContent = "Remove";

  const td1 = document.createElement("td");
  td1.appendChild(accountSelect);
  const td2 = document.createElement("td");
  td2.appendChild(debit);
  const td3 = document.createElement("td");
  td3.appendChild(credit);
  const td4 = document.createElement("td");
  td4.appendChild(desc);
  const td5 = document.createElement("td");
  td5.appendChild(removeBtn);

  row.append(td1, td2, td3, td4, td5);
  tbody.appendChild(row);

  accountSelect.addEventListener("change", () => {
    refreshAccountSelectOptions();
  });

  removeBtn.addEventListener("click", () => {
    row.remove();
    refreshAccountSelectOptions();
  });

  refreshAccountSelectOptions();
}

function resetJournal() {
  const tbody = document.getElementById("journalTableBody");
  tbody.innerHTML = "";
  addJournalRow();

  const box = document.getElementById("journalErrors");
  if (box) {
    box.style.display = "none";
    box.innerHTML = "";
  }
}

function getAllRows() {
  return Array.from(document.querySelectorAll("#journalTableBody tr"));
}

function getSelectedAccountIds() {
  const ids = [];
  getAllRows().forEach((r) => {
    const val = r.querySelector(".accountSelect")?.value || "";
    if (val) ids.push(val);
  });
  return ids;
}

/**
 * Keep already-selected accounts from appearing in other row dropdowns.
 * Each select always keeps its own current value visible.
 */
function refreshAccountSelectOptions() {
  const rows = getAllRows();
  const selected = getSelectedAccountIds(); // strings

  rows.forEach((r) => {
    const sel = r.querySelector(".accountSelect");
    if (!sel) return;
    const current = sel.value;

    const taken = new Set(selected.filter((id) => id !== current));
    const previous = current;

    sel.innerHTML = `<option value="">Select account</option>`;
    accountOptions.forEach((a) => {
      const id = String(a.account_id);
      if (taken.has(id)) return;
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = a.account_name;
      sel.appendChild(opt);
    });

    if (previous && Array.from(sel.options).some((o) => o.value === previous)) {
      sel.value = previous;
    } else if (previous) {
      sel.value = "";
    }
  });
}

/**
 * Validate the journal entry.
 */
function validateJournal(render = false) {
  const errors = [];
  const rows = getAllRows();
  const errorBox = document.getElementById("journalErrors");

  if (!rows.length) {
    errors.push("Add at least one journal line.");
  }

  const seenAccounts = new Set();
  let totalDebit = 0;
  let totalCredit = 0;
  let seenCreditAlready = false;

  rows.forEach((row, idx) => {
    const lineNum = idx + 1;
    const sel = row.querySelector(".accountSelect");
    const debitEl = row.querySelector(".debitInput");
    const creditEl = row.querySelector(".creditInput");

    const accountId = sel?.value || "";
    const d = parseFloat(debitEl?.value || "0") || 0;
    const c = parseFloat(creditEl?.value || "0") || 0;

    if (!accountId) {
      errors.push(`Line ${lineNum}: select an account.`);
    }

    const hasDebit = d > 0;
    const hasCredit = c > 0;

    if ((hasDebit && hasCredit) || (!hasDebit && !hasCredit)) {
      errors.push(
        `Line ${lineNum}: enter either a positive Debit OR a positive Credit (not both).`
      );
    }

    if (hasCredit) {
      seenCreditAlready = true;
    } else if (hasDebit && seenCreditAlready) {
      errors.push(
        `Line ${lineNum}: Debits must be listed before credits. Move this debit line above all credit lines.`
      );
    }

    totalDebit += d;
    totalCredit += c;

    if (accountId) {
      if (seenAccounts.has(accountId)) {
        errors.push(`Line ${lineNum}: account is used more than once in this entry.`);
      } else {
        seenAccounts.add(accountId);
      }
    }
  });

  if (rows.length) {
    const d = Number(totalDebit.toFixed(2));
    const c = Number(totalCredit.toFixed(2));
    if (d !== c) {
      errors.push(
        `Debits and Credits must balance. Current totals: Debit ${d.toFixed(
          2
        )} vs Credit ${c.toFixed(2)}.`
      );
    }
  }

  if (render && errorBox) {
    if (errors.length) {
      errorBox.style.display = "block";
      errorBox.innerHTML = `
        <div class="title">Please fix the following:</div>
        <ul>${errors.map((e) => `<li>${e}</li>`).join("")}</ul>
      `;
      errorBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } else {
      errorBox.style.display = "none";
      errorBox.innerHTML = "";
    }
  }

  return { ok: errors.length === 0, errors };
}

// =========================
// SUBMIT JOURNAL ENTRY
// =========================
async function submitJournalEntry() {
  const { ok } = validateJournal(true);
  if (!ok) return;

  const rows = document.querySelectorAll("#journalTableBody tr");
  let totalDebit = 0,
    totalCredit = 0;
  const lines = [];

  for (const row of rows) {
    const accountId = row.querySelector(".accountSelect").value;
    const debit = parseFloat(row.querySelector(".debitInput").value) || 0;
    const credit = parseFloat(row.querySelector(".creditInput").value) || 0;
    const description = row.querySelector(".descriptionInput").value;

    totalDebit += debit;
    totalCredit += credit;
    lines.push({ account_id: Number(accountId), debit, credit, description });
  }

  // ✅ ALWAYS pending (manager and accountant)
  const initialStatus = "pending";

  const { data: entryData, error: entryError } = await db
    .from("journal_entries")
    .insert([
      {
        date: new Date().toISOString().slice(0, 10),
        status: initialStatus,
        created_by: CURRENT_USER.username,
        total_debit: totalDebit,
        total_credit: totalCredit,
      },
    ])
    .select()
    .single();

  if (entryError || !entryData) {
    const box = document.getElementById("journalErrors");
    if (box) {
      box.style.display = "block";
      box.innerHTML = `<div class="title">Save failed:</div><ul><li>${
        entryError?.message || "Failed to create journal entry."
      }</li></ul>`;
    } else {
      alert("Failed to create journal entry.");
    }
    return;
  }

  const journalEntryId = entryData.entry_id;

  const { error: linesError } = await db
    .from("journal_lines")
    .insert(
      lines.map((l) => ({
        ...l,
        journal_entry_id: journalEntryId,
        created_at: new Date().toISOString(),
      }))
    );
  if (linesError) {
    const box = document.getElementById("journalErrors");
    if (box) {
      box.style.display = "block";
      box.innerHTML = `<div class="title">Save failed:</div><ul><li>${linesError.message}</li></ul>`;
    } else {
      alert("Failed to create journal lines.");
    }
    return;
  }

  // Attachments
  const fileInput = document.getElementById("sourceDocs");
  if (fileInput?.files?.length) {
    const files = Array.from(fileInput.files);
    const uploads = [];

    for (const file of files) {
      const base64 = await toBase64(file);
      uploads.push({
        journal_entry_id: journalEntryId,
        file_name: file.name,
        file_url: base64,
      });
    }

    const { error: attachErr } = await db
      .from("journal_attachments")
      .insert(uploads);

    if (attachErr) console.error("Attachment upload failed:", attachErr);
  }

  // 🔹 Log creation event
  await logEvent({
    action: "Journal Entry Submitted",
    entity: "Journal Entry",
    entityId: journalEntryId,
    before: null,
    after: entryData,
  });

  resetJournal();
  const box = document.getElementById("journalErrors");
  if (box) {
    box.style.display = "none";
    box.innerHTML = "";
  }
  alert("Journal entry submitted for approval!");
  loadJournalEntries(true);
}

// =========================
// APPROVE ENTRY
// =========================
async function approveEntry(entryId) {
  // BEFORE snapshot
  const { data: beforeEntry } = await db
    .from("journal_entries")
    .select("*")
    .eq("entry_id", entryId)
    .maybeSingle();

  const { error: upErr } = await db
    .from("journal_entries")
    .update({ status: "approved" })
    .eq("entry_id", entryId);

  if (upErr) {
    alert("Failed to approve entry.");
    return;
  }

  // AFTER snapshot
  const { data: afterEntry } = await db
    .from("journal_entries")
    .select("*")
    .eq("entry_id", entryId)
    .maybeSingle();

  // Log event
  await logEvent({
    action: "Journal Entry Approved",
    entity: "Journal Entry",
    entityId: entryId,
    before: beforeEntry || null,
    after: afterEntry || null,
  });

  await postApprovedEntryToLedger(entryId);

  alert("Entry approved and posted to ledger.");
  loadJournalEntries(false);
}

// =========================
// REJECT ENTRY
// =========================
async function rejectEntry(entryId) {
  const comment = prompt("Enter rejection reason (required):");
  if (!comment?.trim()) {
    alert("A rejection comment is required.");
    return;
  }

  // BEFORE snapshot
  const { data: beforeEntry } = await db
    .from("journal_entries")
    .select("*")
    .eq("entry_id", entryId)
    .maybeSingle();

  const { error } = await db
    .from("journal_entries")
    .update({
      status: "rejected",
      description: `Rejected by ${CURRENT_USER.username}: ${comment.trim()}`,
    })
    .eq("entry_id", entryId);

  if (error) {
    alert("Failed to reject entry.");
    return;
  }

  // AFTER snapshot
  const { data: afterEntry } = await db
    .from("journal_entries")
    .select("*")
    .eq("entry_id", entryId)
    .maybeSingle();

  await logEvent({
    action: "Journal Entry Rejected",
    entity: "Journal Entry",
    entityId: entryId,
    before: beforeEntry || null,
    after: afterEntry || null,
  });

  alert("Entry rejected.");
  loadJournalEntries(false);
}

async function postApprovedEntryToLedger(entryId) {
  try {
    const { data: lines, error: lErr } = await db
      .from("journal_lines")
      .select(
        `
        account_id,
        debit,
        credit,
        description,
        accounts!inner(account_id, account_number, account_name, normal_side, balance)
      `
      )
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
      const isDebitNormal =
        (acc.normal_side || "").toLowerCase() === "debit";
      const delta = isDebitNormal
        ? Number(line.debit || 0) - Number(line.credit || 0)
        : Number(line.credit || 0) - Number(line.debit || 0);
      const newBal = Number((currentBal + delta).toFixed(2));

      const ledgerRow = {
        journal_entry_id: entryId,
        account_number: acc.account_number,
        account_name: acc.account_name,
        date: entry.date,
        description: line.description || `Journal #${entryId}`,
        debit: line.debit || null,
        credit: line.credit || null,
        balance: newBal,
        created_at: new Date().toISOString(),
      };

      await db.from("ledger").insert([ledgerRow]);

      await db
        .from("accounts")
        .update({ balance: newBal })
        .eq("account_id", acc.account_id);

      // Log ledger change
      await logEvent({
        action: "Ledger Posted",
        entity: "Ledger",
        entityId: entryId,
        before: {
          account_id: acc.account_id,
          previous_balance: currentBal,
        },
        after: {
          account_id: acc.account_id,
          new_balance: newBal,
          journal_entry_id: entryId,
          debit: line.debit || 0,
          credit: line.credit || 0,
        },
      });
    }
  } catch (e) {
    return e;
  }
}

// -------------------------
// Load journal entries (filters + search)
// -------------------------
async function loadJournalEntries(showAll) {
  const status = showAll
    ? "all"
    : document.getElementById("statusFilter")?.value || "all";
  const startDate = document.getElementById("startDate")?.value || "";
  const endDate = document.getElementById("endDate")?.value || "";
  const searchRaw =
    (document.getElementById("entrySearch")?.value || "").trim();
  const search = searchRaw.toLowerCase();

  let query = db.from("journal_entries").select(
    `
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
  `
  );

  if (status !== "all") query = query.eq("status", status);
  if (startDate) query = query.gte("date", startDate);
  if (endDate) query = query.lte("date", endDate);

  const { data, error } = await query.order("date", { ascending: false });

  const tbody = document.getElementById("journalEntriesTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (error) {
    tbody.innerHTML =
      '<tr><td colspan="7" style="color:red;text-align:center;">Error loading entries</td></tr>';
    return;
  }

  let rows = data || [];

  if (search) {
    const isNumeric = !isNaN(Number(search));
    rows = rows.filter((e) => {
      const dateIso = e.date || "";
      const dateLocal = e.date
        ? new Date(e.date).toLocaleDateString().toLowerCase()
        : "";
      const dateMatch =
        dateIso.includes(search) || dateLocal.includes(search);

      const lines = e.journal_lines || [];
      const lineText = lines
        .map((l) => (l.accounts?.account_name || "").toLowerCase())
        .join(" ");
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
          amountMatch = lines.some(
            (l) =>
              Number(l.debit || 0).toFixed(2) === target ||
              Number(l.credit || 0).toFixed(2) === target
          );
        }
      }

      return dateMatch || nameMatch || amountMatch;
    });
  }

  if (!rows.length) {
    tbody.innerHTML =
      '<tr><td colspan="7" style="text-align:center;">No entries found</td></tr>';
    return;
  }

  rows.forEach((entry) => {
    const linesHtml = (entry.journal_lines || [])
      .map((l) => {
        const debit = Number(l.debit || 0);
        const credit = Number(l.credit || 0);
        const isDebit = debit > 0;
        const isCredit = credit > 0;

        const baseName = l.accounts?.account_name || "";
        const label = (isCredit ? "&nbsp;&nbsp;&nbsp;" : "") + baseName;

        const dPart = isDebit ? "D " + fmtMoney(debit) : "";
        const cPart = isCredit ? "C " + fmtMoney(credit) : "";
        const amountPart = [dPart, cPart].filter(Boolean).join(" ");

        return `${label}: ${amountPart}`;
      })
      .join("<br>");

    const canAct =
      CURRENT_USER.role === "manager" && entry.status === "pending";

    const tr = document.createElement("tr");
    tr.style.backgroundColor =
      entry.status === "approved"
        ? "#e7f7eb"
        : entry.status === "rejected"
        ? "#fde8e8"
        : "transparent";

    tr.innerHTML = `
      <td>${entry.date ? new Date(entry.date).toLocaleDateString() : ""}</td>
      <td>${entry.status}</td>
      <td>${fmtMoney(entry.total_debit)}</td>
      <td>${fmtMoney(entry.total_credit)}</td>
      <td>${linesHtml}</td>
      <td>
        <a href="journal.html?entry_id=${entry.entry_id}">View</a>
        <button class="view-docs-btn" data-id="${entry.entry_id}" style="margin-left:6px;">Docs</button>
      </td>
      <td style="display:${CURRENT_USER.role === "manager" ? "" : "none"};">
        ${canAct ? actionButtons(entry.entry_id) : ""}
      </td>`;
    tbody.appendChild(tr);
  });
}

async function downloadJournalAttachments(entryId) {
  try {
    const { data, error } = await db
      .from("journal_attachments")
      .select("file_name, file_url")
      .eq("journal_entry_id", entryId);

    if (error) throw error;
    if (!data?.length) {
      alert("No attachments for this entry.");
      return;
    }

    data.forEach((att) => {
      const a = document.createElement("a");
      a.href = att.file_url;
      a.download = att.file_name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  } catch (e) {
    console.error(e);
    alert("Error downloading attachments.");
  }
}

// Event delegation for Docs buttons
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".view-docs-btn");
  if (!btn) return;
  const entryId = Number(btn.dataset.id);
  if (entryId) downloadJournalAttachments(entryId);
});

// -------------------------
// PR deep-link: show ONLY the single journal
// -------------------------
async function renderJournalDetailOnly(entryId) {
  document.getElementById("submittedSection")?.remove();
  document.querySelector(".form-actions")?.remove();

  const topTitle = document.getElementById("journalTopTitle");
  if (topTitle) topTitle.textContent = `Journal Entry #${entryId}`;
  document.title = `Journal Entry #${entryId}`;

  const backBtn = document.getElementById("backToLedgerBtn");
  if (backBtn) {
    backBtn.style.display = "inline-block";
    backBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const params = new URLSearchParams(window.location.search);
      const accountId = params.get("account_id");
      if (window.history.length > 1) {
        window.history.back();
      } else if (accountId) {
        window.location.href = `ledger.html?account_id=${encodeURIComponent(
          accountId
        )}`;
      } else {
        window.location.href = "ledger.html";
      }
    });
  }

  const tbody = document.getElementById("journalTableBody");
  tbody.innerHTML =
    '<tr><td colspan="5" style="text-align:center;">Loading entry...</td></tr>';

  const { data, error } = await db
    .from("journal_lines")
    .select(
      `
      debit,
      credit,
      description,
      accounts!inner(account_name)
    `
    )
    .eq("journal_entry_id", entryId);

  if (error || !data?.length) {
    tbody.innerHTML =
      '<tr><td colspan="5" style="text-align:center;color:red;">No data found</td></tr>';
    return;
  }

  tbody.innerHTML = "";
  data.forEach((line) => {
    const debit = Number(line.debit || 0);
    const credit = Number(line.credit || 0);
    const isCredit = credit > 0;

    const accountLabel = isCredit
      ? "\u00A0\u00A0\u00A0" + line.accounts.account_name
      : line.accounts.account_name;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${accountLabel}</td>
      <td>${debit > 0 ? fmtMoney(debit) : ""}</td>
      <td>${credit > 0 ? fmtMoney(credit) : ""}</td>
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
document.addEventListener("click", (e) => {
  const approveBtn = e.target.closest("[data-approve]");
  const rejectBtn = e.target.closest("[data-reject]");
  if (approveBtn)
    approveEntry(Number(approveBtn.getAttribute("data-approve")));
  if (rejectBtn) {
    const entryId = Number(rejectBtn.getAttribute("data-reject"));
    const input = document.querySelector(
      `[data-comment-for="${entryId}"]`
    );
    const comment = input?.value;
    if (!comment?.trim())
      return alert("Please enter a rejection comment.");
    const originalPrompt = window.prompt;
    window.prompt = () => comment;
    rejectEntry(entryId).finally(() => {
      window.prompt = originalPrompt;
    });
  }
});

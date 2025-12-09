// trial_balance.js
// Builds Trial Balance from v_account_balances (preferred) or accounts table.

let db = window.supabaseClient;

if (!db && window.supabase) {
  // const SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
  // const SUPABASE_ANON_KEY = "YOUR-PUBLIC-ANON-KEY";
  // db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

function fmt(n) {
  const num = Number(n || 0);
  return num.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

async function getAsOfDate() {
  try {
    const { data, error } = await db
      .from("ledger")
      .select("date")
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data && data.date) {
      const d = new Date(data.date);
      return d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric"
      });
    }
  } catch (e) {
    console.warn("getAsOfDate:", e.message);
  }

  const today = new Date();
  return today.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

async function fetchAccountsForTB() {
  try {
    const { data, error } = await db
      .from("v_account_balances")
      .select("account_id, account_number, account_name, normal_side, computed_balance")
      .order("account_number", { ascending: true });

    if (!error) {
      return (data || []).map(a => ({
        account_id: a.account_id,
        account_number: a.account_number,
        account_name: a.account_name,
        normal_side: a.normal_side,
        balance: Number(a.computed_balance || 0),
        is_active: true
      }));
    }

    if (error && !/relation "v_account_balances" does not exist/i.test(error.message)) {
      throw error;
    }
  } catch (e) {
    if (!/relation "v_account_balances" does not exist/i.test(String(e.message || ""))) {
      throw e;
    }
  }

  const { data, error } = await db
    .from("accounts")
    .select("account_id, account_number, account_name, normal_side, balance, is_active")
    .order("account_number", { ascending: true });

  if (error) throw error;

  return (data || []).map(a => ({
    account_id: a.account_id,
    account_number: a.account_number,
    account_name: a.account_name,
    normal_side: a.normal_side,
    balance: Number(a.balance || 0),
    is_active: a.is_active
  }));
}

async function loadTrialBalance() {
  const bodyEl = document.getElementById("tbBody");
  const totDEl = document.getElementById("tbTotalDebit");
  const totCEl = document.getElementById("tbTotalCredit");
  const msgEl  = document.getElementById("tbMessage");
  const asOfEl = document.getElementById("tbAsOf");

  if (!db) {
    bodyEl.innerHTML =
      `<tr><td colspan="3" style="color:#b91c1c;text-align:center;">Supabase client not found. Ensure auth.js runs before trial_balance.js.</td></tr>`;
    return;
  }

  asOfEl.textContent = `As of ${await getAsOfDate()}`;

  let rows;
  try {
    rows = await fetchAccountsForTB();
  } catch (err) {
    console.error("loadTrialBalance error:", err);
    bodyEl.innerHTML =
      `<tr><td colspan="3" style="color:#b91c1c;text-align:center;">Error loading accounts: ${err.message}</td></tr>`;
    return;
  }

  rows = rows.filter(a => a.is_active !== false);
  if (!rows.length) {
    bodyEl.innerHTML = `<tr><td colspan="3" style="text-align:center;">No accounts found.</td></tr>`;
    return;
  }

  let totalDebit = 0;
  let totalCredit = 0;
  bodyEl.innerHTML = "";

  const debitCells = [];
  const creditCells = [];

  rows.forEach(acc => {
    let normal = (acc.normal_side || "").toLowerCase() === "debit" ? "debit" : "credit";
    const balRaw = Number(acc.balance || 0);

    // Force Dividends Declared (3200) to appear as credit
    if (acc.account_number === "3200") {
      normal = "credit";
    }

    let debit = 0;
    let credit = 0;
    let debitDisplay = "";
    let creditDisplay = "";

    if (balRaw !== 0) {
      if (normal === "debit") {
        if (balRaw >= 0) {
          debit = balRaw;
          debitDisplay = fmt(debit);
        } else {
          credit = Math.abs(balRaw);
          creditDisplay = fmt(credit);
        }
      } else {
        if (balRaw >= 0) {
          credit = balRaw;
          creditDisplay = fmt(credit);
        } else {
          debit = Math.abs(balRaw);
          debitDisplay = fmt(debit);
        }
      }
    }

    // Show 0.00 for Retained Earnings (3100) and Dividends Declared (3200) if zero
    if (balRaw === 0 && (acc.account_number === "3100" || acc.account_number === "3200")) {
      if (normal === "debit") debitDisplay = fmt(0);
      else creditDisplay = fmt(0);
    }

    totalDebit += debit;
    totalCredit += credit;

    const tr = document.createElement("tr");
    const accountCell = document.createElement("td");
    accountCell.innerHTML = `
      <a class="tb-account-link"
         href="ledger.html?account_id=${encodeURIComponent(acc.account_id)}">
        ${acc.account_number || ""} - ${acc.account_name}
      </a>
    `;

    const debitCell = document.createElement("td");
    debitCell.className = "num tb-debit";
    debitCell.textContent = debitDisplay;

    const creditCell = document.createElement("td");
    creditCell.className = "num tb-credit";
    creditCell.textContent = creditDisplay;

    tr.append(accountCell, debitCell, creditCell);
    bodyEl.appendChild(tr);

    if (debitDisplay) debitCells.push(debitCell);
    if (creditDisplay) creditCells.push(creditCell);
  });

  totDEl.innerHTML = `<span>$${fmt(totalDebit)}</span>`;
  totCEl.innerHTML = `<span>$${fmt(totalCredit)}</span>`;

  const firstDebitCell = debitCells.find(cell => parseFloat(cell.textContent.replace(/,/g)) !== 0);
  if (firstDebitCell) firstDebitCell.textContent = `$${firstDebitCell.textContent}`;

  const firstCreditCell = creditCells.find(cell => parseFloat(cell.textContent.replace(/,/g)) !== 0);
  if (firstCreditCell) firstCreditCell.textContent = `$${firstCreditCell.textContent}`;

  // Only show a message if it is *not* balanced
  if (Math.abs(totalDebit - totalCredit) >= 0.005) {
    msgEl.className = "tb-msg tb-warn";
    msgEl.textContent = `Trial Balance does NOT balance. Difference: ${fmt(totalDebit - totalCredit)} (Debit - Credit).`;
  } else {
    msgEl.textContent = "";
  }
}

document.addEventListener("DOMContentLoaded", loadTrialBalance);

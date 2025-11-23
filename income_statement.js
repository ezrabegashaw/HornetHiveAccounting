// income_statement.js

const db = window.supabaseClient;

// ---------- Formatting ----------
function fmt(amount) {
  const n = Number(amount || 0);
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function addRow(tbody, label, amount, opts = {}) {
  const tr = document.createElement("tr");

  const tdLabel = document.createElement("td");
  tdLabel.className = opts.section ? "is-section" : "is-label";
  tdLabel.textContent = label || "";
  if (opts.bold) tdLabel.style.fontWeight = "bold";
  tr.appendChild(tdLabel);

  const tdAmount = document.createElement("td");
  tdAmount.className = "is-amount";

  if (amount != null) {
    const span = document.createElement("span");
    span.className = "amt";
    if (opts.underline === "single") span.classList.add("single-underline");
    if (opts.underline === "double") span.classList.add("double-underline");
    const displayAmt = opts.showDollar ? "$" + fmt(amount) : fmt(amount);
    span.textContent = displayAmt;
    tdAmount.appendChild(span);
  }

  tr.appendChild(tdAmount);
  tbody.appendChild(tr);
}

// ---------- Data source ----------
async function getAccountData() {
  try {
    const { data, error } = await db
      .from("v_account_balances")
      .select("account_number, account_name, account_category, computed_balance")
      .order("account_number", { ascending: true });

    if (!error && data && data.length) {
      return data.map(r => ({
        account_number: r.account_number,
        account_name: r.account_name,
        account_category: r.account_category,
        balance: r.computed_balance
      }));
    }
  } catch (e) {
    console.warn("v_account_balances not usable:", e.message);
  }

  try {
    const { data, error } = await db
      .from("accounts")
      .select("account_number, account_name, account_category, balance, is_active")
      .order("account_number", { ascending: true });

    if (error) throw error;
    const rows = (data || []).filter(r => r.is_active !== false);
    return rows.map(r => ({
      account_number: r.account_number,
      account_name: r.account_name,
      account_category: r.account_category,
      balance: r.balance
    }));
  } catch (e) {
    console.error("accounts fallback failed:", e.message);
    throw e;
  }
}

// ---------- Build Income Statement ----------
async function buildIncomeStatement() {
  const periodLine = document.getElementById("periodLine");
  const body = document.getElementById("incomeBody");

  // Use current date for header
  const now = new Date();
  const endStr = now.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
  periodLine.textContent = `For the Year Ended ${endStr}`;

  body.innerHTML = "";

  let rows;
  try {
    rows = await getAccountData();
  } catch (err) {
    addRow(body, "Error loading income statement", null);
    return;
  }

  if (!rows || !rows.length) {
    addRow(body, "No income statement data available.", null);
    return;
  }

  const revenues = rows.filter(r =>
    String(r.account_category || "").toLowerCase() === "revenue"
  );
  const expenses = rows.filter(r =>
    String(r.account_category || "").toLowerCase() === "expense"
  );

  // ---------- Revenues ----------
  addRow(body, "Revenues", null, { section: true });

  let totalRevenue = 0;
  revenues.forEach((r, idx) => {
    const isFirst = idx === 0;
    const isLast = idx === revenues.length - 1;
    const amt = Number(r.balance || 0);
    totalRevenue += amt;
    addRow(body, "     " + r.account_name, amt, {
      underline: isLast ? "single" : null,
      showDollar: isFirst // Only first revenue has dollar sign
    });
  });

  addRow(body, "Total Revenues", totalRevenue, { underline: "single" });

  // spacer
  addRow(body, "", null);

  // ---------- Expenses ----------
  addRow(body, "Expenses", null, { section: true });

  let totalExpenses = 0;
  expenses.forEach((r, idx) => {
    const isLast = idx === expenses.length - 1;
    const amt = Number(r.balance || 0);
    totalExpenses += amt;
    addRow(body, "     " + r.account_name, amt, {
      underline: isLast ? "single" : null
    });
  });

  addRow(body, "Total Expenses", totalExpenses, { underline: "single" });

  // spacer
  addRow(body, "", null);

  // ---------- Net Income ----------
  const netIncome = totalRevenue - totalExpenses;
  addRow(body, "Net Income", netIncome, {
    underline: "double",
    showDollar: true,
    bold: true
  });
}

document.addEventListener("DOMContentLoaded", buildIncomeStatement);

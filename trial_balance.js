// trial_balance.js
// Builds Trial Balance from Supabase data

let db = window.supabaseClient;

// Fallback (only if someone opens this page directly without auth.js)
if (!db && window.supabase) {
  const SUPABASE_URL = "https://rsthdogcmqwcdbqppsrm.supabase.co";
  const SUPABASE_ANON_KEY = "YOUR_PUBLIC_ANON_KEY_HERE";
  db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

function fmt(n) {
  const num = Number(n || 0);
  return num.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

async function getAsOfDate() {
  // Use latest ledger date; if none, today
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
        day: "numeric",
      });
    }
  } catch (e) {
    console.warn("getAsOfDate:", e.message);
  }

  const today = new Date();
  return today.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

async function loadTrialBalance() {
  const bodyEl = document.getElementById("tbBody");
  const totDEl = document.getElementById("tbTotalDebit");
  const totCEl = document.getElementById("tbTotalCredit");
  const msgEl  = document.getElementById("tbMessage");
  const asOfEl = document.getElementById("tbAsOf");

  if (!db) {
    bodyEl.innerHTML =
      `<tr><td colspan="3" style="color:#b91c1c;text-align:center;">Supabase client not found.</td></tr>`;
    return;
  }

  // Set "As of" line
  asOfEl.textContent = `As of ${await getAsOfDate()}`;

  // Grab active accounts with their running balances
  const { data, error } = await db
    .from("accounts")
    .select("account_id, account_number, account_name, normal_side, balance, is_active")
    .order("account_number", { ascending: true });

  if (error) {
    console.error("loadTrialBalance:", error.message);
    bodyEl.innerHTML =
      `<tr><td colspan="3" style="color:#b91c1c;text-align:center;">Error loading accounts.</td></tr>`;
    return;
  }

  const rows = (data || []).filter(a => a.is_active !== false);

  if (!rows.length) {
    bodyEl.innerHTML =
      `<tr><td colspan="3" style="text-align:center;">No accounts found.</td></tr>`;
    totDEl.textContent = "0.00";
    totCEl.textContent = "0.00";
    msgEl.textContent = "";
    return;
  }

  let totalDebit = 0;
  let totalCredit = 0;
  bodyEl.innerHTML = "";

  rows.forEach(acc => {
    const normal = (acc.normal_side || "").toLowerCase() === "debit" ? "debit" : "credit";
    const balRaw = Number(acc.balance || 0);

    // Decide which column to show the amount in.
    // If balance is on its normal side -> that column.
    // If negative (rare), flip to opposite column.
    let debit = 0;
    let credit = 0;

    if (balRaw !== 0) {
      if (normal === "debit") {
        if (balRaw >= 0) debit = balRaw;
        else credit = Math.abs(balRaw);
      } else {
        if (balRaw >= 0) credit = balRaw;
        else debit = Math.abs(balRaw);
      }
    }

    totalDebit += debit;
    totalCredit += credit;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <a class="tb-account-link"
           href="ledger.html?account_id=${encodeURIComponent(acc.account_id)}">
          ${acc.account_number || ""} - ${acc.account_name}
        </a>
      </td>
      <td class="num">${debit ? fmt(debit) : ""}</td>
      <td class="num">${credit ? fmt(credit) : ""}</td>
    `;
    bodyEl.appendChild(tr);
  });

  totDEl.textContent = fmt(totalDebit);
  totCEl.textContent = fmt(totalCredit);

  // Show whether it balances
  if (Math.abs(totalDebit - totalCredit) < 0.005) {
    msgEl.className = "tb-ok";
    msgEl.textContent = "Trial Balance is in balance.";
  } else {
    msgEl.className = "tb-warn";
    msgEl.textContent =
      `Trial Balance does NOT balance. Difference: ${fmt(totalDebit - totalCredit)} (Debit - Credit).`;
  }
}

document.addEventListener("DOMContentLoaded", loadTrialBalance);

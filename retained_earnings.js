// retained_earnings.js

// Use Supabase client from auth.js
const db = window.supabaseClient;

// Format a number with optional dollar sign and underline style
function setValue(cellId, amount, { dollar = false, underline = 'none' } = {}) {
  const cell = document.getElementById(cellId);
  if (!cell) return;

  const safe = isFinite(amount) ? amount : 0;
  const formatted = safe.toFixed(2);
  const prefix = dollar ? '$' : '';

  let cls = '';
  if (underline === 'single') cls = 'sre-underline';
  if (underline === 'double') cls = 'sre-double-underline';

  cell.innerHTML = `<span class="${cls}">${prefix}${formatted}</span>`;
}

// Simple helper: categorize & compute net income + dividends
async function loadStatement() {
  const errBox = document.getElementById('sreError');
  if (errBox) { errBox.style.display = 'none'; errBox.textContent = ''; }

  // Dynamic period label: "For the period ending Month Day, Year"
  const lbl = document.getElementById('periodLabel');
  if (lbl) {
    const now = new Date();
    lbl.textContent = `For the period ending ${now.toLocaleDateString(undefined, {
      month: 'long', day: 'numeric', year: 'numeric'
    })}`;
  }

  // Pull balances from your view
  const { data, error } = await db
    .from('v_account_balances')
    .select('account_number, account_name, account_category, normal_side, computed_balance');

  if (error || !data) {
    if (errBox) {
      errBox.style.display = 'block';
      errBox.textContent = `Error loading statement: ${error?.message || 'No data'}`;
    }
    // Fallback zeros
    setValue('beginRE', 0, { dollar:true });
    setValue('netIncomeAmount', 0, { dollar:true });
    setValue('dividendsAmount', 0, { underline:'single' });
    setValue('endingRE', 0, { dollar:true, underline:'double' });
    return;
  }

  let totalRevenue = 0;
  let totalExpense = 0;
  let dividends = 0;

  data.forEach(row => {
    const cat = (row.account_category || '').toLowerCase();
    const side = (row.normal_side || '').toLowerCase();
    const bal  = Number(row.computed_balance || 0);

    // Revenues
    if (cat === 'revenue') {
      const effect = side === 'credit' ? bal : -bal;
      totalRevenue += effect;
    }

    // Expenses
    if (cat === 'expense') {
      const effect = side === 'debit' ? bal : -bal;
      totalExpense += effect;
    }

    // Dividends Declared (3200 or name contains 'dividends')
    const name = (row.account_name || '').toLowerCase();
    if (row.account_number === '3200' || name.includes('dividends')) {
      // Dividends is a debit-normal account; take as positive amount
      dividends = Math.abs(bal);
    }
  });

  const netIncome = totalRevenue - totalExpense;

  // For this project scenario: beginning retained earnings is 0.
  // (If you later store beginning RE, plug it in here.)
  const beginRE = 0;

  const endingRE = beginRE + netIncome - dividends;

  // Fill in cells:
  // Beginning RE: show $, no underline
  setValue('beginRE', beginRE, { dollar:true });

  // Net Income: show $, no underline
  setValue('netIncomeAmount', netIncome, { dollar:true });

  // Dividends: single underline under the value, no $
  setValue('dividendsAmount', dividends, { underline:'single' });

  // Ending RE: show $, double underline
  setValue('endingRE', endingRE, { dollar:true, underline:'double' });
}

document.addEventListener('DOMContentLoaded', loadStatement);

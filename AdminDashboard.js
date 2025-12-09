// Supabase setup
const { createClient } = supabase;
const SUPABASE_URL = "https://rsthdogcmqwcdbqppsrm.supabase.co";
const SUPABASE_ANON_KEY = "your-anon-key-here";
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Display logged-in user
async function showLoggedUser() {
    const { data: { user } } = await supabaseClient.auth.getUser();
    const userName = user?.email || "Admin";
    document.getElementById("loggedUser").textContent = `Welcome, ${userName}`;
}
showLoggedUser();
function updateClock() {
    const now = new Date();
    const options = {
        weekday: "short", year: "numeric", month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit", second: "2-digit"
    };
    document.getElementById("dateTime").textContent = now.toLocaleString(undefined, options);
}
updateClock();
setInterval(updateClock, 1000);

// Service selector logic
document.getElementById("serviceSelect").addEventListener("change", (e) => {
    const selected = e.target.value;
    document.querySelectorAll("#dynamicContent > section, #dynamicContent > form").forEach(el => {
        el.style.display = "none";
    });
    if (selected === "add") document.getElementById("addAccountForm").style.display = "block";
    if (selected === "view") {
        document.getElementById("viewAccounts").style.display = "block";
        loadAccounts();
    }
    if (selected === "deactivate") {
    }
});

// Add Account form submission
document.getElementById("addAccountForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    const account = Object.fromEntries(formData.entries());

    if (!/^\d+$/.test(account.accountNumber)) {
        alert("Account number must be numeric only.");
        return;
    }

    // Format monetary values
    ["initialBalance", "debit", "credit", "balance"].forEach(field => {
        account[field] = parseFloat(account[field] || 0).toFixed(2);
    });

    // Check for duplicates
    const { data: existing } = await supabaseClient
        .from("accounts")
        .select("accountName, accountNumber")
        .or(`accountName.eq.${account.accountName},accountNumber.eq.${account.accountNumber}`);

    if (existing.length > 0) {
        alert("Duplicate account name or number.");
        return;
    }

    // Add timestamp and user ID
    account.dateAdded = new Date().toISOString();
    const { data: { user } } = await supabaseClient.auth.getUser();
    account.userId = user?.id || "admin";

    // Insert into database
    const { error } = await supabaseClient.from("accounts").insert([account]);
    if (error) {
        alert("Error adding account: " + error.message);
    } else {
        alert("Account added successfully.");
        form.reset();
        logEvent("add", null, account);
    }
});

// Load accounts for viewing
async function loadAccounts() {
    const { data, error } = await supabaseClient.from("accounts").select("*");
    const tbody = document.querySelector("#accountsTable tbody");
    tbody.innerHTML = "";

    if (error) {
        tbody.innerHTML = `<tr><td colspan="7">Error loading accounts</td></tr>`;
        return;
    }

    data.forEach(account => {
        const row = document.createElement("tr");
        row.innerHTML = `
      <td>${account.accountName}</td>
      <td>${account.accountNumber}</td>
      <td>${account.category}</td>
      <td>${account.subcategory}</td>
      <td>${parseFloat(account.balance).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
      <td>${account.statement}</td>
      <td><button onclick="viewLedger('${account.accountNumber}')">Ledger</button></td>
    `;
        tbody.appendChild(row);
    });
}

// Search accounts
document.getElementById("searchBar").addEventListener("input", async (e) => {
    const query = e.target.value.toLowerCase();
    const { data } = await supabaseClient
        .from("accounts")
        .select("*")
        .ilike("accountName", `%${query}%`);

    const tbody = document.querySelector("#accountsTable tbody");
    tbody.innerHTML = "";
    data.forEach(account => {
        const row = document.createElement("tr");
        row.innerHTML = `
      <td>${account.accountName}</td>
      <td>${account.accountNumber}</td>
      <td>${account.category}</td>
      <td>${account.subcategory}</td>
      <td>${parseFloat(account.balance).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
      <td>${account.statement}</td>
      <td><button onclick="viewLedger('${account.accountNumber}')">Ledger</button></td>
    `;
        tbody.appendChild(row);
    });
});

// View ledger 
function viewLedger(accountNumber) {
    alert(`Redirecting to ledger for account ${accountNumber}`);
}

// Event logging
async function logEvent(action, before, after) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    const logEntry = {
        userId: user?.id || "admin",
        timestamp: new Date().toISOString(),
        action,
        before: before ? JSON.stringify(before) : null,
        after: after ? JSON.stringify(after) : null
    };
    await supabaseClient.from("eventLog").insert([logEntry]);
}

// Dynamically injects the correct sidebar based on user role
// Usage: Place <div id="sidebar"></div> in your HTML where the sidebar should appear
// and include this script after auth.js

document.addEventListener('DOMContentLoaded', async () => {
	// Try to get role from localStorage (set at login)
	let role = localStorage.getItem('role');
	// If not found, try to fetch from Supabase session
	if (!role && window.supabaseClient) {
		try {
			const { data: { user } } = await window.supabaseClient.auth.getUser();
			if (user) {
				// Fetch user profile from users table
				const { data, error } = await window.supabaseClient
					.from('users')
					.select('role')
					.eq('id', user.id)
					.maybeSingle();
				if (data && data.role) {
					role = data.role;
					localStorage.setItem('role', role);
				}
			}
		} catch (e) { /* fallback to localStorage */ }
	}

	// Sidebar HTML for each role
	const adminSidebar = `
		<aside class="sidebar">
			<div class="brand"><img src="HHAlogo.jpg" alt="HHA Logo"><span>HHA</span></div>
			<ul class="nav">
				<li><a href="AdminDashBoard.html">Dashboard</a></li>
				<li><a href="AdminChartOfAccounts.html">Chart of Accounts</a></li>
				<li><a href="users.html">Users</a></li>
				<li><a href="EventLogs.html">Event Logs</a></li>
			</ul>
			<div class="sidebar-footer"><button class="btn" id="logoutBtn">Logout</button></div>
		</aside>
	`;

	const acctMgrSidebar = `
		<aside class="sidebar">
			<div class="brand"><img src="HHAlogo.jpg" alt="HHA Logo"><span>HHA</span></div>
			<ul class="nav">
				<li><a href="Dashboard.html">Dashboard</a></li>
				<li><a href="ChartOfAccounts.html">Chart of Accounts</a></li>
				<li><a href="journal.html">Journal</a></li>
				<li><a href="Ledger.html">Ledger</a></li>
				<li><a href="trial_balance.html">Trial Balance</a></li>
				<li><a href="income_statement.html">Income Statement</a></li>
				<li><a href="balance_sheet.html">Balance Sheet</a></li>
				<li><a href="retained_earnings.html">Statement of Retained Earnings</a></li>
				<li><a href="EventLogs.html">Event Logs</a></li>
			</ul>
			<div class="sidebar-footer"><button class="btn" id="logoutBtn">Logout</button></div>
		</aside>
	`;

	// Default to accountant/manager sidebar if role is not admin
	let sidebarHtml = (role && role.toLowerCase() === 'admin') ? adminSidebar : acctMgrSidebar;
	const sidebarDiv = document.getElementById('sidebar');
	if (sidebarDiv) {
		sidebarDiv.innerHTML = sidebarHtml;
	}
});

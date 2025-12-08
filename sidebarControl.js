document.addEventListener('DOMContentLoaded', () => {
  const roleRaw = (localStorage.getItem('role') || '').toLowerCase();
  const isAdmin = roleRaw.includes('admin') || roleRaw === 'administrator';
  const isAcct = roleRaw.includes('accountant') || roleRaw.includes('manager') || roleRaw === 'accountant' || roleRaw === 'manager';
  const isUser = !isAdmin && !isAcct;

  // Normalize asides: show/hide whole aside blocks when they are special
  document.querySelectorAll('aside.sidebar').forEach(aside => {
    // If user is admin, enforce a consistent admin nav structure (skip acctMgrSidebar)
    if (isAdmin && aside.id !== 'acctMgrSidebar') {
      try {
        const ul = aside.querySelector('ul.nav');
        if (ul) {
          ul.innerHTML = `
            <li><a href="AdminDashBoard.html">Dashboard</a></li>
            <li><a href="AdminChartOfAccounts.html">Chart of Accounts</a></li>
            <li><a href="journal.html">Journal</a></li>
            <li><a href="Ledger.html">Ledger</a></li>
            <li><a href="Accounts.html">Users / Manage Accounts</a></li>
          `;
          // ensure sidebar footer exists and has a logout button
          let footer = aside.querySelector('.sidebar-footer');
          if (!footer) {
            footer = document.createElement('div');
            footer.className = 'sidebar-footer';
            aside.appendChild(footer);
          }
          // add a logout button if missing
          if (!footer.querySelector('button.logoutBtn')) {
            const btn = document.createElement('button');
            btn.className = 'btn logoutBtn';
            btn.textContent = 'Logout';
            footer.innerHTML = '';
            footer.appendChild(btn);
          }
        }
      } catch (e) {
        // ignore DOM issues
      }
    }
    // if this aside is explicitly for acct/mgr (id used in some pages)
    if (aside.id === 'acctMgrSidebar') {
      aside.style.display = isAcct ? '' : 'none';
      return;
    }

    // if aside contains an Admin dashboard link, treat it as admin sidebar
    const hasAdminLink = !!aside.querySelector('a[href*="AdminDashBoard.html"], a[href*="AdminChartOfAccounts.html"], a[href*="AdminDash"]');
    if (hasAdminLink) {
      aside.style.display = isAdmin ? '' : 'none';
      return;
    }

    // default: show to users and accountants
    aside.style.display = (isUser || isAcct ? '' : 'none');
  });

  // Build role-specific navs for visible sidebars
  const buildNavForRole = (role) => {
    // messages link intentionally excluded from all sidebars
    const includeMessages = false;
    if (role === 'admin') {
      return [
        { href: 'AdminDashBoard.html', label: 'Dashboard' },
        { href: 'AdminChartOfAccounts.html', label: 'Chart of Accounts' },
        { href: 'journal.html', label: 'Journal' },
        { href: 'Ledger.html', label: 'Ledger' },
        { href: 'Accounts.html', label: 'Users / Manage Accounts' },
        // messages intentionally omitted
      ];
    }
    if (role === 'acct') {
      return [
        { href: 'Dashboard.html', label: 'Dashboard' },
        { href: 'ChartOfAccounts.html', label: 'Chart of Accounts' },
        { href: 'journal.html', label: 'Journal' },
        { href: 'Ledger.html', label: 'Ledger' },
        // messages intentionally omitted
      ];
    }
    // default: regular user
    return [
      { href: 'Dashboard.html', label: 'Dashboard' },
      { href: 'ChartOfAccounts.html', label: 'Chart of Accounts' },
      { href: 'journal.html', label: 'Journal' },
      // messages intentionally omitted
    ];
  };

  document.querySelectorAll('aside.sidebar').forEach(aside => {
    // skip sidebars that are explicitly manager-only placeholder if present
    if (aside.id === 'acctMgrSidebar') {
      // show/hide handled earlier; if visible, treat it as the same role as isAcct
      if (getComputedStyle(aside).display !== 'none') {
        const items = buildNavForRole(isAdmin ? 'admin' : (isAcct ? 'acct' : 'user'));
        const ul = aside.querySelector('ul.nav');
        if (ul) ul.innerHTML = items.map(i => `<li><a href="${i.href}">${i.label}</a></li>`).join('');
      }
      return;
    }

    // apply role-based nav only to visible asides
    if (getComputedStyle(aside).display === 'none') return;
    const roleKey = isAdmin ? 'admin' : (isAcct ? 'acct' : 'user');
    const items = buildNavForRole(roleKey);
    const ul = aside.querySelector('ul.nav');
    if (ul) ul.innerHTML = items.map(i => `<li><a href="${i.href}">${i.label}</a></li>`).join('');

    // ensure footer has logout button
    let footer = aside.querySelector('.sidebar-footer');
    if (!footer) {
      footer = document.createElement('div');
      footer.className = 'sidebar-footer';
      aside.appendChild(footer);
    }
    if (!footer.querySelector('button.logoutBtn')) {
      footer.innerHTML = '';
      const btn = document.createElement('button');
      btn.className = 'btn logoutBtn';
      btn.textContent = 'Logout';
      footer.appendChild(btn);
    }
  });

  // Mark the active link based on current location (improves navigation feedback)
  try {
    const current = (location.pathname || '').split('/').pop().toLowerCase();
    document.querySelectorAll('aside.sidebar a').forEach(a => {
      a.removeAttribute('aria-current');
      const link = (a.getAttribute('href') || '').split(/[?#]/)[0].split('/').pop().toLowerCase();
      if (link && current && link === current) {
        a.setAttribute('aria-current', 'page');
        a.classList.add('active');
      } else {
        a.classList.remove('active');
      }
    });
  } catch (e) {
    // ignore
  }

  // Ensure logout buttons call the centralized logout() function
  try {
    const logoutButtons = Array.from(document.querySelectorAll('.sidebar-footer button, .logoutBtn'));
    logoutButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof logout === 'function') return logout();
        localStorage.clear();
        location.href = 'HornetHiveLogin.html';
      });
    });
  } catch (e) {
    // ignore
  }
});

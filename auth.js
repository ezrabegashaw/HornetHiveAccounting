/** ===== CONFIG ===== */
const USE_SUPABASE = false; // set to true after wiring Supabase
const SUPABASE_URL = "";     // e.g. https://xxxx.supabase.co
const SUPABASE_ANON = "";    // your anon key

// Expose for other scripts (e.g., login page)
window.USE_SUPABASE = USE_SUPABASE;
window.SUPABASE_URL = SUPABASE_URL;
window.SUPABASE_ANON = SUPABASE_ANON;

// Dev-only allowed pages per role
const DEV_ALLOWED = {
  administrator: ['dashboard','coa','accounts'],
  manager: ['dashboard','coa','accounts','journal','trial_balance','income_statement','balance_sheet','retained_earnings'],
  accountant: ['dashboard','coa','accounts','journal','trial_balance','income_statement','balance_sheet','retained_earnings']
};

// Map your links to page keys
const HREF_TO_PAGEKEY = {
  'Dashboard.html': 'dashboard',
  'ChartOfAccounts.html': 'coa',
  '#accounts': 'accounts',
  'journal.html': 'journal',
  'trial_balance.html': 'trial_balance',
  '#income': 'income_statement',
  '#balance': 'balance_sheet',
  '#retained': 'retained_earnings'
};

const PAGE_TITLE_TO_KEY = {
  'Dashboard': 'dashboard',
  'Chart of Accounts': 'coa',
  'Journalize': 'journal',
  'Trial Balance': 'trial_balance'
};

function getCurrentPageKey() {
  const h1 = document.querySelector('main h1, .header h1, .journal-card h2');
  if (h1) {
    const t = h1.textContent.trim();
    if (PAGE_TITLE_TO_KEY[t]) return PAGE_TITLE_TO_KEY[t];
  }
  const path = location.pathname.split('/').pop() || 'Dashboard.html';
  if (HREF_TO_PAGEKEY[path]) return HREF_TO_PAGEKEY[path];
  return null;
}

async function getSessionInfo() {
  if (!USE_SUPABASE) {
    const username = localStorage.getItem('username') || 'User';
    const role = localStorage.getItem('role') || 'accountant';
    const allowed = DEV_ALLOWED[role] || [];
    return { username, role, allowed, avatar_url: 'profile.png' };
  }

  if (!window.supabase) throw new Error("Supabase client not loaded.");
  const supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return { username: null, role: null, allowed: [] };

  const { data: profiles } = await supa
    .from('profiles')
    .select('email, first_name, last_name, role, avatar_url')
    .eq('id', user.id)
    .limit(1);

  const profile = profiles?.[0];
  const name = profile?.first_name
    ? `${profile.first_name} ${profile.last_name || ''}`.trim()
    : (profile?.email || user.email);

  const { data: pages } = await supa.from('my_allowed_pages').select('page_key');
  const allowed = (pages || []).map(p => p.page_key);

  return { username: name, role: profile?.role || null, allowed, avatar_url: profile?.avatar_url || 'profile.png' };
}

function renderTopbarUser(username, avatarUrl) {
  const elName = document.getElementById('userName');
  if (elName) elName.textContent = username || 'User';
  const elAvatar = document.getElementById('userAvatar');
  if (elAvatar && avatarUrl) elAvatar.src = avatarUrl;
}

function hideDisallowedLinks(allowed) {
  document.querySelectorAll('.nav a').forEach(a => {
    const key = HREF_TO_PAGEKEY[a.getAttribute('href')];
    if (key && !allowed.includes(key)) a.closest('li')?.remove();
  });
}

function hardBlockIfNotAllowed(allowed) {
  const key = getCurrentPageKey();
  if (key && !allowed.includes(key)) location.replace('Dashboard.html');
}

function wireLogout() {
  const btn = document.querySelector('.sidebar-footer .btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    if (USE_SUPABASE && window.supabase) {
      const supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
      await supa.auth.signOut();
    }
    localStorage.removeItem('username');
    localStorage.removeItem('role');
    location.replace('HornetHiveLogin.html');
  });
}

async function initRBAC() {
  try {
    const { username, role, allowed, avatar_url } = await getSessionInfo();
    const onAuthPage = document.body.classList.contains('auth-page');
    if (!onAuthPage && (!role || !allowed.length)) {
      location.replace('HornetHiveLogin.html');
      return;
    }
    renderTopbarUser(username, avatar_url);
    hideDisallowedLinks(allowed);
    hardBlockIfNotAllowed(allowed);
    wireLogout();
  } catch (e) {
    console.error(e);
  }
}

// Helper for Dev Mode
function devSetSession(username, role) {
  localStorage.setItem('username', username);
  localStorage.setItem('role', role);
}

// Make init/dev helpers available to HTML pages
window.initRBAC = initRBAC;
window.devSetSession = devSetSession;

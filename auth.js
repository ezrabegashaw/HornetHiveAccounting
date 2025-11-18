// ===================== auth.js (header) =====================
// Import createClient from global supabase object (via CDN)
const { createClient } = supabase;

// Supabase project info
const SUPABASE_URL = "https://rsthdogcmqwcdbqppsrm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJzdGhkb2djbXF3Y2RicXBwc3JtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYwNTY3NDcsImV4cCI6MjA3MTYzMjc0N30.EoOxjSIjGHbw6ltNisWYq6yKXdrOfE6XVdh5mERbrSY";

// Initialize Supabase client
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
window.supabaseClient = supabaseClient;
window.USE_SUPABASE = true;

/* ----------------------------------------------------------------
   API base (HARD-SET for local dev to avoid hostname mismatches)
------------------------------------------------------------------*/
const API_BASE = `http://127.0.0.1:3333/api`;


/* ----------------------------------------------------------------
   USERNAME HELPERS
------------------------------------------------------------------*/
function baseUsername(first_name, last_name, when = new Date()) {
  const mm = String(when.getMonth() + 1).padStart(2, "0");
  const yy = String(when.getFullYear()).slice(-2);
  const f = (first_name || "").trim().charAt(0);
  const l = (last_name || "").trim().replace(/\s+/g, "");
  return (f + l + mm + yy).toLowerCase();
}

async function ensureUniqueUsername(desired) {
  const { data, error } = await supabaseClient
    .from("users")
    .select("username")
    .ilike("username", `${desired}%`);

  if (error || !data || data.length === 0) return desired;

  const existing = new Set(data.map((r) => (r.username || "").toLowerCase()));
  if (!existing.has(desired.toLowerCase())) return desired;

  let n = 2;
  while (existing.has(`${desired.toLowerCase()}-${n}`)) n++;
  return `${desired.toLowerCase()}-${n}`;
}

/* ----------------------------------------------------------------
   SIGNUP  (calls backend)
------------------------------------------------------------------*/
async function signupUser(data) {
  try {
    const response = await fetch(`${API_BASE}/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    const result = await response.json();
    if (!response.ok) {
      console.error('Backend signup error:', result);
      return { error: result };
    }
    console.log('Signup success:', result);
    return { error: null };
  } catch (err) {
    console.error('Unexpected signup error:', err);
    return { error: { message: err.message } };
  }
}

/* ----------------------------------------------------------------
   LOGIN by USERNAME  (calls backend)
------------------------------------------------------------------*/
async function loginUserByUsername(username, password) {
  const attemptsKey = `attempts_${username}`;
  let attempts = parseInt(localStorage.getItem(attemptsKey)) || 0;

  try {
    const response = await fetch(`${API_BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    const result = await response.json();

    if (!response.ok) {
      if (response.status === 403 && result.error?.toLowerCase().includes("approval")) {
        window.location.href = "PendingPage.html";
        return { user: null, error: { message: "Awaiting approval" } };
      }

      if (response.status === 401 && result.error?.toLowerCase().includes("password")) {
        attempts++;
        localStorage.setItem(attemptsKey, attempts);

        if (attempts >= 3) {
          await fetch(`${API_BASE}/lock-account`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username }),
          });
          localStorage.removeItem(attemptsKey);
          return { user: null, error: { message: "Account locked due to too many failed attempts." } };
        }

        return {
          user: null,
          error: { message: `Incorrect password. Attempt ${attempts} of 3.` },
        };
      }

      return { user: null, error: { message: result.error || "Unexpected login error." } };
    }

    localStorage.removeItem(attemptsKey);
    return { user: result.user, error: null };
  } catch (err) {
    console.error("Login error:", err);
    return { user: null, error: { message: "Network or server error. Please try again later." } };
  }
}

/* ----------------------------------------------------------------
   (Legacy) LOGIN by EMAIL  – unchanged
------------------------------------------------------------------*/
async function loginUser(email, password) {
  const { data, error } = await supabaseClient
    .from("users")
    .select("*")
    .eq("email", email)
    .limit(1)
    .single();

  if (error) return { error };

  const attemptsKey = `attempts_${email}`;
  let attempts = parseInt(localStorage.getItem(attemptsKey)) || 0;

  if (!data.approved) {
    window.location.href = "PendingPage.html";
    return;
  }

  if (data.password !== password) {
    attempts++;
    localStorage.setItem(attemptsKey, attempts);
    if (attempts >= 3) {
      await supabaseClient.from("users").update({ approved: false }).eq("email", email);
      localStorage.removeItem(attemptsKey);
    }
    return { error: "Incorrect password" };
  }

  localStorage.removeItem(attemptsKey);
  return { user: data };
}

/* ----------------------------------------------------------------
   SESSION / RBAC HELPERS
------------------------------------------------------------------*/
function setSession(user) {
  localStorage.setItem("user_id", user.id);
  localStorage.setItem("username", user.username || user.email || "");
  localStorage.setItem("role", user.role || "");
  localStorage.setItem("first_name", user.first_name || "User");
}

function initRBAC() {
  const name = localStorage.getItem("first_name") || "User";
  const el = document.getElementById("userName");
  if (el) el.textContent = name;
}

function logout() {
  localStorage.clear();
  window.location = "HornetHiveLogin.html";
}

/* ----------------------------------------------------------------
   ROLE/ACTIVE LOOKUPS (by email) — compatibility
------------------------------------------------------------------*/
async function getRole(email) {
  const { data, error } = await supabaseClient
    .from("users")
    .select("*")
    .eq("email", email)
    .limit(1)
    .single();

  if (error) return { error };
  if (data?.email === email) return data.role;
  return { error: "No role found" };
}

async function isActive(email) {
  const { data, error } = await supabaseClient
    .from("users")
    .select("*")
    .eq("email", email)
    .limit(1)
    .single();

  if (error) return { error };
  if (data?.email === email) return data.active;
  return { error: "No role found" };
}

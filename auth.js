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
   USERNAME HELPERS
   Requirement: first initial + full last name + MMYY (created date)
------------------------------------------------------------------*/

// Build base username: first initial + full last name + MMYY (using "now" at signup)
function baseUsername(first_name, last_name, when = new Date()) {
  const mm = String(when.getMonth() + 1).padStart(2, "0");
  const yy = String(when.getFullYear()).slice(-2);
  const f = (first_name || "").trim().charAt(0);
  const l = (last_name || "").trim().replace(/\s+/g, "");
  return (f + l + mm + yy).toLowerCase();
}

// Ensure uniqueness: if "flastMMYY" exists, create "flastMMYY-2", "-3", ...
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
   SIGNUP
   Saves a unique username to the users table.
   Called by CreateUser.html submit handler.
------------------------------------------------------------------*/
async function signupUser(data) {
  try {
    // Call your backend instead of Supabase directly
    const response = await fetch('http://localhost:3000/signup', {
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
   LOGIN by USERNAME
   Used by HornetHiveLogin.html after you switched inputs to username
------------------------------------------------------------------*/
// auth.js
async function loginUserByUsername(username, password) {
  // === 1. Track failed login attempts per username ===
  const attemptsKey = `attempts_${username}`;
  let attempts = parseInt(localStorage.getItem(attemptsKey)) || 0;

  try {
    // === 2. Send credentials to backend ===
    const response = await fetch("http://localhost:3000/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    const result = await response.json();

    // === 3. Handle errors ===
    if (!response.ok) {
      // Server says account is pending approval
      if (response.status === 403 && result.error?.includes("approval")) {
        window.location.href = "PendingPage.html";
        return { user: null, error: { message: "Awaiting approval" } };
      }

      // Increment attempts for wrong password
      if (response.status === 401 && result.error?.includes("password")) {
        attempts++;
        localStorage.setItem(attemptsKey, attempts);

        // After 3 failed attempts, lock the account in Supabase
        if (attempts >= 3) {
          await fetch("http://localhost:3000/lock-account", {
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

      // Other errors
      return { user: null, error: { message: result.error || "Unexpected login error." } };
    }

    // === 4. Success ===
    localStorage.removeItem(attemptsKey);
    return { user: result.user, error: null };
  } catch (err) {
    console.error("Login error:", err);
    return { user: null, error: { message: "Network or server error. Please try again later." } };
  }
}



/* ----------------------------------------------------------------
   (Legacy) LOGIN by EMAIL
   Kept for backwards compatibility. Not used after the switch.
------------------------------------------------------------------*/
async function loginUser(email, password) {
  const { data, error } = await supabaseClient
    .from("users")
    .select("*")
    .eq("email", email)
    .limit(1)
    .single();

  if (error) return { error };

  // Track attempts per user (by email)
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
   ROLE/ACTIVE LOOKUPS (by email) — kept for compatibility
   You can ignore these if you no longer use them.
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

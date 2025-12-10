const { createClient } = supabase;

const SUPABASE_URL = "https://rsthdogcmqwcdbqppsrm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJzdGhkb2djbXF3Y2RicXBwc3JtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYwNTY3NDcsImV4cCI6MjA3MTYzMjc0N30.EoOxjSIjGHbw6ltNisWYq6yKXdrOfE6XVdh5mERbrSY";

if (!window.supabaseClient) window.supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const supabaseClient = window.supabaseClient;

// Detect if running on Render or locally
const isLocal = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";

// Use Render URL in production, local URL if developing
const API_BASE = isLocal
  ? "http://127.0.0.1:3333/api"
  : "https://hornethiveaccounting.onrender.com/api";


async function loginUserByUsername(username, password) {
  try {
    const response = await fetch(`${API_BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    // Always try/catch json parsing
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("Server did not return valid JSON");
    }

    if (!response.ok) {
      return { user: null, error: result };
    }

    return { user: result.user, error: null };
  } catch (err) {
    console.error("Network or fetch error:", err);
    return { user: null, error: { message: err.message } };
  }
}

// ===== SIGNUP =====
async function signupUser(data) {
  try {
    const response = await fetch(`${API_BASE}/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    const resData = await response.json();
    if (!response.ok) return { error: resData };
    return { error: null };
  } catch (err) {
    return { error: { message: err.message } };
  }
}

// ===== SESSION HELPERS =====
function setSession(user) {
  localStorage.setItem("user_id", user.id);
  localStorage.setItem("username", user.username || user.email || "");
  localStorage.setItem("role", user.role || "");
  localStorage.setItem("first_name", user.first_name || "User");
}

function logout() {
  localStorage.clear();
  window.location.href = "HornetHiveLogin.html";
}

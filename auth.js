//Import createClient from global supabase object
const { createClient } = supabase;

//Supabase project info
const SUPABASE_URL = "https://rsthdogcmqwcdbqppsrm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJzdGhkb2djbXF3Y2RicXBwc3JtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYwNTY3NDcsImV4cCI6MjA3MTYzMjc0N30.EoOxjSIjGHbw6ltNisWYq6yKXdrOfE6XVdh5mERbrSY";

//Initialize Supabase client
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
window.supabaseClient = supabaseClient;
window.USE_SUPABASE = true;

//sends user data to Supabase
async function signupUser(data) {
  try {
    const res = await fetch('http://localhost:3000/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    const result = await res.json();

    if (res.ok) {
      alert(result.message); // "Signup submitted! Waiting for admin approval."
    } else {
      alert(result.error);   // e.g., "Email already registered"
    }
  } catch (err) {
    console.error('Unexpected signup error:', err);
    alert('Unexpected signup error. Check console.');
  }
}


//Login function - checks email & password
async function loginUser(email, password) {
  const { data, error } = await supabaseClient
    .from('users')
    .select('*')
    .eq('email', email)
    .limit(1)
    .single();

  if (error) return { error };

  if (!data.approved) return { error: "Your account is pending admin approval" };

  if (data.password !== password) {
    return { error: "Incorrect password" };
  }

  return { user: data };
}

//Store user session info in browser
function setSession(user) {
  localStorage.setItem('user_id', user.id);
  localStorage.setItem('username', user.email);
  localStorage.setItem('role', user.role);
  localStorage.setItem('first_name', user.first_name);
}

//Show name on dashboard
function initRBAC() {
  const name = localStorage.getItem('first_name') || 'User';
  const el = document.getElementById('userName');
  if (el) el.textContent = name;
}

//Logout function
function logout() {
  localStorage.clear();
  window.location = 'HornetHiveLogin.html';
}

//Gets user's role by their email
async function getRole(email) {
  const { data, error } = await supabaseClient
    .from('users')
    .select('*')
    .eq('email', email)
    .limit(1)
    .single()

    if (error) return {error};

    if(data.email == email) {
      return data.role;
    }
    else return { error: "No role found"};
}
require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');
const path = require('path');

const SALT_ROUNDS = 12;
const app = express();
const PORT = process.env.PORT || 3333;

/* ------------------------------
   ENVIRONMENT DIAGNOSTICS LOGS
-------------------------------*/
console.log("=== SERVER STARTING ===");
console.log("NODE_ENV:", process.env.NODE_ENV);
console.log("SUPABASE_URL present?", !!process.env.SUPABASE_URL);
console.log("SUPABASE_ANON_KEY present?", !!process.env.SUPABASE_ANON_KEY);
console.log("SUPABASE_KEY present?", !!process.env.SUPABASE_KEY);
console.log("SUPABASE_SERVICE_ROLE_KEY present?", !!process.env.SUPABASE_SERVICE_ROLE_KEY);
console.log("EMAIL_USER present?", !!process.env.EMAIL_USER);
console.log("EMAIL_PASS present?", !!process.env.EMAIL_PASS);

/* ------------------------------
   ULTRA-PERMISSIVE CORS
-------------------------------*/
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET,POST,PUT,PATCH,DELETE,OPTIONS'
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    req.header('Access-Control-Request-Headers') || 'Content-Type, Authorization'
  );
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());

/* ------------------------------
   REQUEST LOGGER
-------------------------------*/
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

/* ------------------------------
   STATIC FRONTEND
-------------------------------*/
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'HornetHiveLogin.html'));
});

/* ------------------------------
   SAFE SUPABASE INITIALIZERS
-------------------------------*/
function getSupabaseUrl() {
  return (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    null
  );
}
function getAnonKey() {
  return (
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    null
  );
}
function getServiceRole() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

let _supabaseClient = null;
let _supabaseAdmin = null;

function supabaseClient() {
  if (_supabaseClient) return _supabaseClient;

  const url = getSupabaseUrl();
  const key = getAnonKey();

  if (!url || !key) {
    console.error("Supabase client not created — missing URL or anon key");
    return null;
  }

  try {
    _supabaseClient = createClient(url, key);
    console.log("✔ Supabase client created");
    return _supabaseClient;
  } catch (err) {
    console.error("Failed to create Supabase client:", err);
    return null;
  }
}

function supabaseAdmin() {
  if (_supabaseAdmin) return _supabaseAdmin;

  const url = getSupabaseUrl();
  const key = getServiceRole();

  if (!url || !key) {
    console.error("Supabase admin not created — missing service role key");
    return null;
  }

  try {
    _supabaseAdmin = createClient(url, key);
    console.log("✔ Supabase admin client created");
    return _supabaseAdmin;
  } catch (err) {
    console.error("Failed to create Supabase admin:", err);
    return null;
  }
}

/* ------------------------------
   MAILER
-------------------------------*/
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

/* ------------------------------
   HEALTH CHECK
-------------------------------*/
app.get('/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

/* ------------------------------
   SHIM ROUTES
-------------------------------*/
const shim = (from, to, method = 'post') => {
  app[method](from, (req, res) => {
    req.url = to;
    app._router.handle(req, res);
  });
};

shim('/signup', '/api/signup');
shim('/login', '/api/login');
shim('/lock-account', '/api/lock-account');
shim('/send-email', '/api/send-email-raw');
shim('/approve', '/api/approve', 'get');
shim('/reject', '/api/reject', 'get');

/* ------------------------------
   404 CATCH-ALL
-------------------------------*/
app.use((req, res) => {
  console.warn("No route matched ${req.method} ${req.originalUrl}`);
  res.status(404).json({ error: "Route not found" });
});

/* ------------------------------
   START SERVER
-------------------------------*/
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

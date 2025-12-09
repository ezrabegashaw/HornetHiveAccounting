// server.js — cleaned version for Render / Railway / Fly
require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');
const path = require('path');

const SALT_ROUNDS = 12;
const app = express();
const PORT = process.env.PORT || 3333;
const HOST = '0.0.0.0';

/* ------------------------------
   ENVIRONMENT DIAGNOSTICS LOGS
-------------------------------*/
console.log("=== SERVER STARTING ===");
console.log("NODE_ENV:", process.env.NODE_ENV || 'undefined');
console.log("PORT:", PORT);
console.log("SUPABASE_URL present?", !!process.env.SUPABASE_URL);
console.log("SUPABASE_ANON_KEY present?", !!process.env.SUPABASE_ANON_KEY || !!process.env.SUPABASE_KEY);
console.log("SUPABASE_SERVICE_ROLE_KEY present?", !!process.env.SUPABASE_SERVICE_ROLE_KEY);
console.log("EMAIL_USER present?", !!process.env.EMAIL_USER);
console.log("EMAIL_PASS present?", !!process.env.EMAIL_PASS);

/* ------------------------------
   ULTRA-PERMISSIVE CORS (DEV)
   Tighten in production to your frontend origin
-------------------------------*/
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_ORIGIN || '*'); // tighten in prod
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    req.header('Access-Control-Request-Headers') || 'Content-Type, Authorization'
  );
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/* ------------------------------
   PARSING + REQUEST LOGGING
-------------------------------*/
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

/* ------------------------------
   SUPABASE INITIALIZERS
-------------------------------*/
function getSupabaseUrl() {
  return process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || null;
}
function getAnonKey() {
  return process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || null;
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
   MAILER (Gmail note below)
-------------------------------*/
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS // recommended: use an app password, not account password
  }
});

/* ------------------------------
   HEALTH CHECK
-------------------------------*/
app.get('/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

/* ------------------------------
   API ROUTES (example placeholders)
   Put your real /api/* route handlers here
-------------------------------*/
app.post('/api/signup', async (req, res) => {
  // example: use supabaseClient() and bcrypt here
  return res.json({ ok: true, note: 'signup endpoint placeholder' });
});

app.post('/api/login', async (req, res) => {
  return res.json({ ok: true, note: 'login endpoint placeholder' });
});

app.get('/api/health-supabase', async (_req, res) => {
  const sb = supabaseClient();
  if (!sb) return res.status(500).json({ ok: false, error: 'Supabase client missing' });
  try {
    // tiny check: call Postgres health or simple query if you have a safe table
    const result = await sb.from('pg_catalog.pg_tables').select('*').limit(1); // won't work if table doesn't exist; optional
    return res.json({ ok: true, supabase: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

/* ------------------------------
   SHIM ROUTES (keeps old paths working)
-------------------------------*/
const shim = (from, to, method = 'post') => {
  app[method](from, (req, res, next) => {
    // forward the request to internal path
    req.url = to;
    app._router.handle(req, res, next);
  });
};

shim('/signup', '/api/signup');
shim('/login', '/api/login');
shim('/lock-account', '/api/lock-account');
shim('/send-email', '/api/send-email-raw');
shim('/approve', '/api/approve', 'get');
shim('/reject', '/api/reject', 'get');

/* ------------------------------
   STATIC FRONTEND SERVE (production)
   If you build a client into "client/build", serve that.
   Otherwise, this will serve `public/` if present.
-------------------------------*/
const clientBuildPath = path.join(__dirname, 'client', 'build');
const publicPath = path.join(__dirname, 'public');

if (process.env.NODE_ENV === 'production' && require('fs').existsSync(clientBuildPath)) {
  console.log('Serving client from', clientBuildPath);
  app.use(express.static(clientBuildPath));
  // fallback for SPA (only for non /api routes)
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) return res.status(404).json({ error: 'API route not found' });
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
} else if (require('fs').existsSync(publicPath)) {
  console.log('Serving static files from', publicPath);
  app.use(express.static(publicPath));
  // example special-case root page if present
  app.get('/', (req, res) => res.sendFile(path.join(publicPath, 'HornetHiveLogin.html')));
} else {
  // fallback simple root for quick verification
  app.get('/', (req, res) => {
    res.send('HornetHive backend — API is up. Use /api/... for endpoints.');
  });
}

/* ------------------------------
   404 CATCH-ALL (after all routes)
-------------------------------*/
app.use((req, res) => {
  console.warn(`No route matched ${req.method} ${req.originalUrl}`);
  res.status(404).json({ error: "Route not found" });
});

/* ------------------------------
   START SERVER (single listen)
-------------------------------*/
app.listen(PORT, HOST, () => {
  console.log(`HornetHive backend running on ${HOST}:${PORT}`);
});

// server.js — cleaned and ready for Render
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}
const express = require('express');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');

const SALT_ROUNDS = 12;
const app = express();
const PORT = process.env.PORT || 3333;
const HOST = '0.0.0.0';

/* ------------------------------
   ENVIRONMENT DIAGNOSTICS LOGS
-------------------------------*/
console.log("=== SERVER STARTING ===");
console.log("NODE_ENV:", process.env.NODE_ENV || 'undefined');
console.log("PORT (env or fallback):", process.env.PORT || 3333);
console.log("SUPABASE_URL present?", !!process.env.SUPABASE_URL);
console.log("SUPABASE_ANON_KEY present?", !!process.env.SUPABASE_ANON_KEY || !!process.env.SUPABASE_KEY);
console.log("SUPABASE_SERVICE_ROLE_KEY present?", !!process.env.SUPABASE_SERVICE_ROLE_KEY);
console.log("EMAIL_USER present?", !!process.env.EMAIL_USER);
console.log("EMAIL_PASS present?", !!process.env.EMAIL_PASS);

/* ------------------------------
   CORS (DEV-friendly; tighten for production)
-------------------------------*/
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_ORIGIN || '*'); // set FRONTEND_ORIGIN in prod
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', req.header('Access-Control-Request-Headers') || 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/* ------------------------------
   PARSERS + REQUEST LOGGING
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
   MAILER (note: app passwords for Gmail recommended)
-------------------------------*/
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || '',
    pass: process.env.EMAIL_PASS || ''
  }
});

/* ------------------------------
   BASIC ROUTES (root + health + examples)
-------------------------------*/
app.get('/', (req, res) => {
  res.send('HornetHive backend — root ok');
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// example API route
app.get('/api/ping', (_req, res) => {
  res.json({ pong: true });
});

/* ------------------------------
   HELPER: list registered routes (for debugging)
-------------------------------*/
function listRoutes() {
  const routes = [];
  if (!app._router) return routes;
  app._router.stack.forEach((middleware) => {
    if (middleware.route) {
      const methods = Object.keys(middleware.route.methods).join(',');
      routes.push(`${methods.toUpperCase()} ${middleware.route.path}`);
    } else if (middleware.name === 'router' && middleware.handle && middleware.handle.stack) {
      middleware.handle.stack.forEach((handler) => {
        if (handler.route) {
          const methods = Object.keys(handler.route.methods).join(',');
          routes.push(`${methods.toUpperCase()} ${handler.route.path}`);
        }
      });
    }
  });
  return routes;
}

app.get('/routes', (_req, res) => {
  res.json({ routes: listRoutes() });
});

/* ------------------------------
   SHIM ROUTES (keep legacy endpoints working)
-------------------------------*/
const shim = (from, to, method = 'post') => {
  app[method](from, (req, res, next) => {
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
   YOUR API IMPLEMENTATIONS (placeholders)
   Replace with your real logic/routers as needed.
-------------------------------*/
app.post('/api/signup', async (req, res) => {
  // TODO: implement signup using supabaseClient() and bcrypt
  return res.json({ ok: true, note: 'signup placeholder' });
});

app.post('/api/login', async (req, res) => {
  // TODO: implement login
  return res.json({ ok: true, note: 'login placeholder' });
});

/* ------------------------------
   STATIC FRONTEND SERVE (production)
-------------------------------*/
const clientBuildPath = path.join(__dirname, 'client', 'build');
const publicPath = path.join(__dirname, 'public');

if (process.env.NODE_ENV === 'production' && fs.existsSync(clientBuildPath)) {
  console.log('Serving client from', clientBuildPath);
  app.use(express.static(clientBuildPath));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) return res.status(404).json({ error: 'API route not found' });
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
} else if (fs.existsSync(publicPath)) {
  console.log('Serving static files from', publicPath);
  app.use(express.static(publicPath));
  // if you want a specific root page in public:
  app.get('/', (req, res) => res.sendFile(path.join(publicPath, 'HornetHiveLogin.html')));
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
  console.log('Registered routes:', listRoutes());
});

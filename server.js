require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');
const path = require('path');

const SALT_ROUNDS = 12;
const app = express();
const PORT = process.env.PORT || 3333;

/*
   ULTRA-PERMISSIVE CORS for local dev (no cookies used)
*/
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', req.header('Access-Control-Request-Headers') || 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// JSON body parsing 
app.use(express.json());

// Simple request logger
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

//
// STATIC HOSTING FOR YOUR FRONTEND
//
app.use(express.static(path.join(__dirname, 'public')));

// Homepage route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'HornetHiveLogin.html'));
});

// Supabase Clients
const supabaseClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const supabaseAdmin  = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Mailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// Health check
app.get('/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

/* 
   All primary API routes under /api/*
   Copy all your existing /api routes here
*/

// Shim routes for convenience
const shim = (from, to, method = 'post') => {
  app[method](from, (req, res) => { req.url = to; app._router.handle(req, res); });
};
shim('/signup', '/api/signup');
shim('/login', '/api/login');
shim('/lock-account', '/api/lock-account');
shim('/send-email', '/api/send-email-raw', 'post');
shim('/approve', '/api/approve', 'get');
shim('/reject', '/api/reject', 'get');

// 404 catch-all
app.use((req, res) => {
  console.warn(`No route matched ${req.method} ${req.originalUrl}`);
  res.status(404).json({ error: 'Route not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`HornetHive backend running on port ${PORT}`);
});

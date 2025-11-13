// ===================== server.js (DEV CORS WIDE-OPEN, PORT 3333) =====================
require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');

const SALT_ROUNDS = 12;
const app = express();
// Force a dev port that isn't in use:
const PORT = 3333;

/* ----------------------------------------------------------------
   ULTRA-PERMISSIVE CORS for local dev (no cookies used)
   - Always sets Access-Control-Allow-Origin: *
   - Answers all OPTIONS preflights with 204
------------------------------------------------------------------*/
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); // OK because we do NOT use credentials/cookies
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', req.header('Access-Control-Request-Headers') || 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ===== JSON body parsing =====
app.use(express.json());

// ===== Simple request logger =====
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ===== Supabase Clients =====
const supabaseClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const supabaseAdmin  = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ===== Mailer =====
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// ===== Health check =====
app.get('/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

/* ==============================================================
   All primary routes live under /api/*
   ==============================================================*/

// --------------------- Signup ---------------------
app.post('/api/signup', async (req, res) => {
  const user = req.body;
  try {
    const { data: existingUser } = await supabaseClient
      .from('users').select('*').eq('email', user.email).maybeSingle();
    if (existingUser) return res.status(400).json({ error: 'Email already registered' });

    const hashedPassword = await bcrypt.hash(user.password, SALT_ROUNDS);

    const now = new Date();
    const password_fresh = now.toISOString();
    const password_expire = new Date(now); password_expire.setMonth(password_expire.getMonth() + 3);

    const { error } = await supabaseAdmin.from('users').insert([{
      ...user,
      password: hashedPassword,
      old_password_plain: user.password, // dev only; remove for production
      approved: false,
      password_fresh,
      password_expire: password_expire.toISOString()
    }]);
    if (error) throw error;

    const approveLink = `http://localhost:${PORT}/api/approve?email=${encodeURIComponent(user.email)}`;
    const rejectLink  = `http://localhost:${PORT}/api/reject?email=${encodeURIComponent(user.email)}`;

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.ADMIN_EMAIL,
      subject: 'New User Signup Approval',
      text: `A new user signed up:\n\nName: ${user.first_name} ${user.last_name}\nEmail: ${user.email}\n\nApprove: ${approveLink}\nReject: ${rejectLink}\n`
    });

    res.json({ message: 'Signup submitted! Waiting for admin approval.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Unexpected signup error' });
  }
});

// --------------------- Approve / Reject ---------------------
app.get('/api/approve', async (req, res) => {
  const email = req.query.email;
  try {
    const { data, error } = await supabaseAdmin.from('users').update({ approved: true }).eq('email', email).select();
    if (error) return res.status(500).send("Failed to approve user");
    if (!data || data.length === 0) return res.status(404).send("User not found");

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Your HornetHive account is approved!',
      text: 'You can now log in at http://127.0.0.1:5500/HornetHiveLogin.html'
    });

    res.send('User approved and notified!');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error approving user');
  }
});

app.get('/api/reject', async (req, res) => {
  const email = req.query.email;
  try {
    await supabaseAdmin.from('users').update({ approved: false }).eq('email', email);
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Your HornetHive account was rejected',
      text: 'Sorry, your account was not approved.'
    });
    res.send('User rejected and notified!');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error rejecting user');
  }
});

// --------------------- Send email ---------------------
app.post("/api/send-email", async (req, res) => {
  const { to, subject, message } = req.body;
  if (!to || !subject || !message) return res.status(400).json({ error: "Recipient, subject, and message are required." });
  try {
    const { data: user, error: userError } = await supabaseAdmin.from("users").select("email").eq("email", to).single();
    if (userError || !user) return res.status(404).json({ error: "No user found with that email." });

    await transporter.sendMail({ from: process.env.EMAIL_USER, to, subject, text: message });
    res.json({ message: "Email sent successfully!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to send email." });
  }
});

app.post("/api/send-email-raw", async (req, res) => {
  const { emailTo, subject, body } = req.body;
  if (!emailTo || !subject || !body) return res.status(400).json({ error: "Missing fields" });
  try {
    await transporter.sendMail({
      from: `"HornetHive Admin" <${process.env.ADMIN_EMAIL || process.env.EMAIL_USER}>`,
      to: emailTo, subject, text: body
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to send email" });
  }
});

// --------------------- Update password ---------------------
app.post("/api/update-password", async (req, res) => {
  const { email, username, newPassword } = req.body;
  if (!email || !username || !newPassword) return res.status(400).json({ message: "Email, Username, and new password are required." });

  try {
    const { data: user, error: fetchError } = await supabaseAdmin
      .from("users").select("password, old_password_plain, old_passwords")
      .eq("email", email).eq("username", username).single();
    if (fetchError) throw fetchError;
    if (!user) return res.status(404).json({ message: "No matching user found." });

    const history = user.old_passwords || [];
    if (user.old_password_plain) history.push(user.old_password_plain);

    const hashed = await bcrypt.hash(newPassword, SALT_ROUNDS);

    const { error: updateError } = await supabaseAdmin
      .from("users").update({ password: hashed, old_password_plain: newPassword, old_passwords: history })
      .eq("email", email).eq("username", username);
    if (updateError) throw updateError;

    res.json({ message: "Password updated successfully!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error updating password." });
  }
});

// --------------------- Login / Lock ---------------------
// Case-insensitive username match + plaintext -> bcrypt auto-migration
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    // 1) CASE-INSENSITIVE lookup
    const { data: user, error } = await supabaseAdmin
      .from("users")
      .select("*")
      .ilike("username", username) // matches regardless of case
      .single();

    if (error || !user) {
      return res.status(401).json({ error: "No account found with that username" });
    }
    if (!user.approved) {
      return res.status(403).json({ error: "Account awaiting approval" });
    }

    // 2) PASSWORD CHECK with migration for legacy plaintext
    const stored = user.password_hash || user.password || "";
    const looksHashed = typeof stored === "string" && stored.startsWith("$2");

    let valid = false;

    if (looksHashed) {
      // Normal path: compare against bcrypt hash
      valid = await bcrypt.compare(password, stored);
    } else {
      // Legacy path: stored plaintext — compare once, then migrate to bcrypt
      valid = stored === password;
      if (valid) {
        try {
          const newHash = await bcrypt.hash(password, SALT_ROUNDS);
          const { error: upErr } = await supabaseAdmin
            .from("users")
            .update({
              password: newHash,       // replace plaintext with hash (same column)
              old_password_plain: null // stop keeping plaintext
            })
            .eq("id", user.id);
          if (upErr) console.warn("Password migration update failed:", upErr);
        } catch (mErr) {
          console.warn("Password migration error:", mErr);
        }
      }
    }

    if (!valid) {
      return res.status(401).json({ error: "Incorrect password" });
    }

    // 3) Success: strip sensitive fields
    const { password: _p, password_hash: _ph, old_password_plain: _opp, ...safeUser } = user;
    res.json({ user: safeUser });

  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error logging in" });
  }
});

app.post("/api/lock-account", async (req, res) => {
  const { username } = req.body;
  try {
    const { error } = await supabaseAdmin.from("users").update({ approved: false }).eq("username", username);
    if (error) throw error;
    res.json({ message: "Account locked successfully" });
  } catch (err) {
    console.error("Error locking account:", err);
    res.status(500).json({ error: "Failed to lock account" });
  }
});

/* ==============================================================
   Backward-compatibility shims for older paths (if any)
   ==============================================================*/
const shim = (from, to, method = 'post') => {
  app[method](from, (req, res) => { req.url = to; app._router.handle(req, res); });
};
shim('/signup', '/api/signup');
shim('/login', '/api/login');
shim('/lock-account', '/api/lock-account');
shim('/send-email', '/api/send-email-raw', 'post');
shim('/approve', '/api/approve', 'get');
shim('/reject', '/api/reject', 'get');

// ===== 404 catch-all =====
app.use((req, res) => {
  console.warn(`No route matched ${req.method} ${req.originalUrl}`);
  res.status(404).json({ error: 'Route not found' });
});

// ===== Start =====
app.listen(PORT, () => {
  console.log(`HornetHive backend running on port ${PORT}`);
});

// ===================== server.js =====================
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== Middleware =====
app.use(cors()); // Allows cross-origin requests from frontend
app.use(express.json());

// ===== Supabase Clients =====
const supabaseClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ===== Nodemailer Setup =====
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER, // your sending Gmail
    pass: process.env.EMAIL_PASS  // Gmail App Password
  }
});

// ===================== Signup Route =====================
app.post('/signup', async (req, res) => {
  const user = req.body;

  try {
    // Check if user already exists
    const { data: existingUser } = await supabaseClient
      .from('users')
      .select('*')
      .eq('email', user.email)
      .maybeSingle();

    if (existingUser) return res.status(400).json({ error: 'Email already registered' });

    // Insert new user with approved: false
    const { error } = await supabaseAdmin
      .from('users')
      .insert([{ ...user, approved: false }]);

    if (error) throw error;

    // Send admin approval email
    const approveLink = `http://localhost:${PORT}/approve?email=${encodeURIComponent(user.email)}`;
    const rejectLink = `http://localhost:${PORT}/reject?email=${encodeURIComponent(user.email)}`;

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.ADMIN_EMAIL,
      subject: 'New User Signup Approval',
      text: `
A new user signed up:

Name: ${user.first_name} ${user.last_name}
Email: ${user.email}

Approve: ${approveLink}
Reject: ${rejectLink}
      `
    });

    res.json({ message: 'Signup submitted! Waiting for admin approval.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Unexpected signup error' });
  }
});

// Approve Route 
app.get('/approve', async (req, res) => {
  const email = req.query.email;

  try {
    // Update user to approved: true
    const { data, error } = await supabaseAdmin
      .from('users')
      .update({ approved: true })
      .eq('email', email);

    // Error handling logs
    if (error) {
      console.error("Supabase update error:", error);
      return res.status(500).send("Failed to approve user");
    }

    // Optionally check if a row was updated
    if (!data || data.length === 0) {
      console.warn(`No user found for email: ${email}`);
      return res.status(404).send("User not found");
    }

    // Notify user they can log in
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Your HornetHive account is approved!',
      text: 'You can now log in at http://127.0.0.1:5500/HornetHiveLogin.html'
    });

    res.send('User approved and notified!');
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).send('Error approving user');
  }
});


// Reject Route 
app.get('/reject', async (req, res) => {
  const email = req.query.email;

  try {
    // Update user to approved: false
    await supabaseAdmin
      .from('users')
      .update({ approved: false })
      .eq('email', email);

    // Notify user of rejection
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

// ===================== Forgot Password Route =====================
app.post("/api/auth/forgot", async (req, res) => {
  const { email, username } = req.body;

  try {
    // 1️⃣ Validate both email and username belong to same user
    const { data: user, error } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("email", email)
      .eq("username", username)
      .single();

    if (error || !user) {
      return res.status(400).json({ error: "Email and username do not match any account." });
    }

    // 2️⃣ Create a simple reset link (you can customize this page later)
    const resetLink = `http://127.0.0.1:5500/ResetPassword.html?email=${encodeURIComponent(email)}`;

    // 3️⃣ Send reset link via Nodemailer
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Hornet Hive Password Reset Request",
      text: `
Hi ${user.first_name},

We received a request to reset your Hornet Hive password.

Click the link below to reset your password:
${resetLink}

If you did not request this, you can safely ignore this email.
      `
    });

    console.log(`Password reset email sent to ${email}`);
    res.json({ message: "If the email and username match, a reset link has been sent." });
  } catch (err) {
    console.error("Forgot password error:", err);
    res.status(500).json({ error: "Failed to send password reset email." });
  }
});


// Start Server 
app.listen(PORT, () => {
  console.log(`HornetHive backend running on port ${PORT}`);
});

// ===================== server.js =====================
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');
const SALT_ROUNDS = 12;

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

    // ✅ Hash the password before saving
    const hashedPassword = await bcrypt.hash(user.password, 12);
    await supabaseAdmin.from('users').insert([{ ...user, password_hash: hashedPassword }]);


    // Insert new user with hashed password and approved: false
    const { error } = await supabaseAdmin
      .from('users')
      .insert([{ 
        ...user,
        password: hashedPassword,   // save hashed password
        approved: false
      }]);

    if (error) throw error;

    // Send admin approval email (unchanged)
    const approveLink = `http://localhost:${PORT}/approve?email=${encodeURIComponent(user.email)}`;
    const rejectLink  = `http://localhost:${PORT}/reject?email=${encodeURIComponent(user.email)}`;

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
      .eq('email', email)
      .select(); 

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

// ===================== Update Password Route =====================
app.post("/api/update-password", async (req, res) => {
  const { email, username, newPassword } = req.body;

  if (!email || !username || !newPassword) {
    return res.status(400).json({ message: "Email, Username, and new password are required." });
  }

  try {
    // Fetch current password and old_passwords
    const { data: user, error: fetchError } = await supabaseAdmin
      .from("users")
      .select("password, old_passwords")
      .eq("email", email)
      .eq("username", username)
      .single();

    if (fetchError) throw fetchError;
    if (!user) return res.status(404).json({ message: "No matching user found." });

    const previousPasswords = user.old_passwords || [];

    // Prevent reusing old passwords
    if (previousPasswords.includes(newPassword) || user.password === newPassword) {
      return res.status(400).json({ message: "You cannot reuse a previous password." });
    }

    // Append current password to old_passwords (keep last 5)
    const updatedOldPasswords = [...previousPasswords, user.password].slice(-5);

    // Update password and old_passwords
    const { data, error: updateError } = await supabaseAdmin
      .from("users")
      .update({
        password: newPassword,           // TODO: consider hashing
        old_passwords: updatedOldPasswords
      })
      .eq("email", email)
      .eq("username", username)
      .select();

    if (updateError) throw updateError;

    res.json({ message: "Password updated successfully!" });
  } catch (err) {
    console.error("Error updating password:", err);
    res.status(500).json({ message: "Server error updating password." });
  }
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    const { data: user, error } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("username", username)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: "No account found with that username" });
    }

    if (!user.approved) {
      return res.status(403).json({ error: "Account awaiting approval" });
    }

    const valid = await bcrypt.compare(password, user.password_hash || user.password);
    if (!valid) {
      return res.status(401).json({ error: "Incorrect password" });
    }

    const { password: _drop, password_hash, ...safeUser } = user;
    res.json({ user: safeUser });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error logging in" });
  }
});

app.post("/lock-account", async (req, res) => {
  const { username } = req.body;

  try {
    const { error } = await supabaseAdmin
      .from("users")
      .update({ approved: false })
      .eq("username", username);

    if (error) throw error;

    res.json({ message: "Account locked successfully" });
  } catch (err) {
    console.error("Error locking account:", err);
    res.status(500).json({ error: "Failed to lock account" });
  }
});



// Start Server 
app.listen(PORT, () => {
  console.log(`HornetHive backend running on port ${PORT}`);
});

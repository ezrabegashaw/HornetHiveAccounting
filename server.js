require("dotenv").config();
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const { createClient } = require("@supabase/supabase-js");
const bcrypt = require("bcrypt");
const path = require("path");

const SALT_ROUNDS = 12;
const app = express();
const PORT = process.env.PORT || 3333;

// ===== Middleware =====
app.use(cors());
app.use(express.json());

// Serve static files (HTML, CSS, JS) from project root
app.use(express.static(__dirname));

// ===== Supabase Setup =====
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// ===== Mailer =====
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// ===== Routes =====

// Health check
app.get("/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Serve login page
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "HornetHiveLogin.html"));
});

// ===== LOGIN =====
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const { data: user, error } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("username", username)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (!user.approved) {
      return res.status(403).json({ error: "Account not approved yet" });
    }

    // Always return JSON
    res.json({ user });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ===== SIGNUP =====
app.post("/api/signup", async (req, res) => {
  const { username, password, email, first_name, last_name } = req.body;
  try {
    if (!username || !password || !email) return res.status(400).json({ error: "Missing required fields" });

    const { data: existingUser } = await supabaseAdmin
      .from("users")
      .select("*")
      .ilike("username", username)
      .single();

    if (existingUser) return res.status(400).json({ error: "Username already exists" });

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    const now = new Date();
    const password_fresh = now.toISOString();
    const password_expire = new Date(now);
    password_expire.setMonth(password_expire.getMonth() + 3);

    const { data, error } = await supabaseAdmin.from("users").insert([{
      username,
      password: hashedPassword,
      email,
      first_name: first_name || "",
      last_name: last_name || "",
      approved: false,
      password_fresh,
      password_expire: password_expire.toISOString()
    }]).select();

    if (error) return res.status(500).json({ error: error.message });

    // Optional: send admin notification
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.ADMIN_EMAIL,
      subject: "New HornetHive Signup",
      text: `New user: ${username} (${email})`
    });

    return res.json({ message: "Signup submitted! Waiting for approval", user: data[0] });
  } catch (err) {
    console.error("Signup error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ===== SEND APPROVAL EMAIL =====
app.post("/api/approve", async (req, res) => {
  const { email } = req.body;
  try {
    if (!email) return res.status(400).json({ error: "Email required" });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "HornetHive account approved",
      text: "Your account is approved. You can now log in."
    });

    return res.json({ message: "Approval email sent" });
  } catch (err) {
    console.error("Approval email error:", err);
    return res.status(500).json({ error: "Error sending email" });
  }
});

// ===== 404 catch-all =====
app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// ===== Start Server =====
app.listen(PORT, () => {
  console.log(`HornetHive backend running on port ${PORT}`);
});

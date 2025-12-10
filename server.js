require("dotenv").config();
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const { createClient } = require("@supabase/supabase-js");
const bcrypt = require("bcrypt");
const path = require("path");

const SALT_ROUNDS = 12;
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // serve static HTML, CSS, JS, images

// Supabase setup
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false }
});

// Serve the login page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "HornetHiveLogin.html"));
});

// ===== LOGIN =====
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const { data: user, error } = await supabaseAdmin
      .from("users")
      .select("*")
      .ilike("username", username)
      .single();

    if (error || !user) return res.status(401).json({ error: "Invalid username or password" });
    if (!user.approved) return res.status(403).json({ error: "Account not approved yet" });

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) return res.status(401).json({ error: "Invalid credentials" });

    // strip sensitive fields
    const { password: _p, ...safeUser } = user;

    res.json({ user: safeUser });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ===== SIGNUP =====
app.post("/api/signup", async (req, res) => {
  const { username, password, email, first_name, last_name } = req.body;
  try {
    const hashed = await bcrypt.hash(password, SALT_ROUNDS);
    const { data, error } = await supabaseAdmin
      .from("users")
      .insert([{ username, password: hashed, email, first_name, last_name, approved: false }])
      .select();

    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: "User created, waiting for approval", user: data[0] });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ===== APPROVAL EMAIL EXAMPLE =====
app.post("/api/approve", async (req, res) => {
  const { email } = req.body;
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Your HornetHive account has been approved",
      text: "You can now log in!"
    });

    res.json({ message: "Approval email sent" });
  } catch (err) {
    console.error("Email error:", err);
    res.status(500).json({ error: "Error sending email" });
  }
});

// ===== 404 Catch-all =====
app.use((req, res) => {
  console.warn(`[${new Date().toISOString()}] No route matched ${req.method} ${req.originalUrl}`);
  res.status(404).json({ error: "Route not found" });
});

// ===== START SERVER =====
const PORT = process.env.PORT || 3333;
app.listen(PORT, () => console.log(`HornetHive backend running on port ${PORT}`));

// message.js
// Handles bell, dropdown, message loading, unread highlight, and replies

(function () {
  const SUPABASE_URL = "https://rsthdogcmqwcdbqppsrm.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJzdGhkb2djbXF3Y2RicXBwc3JtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYwNTY3NDcsImV4cCI6MjA3MTYzMjc0N30.EoOxjSIjGHbw6ltNisWYq6yKXdrOfE6XVdh5mERbrSY";

  // Try to reuse existing client from auth.js, else create our own
  let supabaseClient = window.supabaseClient;
  if (!supabaseClient && window.supabase) {
    const { createClient } = window.supabase;
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }

  if (!supabaseClient) {
    console.warn("[message.js] Supabase client not available.");
    return;
  }

  let currentUserId = null;
  let currentUsername = null;

  document.addEventListener("DOMContentLoaded", async () => {
    // Try to get user_id from your existing session helper
    currentUserId = localStorage.getItem("user_id") || null;
    currentUsername = localStorage.getItem("username") || "Admin";

    if (!currentUserId) {
      try {
        const { data: { user } } = await supabaseClient.auth.getUser();
        if (user) currentUserId = user.id;
      } catch (e) {
        console.warn("[message.js] Could not resolve user from auth:", e);
      }
    }

    if (!currentUserId) {
      console.warn("[message.js] No logged-in user; notifications disabled.");
      return;
    }

    const bell = document.getElementById("notifBell");
    const dropdown = document.getElementById("notifDropdown");
    const badge = document.getElementById("notifBadge");

    if (!bell || !dropdown || !badge) {
      console.warn("[message.js] Bell or dropdown elements not found.");
      return;
    }

    // Toggle dropdown
    bell.addEventListener("click", () => {
      dropdown.style.display = dropdown.style.display === "block" ? "none" : "block";
    });

    // Close dropdown on outside click
    document.addEventListener("click", (e) => {
      const wrap = document.querySelector(".notification-wrapper");
      if (!wrap) return;
      if (!wrap.contains(e.target) && dropdown.style.display === "block") {
        dropdown.style.display = "none";
      }
    });

    // Load initial notifications
    await loadNotifications();

    // Realtime subscription for new messages
    try {
      supabaseClient
        .channel("messages_live")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages" },
          (payload) => {
            if (payload.new && payload.new.receiver_id === currentUserId) {
              loadNotifications();
            }
          }
        )
        .subscribe();
    } catch (e) {
      console.warn("[message.js] Realtime subscribe failed:", e);
    }

    // Modal handlers
    const modal = document.getElementById("messageModal");
    const closeBtn = document.getElementById("closeModal");
    if (closeBtn && modal) {
      closeBtn.addEventListener("click", () => {
        modal.style.display = "none";
      });
    }

    const replyForm = document.getElementById("replyForm");
    if (replyForm && modal) {
      replyForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const messageId = replyForm.dataset.messageId;
        const replyBodyEl = document.getElementById("replyBody");
        const body = replyBodyEl.value.trim();
        if (!body) {
          alert("Please enter a reply before sending.");
          return;
        }

        try {
          // Load original message to get sender_id and subject
          const { data: msg, error } = await supabaseClient
            .from("messages")
            .select("id, sender_id, subject")
            .eq("id", messageId)
            .single();

          if (error || !msg) {
            console.error("[message.js] Could not load original message for reply:", error);
            return;
          }

          // Insert reply (back to original sender)
          const { error: insertError } = await supabaseClient.from("messages").insert({
            sender_id: currentUserId,
            receiver_id: msg.sender_id,
            subject: "Re: " + (msg.subject || "No subject"),
            body
          });

          if (insertError) {
            console.error("[message.js] Error sending reply:", insertError);
            alert("There was an error sending the reply.");
            return;
          }

          replyBodyEl.value = "";
          modal.style.display = "none";
          alert("Reply sent!");
          loadNotifications();
        } catch (err) {
          console.error("[message.js] Unexpected reply error:", err);
          alert("Unexpected error sending reply.");
        }
      });
    }
  });

  // Load notifications for current user
  async function loadNotifications() {
    const list = document.getElementById("notifList");
    const badge = document.getElementById("notifBadge");
    if (!list || !badge) return;

    list.innerHTML = '<li class="notif-empty">Loading...</li>';

    try {
      const { data: messages, error } = await supabaseClient
        .from("messages")
        .select("id, sender_id, subject, body, is_read, created_at")
        .eq("receiver_id", currentUserId)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("[message.js] Error loading messages:", error);
        list.innerHTML = '<li class="notif-empty">Error loading messages.</li>';
        return;
      }

      if (!messages || messages.length === 0) {
        list.innerHTML = '<li class="notif-empty">No notifications</li>';
        badge.style.display = "none";
        return;
      }

      // Lookup sender usernames from users table
      const senderIds = [...new Set(messages.map(m => m.sender_id).filter(Boolean))];
      let senderMap = {};
      if (senderIds.length > 0) {
        const { data: senders, error: senderErr } = await supabaseClient
          .from("users")
          .select("id, username")
          .in("id", senderIds);

        if (!senderErr && senders) {
          senderMap = senders.reduce((acc, s) => {
            acc[s.id] = s.username || "User";
            return acc;
          }, {});
        }
      }

      const unreadCount = messages.filter(m => !m.is_read).length;
      if (unreadCount > 0) {
        badge.style.display = "block";
        badge.textContent = unreadCount > 9 ? "9+" : String(unreadCount);
      } else {
        badge.style.display = "none";
      }

      list.innerHTML = "";

      messages.forEach(msg => {
        const senderName = senderMap[msg.sender_id] || "Unknown";
        const created = msg.created_at ? new Date(msg.created_at) : null;
        const timeStr = created ? created.toLocaleString() : "";

        const li = document.createElement("li");
        li.className = "notif-item" + (msg.is_read ? "" : " unread");
        li.innerHTML = `
          <div class="notif-top-row">
            <span class="notif-sender">${escapeHtml(senderName)}</span>
            <span class="notif-time">${escapeHtml(timeStr)}</span>
          </div>
          <div class="notif-subject">${escapeHtml(msg.subject || "No subject")}</div>
          <div class="notif-preview">${escapeHtml((msg.body || "").slice(0, 80))}${msg.body && msg.body.length > 80 ? "..." : ""}</div>
        `;

        li.addEventListener("click", () => openMessage(msg.id));
        list.appendChild(li);
      });
    } catch (e) {
      console.error("[message.js] Unexpected error loading notifications:", e);
      list.innerHTML = '<li class="notif-empty">Error loading messages.</li>';
    }
  }

  // Open a message in modal
  async function openMessage(id) {
    const modal = document.getElementById("messageModal");
    const subjEl = document.getElementById("msgSubject");
    const metaEl = document.getElementById("msgMeta");
    const bodyEl = document.getElementById("msgBody");
    const replyForm = document.getElementById("replyForm");

    if (!modal || !subjEl || !metaEl || !bodyEl || !replyForm) return;

    try {
      // Load message
      const { data: msg, error } = await supabaseClient
        .from("messages")
        .select("id, sender_id, subject, body, created_at, is_read")
        .eq("id", id)
        .single();

      if (error || !msg) {
        console.error("[message.js] Error loading message:", error);
        return;
      }

      // Load sender name
      let senderName = "Unknown";
      if (msg.sender_id) {
        const { data: sender, error: senderErr } = await supabaseClient
          .from("users")
          .select("username")
          .eq("id", msg.sender_id)
          .maybeSingle();

        if (!senderErr && sender && sender.username) {
          senderName = sender.username;
        }
      }

      const created = msg.created_at ? new Date(msg.created_at) : null;
      const timeStr = created ? created.toLocaleString() : "";

      subjEl.textContent = msg.subject || "No subject";
      metaEl.textContent = `From: ${senderName} • ${timeStr}`;
      bodyEl.textContent = msg.body || "";

      replyForm.dataset.messageId = msg.id;
      modal.style.display = "flex";

      // Mark as read
      if (!msg.is_read) {
        await supabaseClient.from("messages").update({ is_read: true }).eq("id", id);
        loadNotifications();
      }
    } catch (e) {
      console.error("[message.js] Unexpected error opening message:", e);
    }
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[m]));
  }

})();

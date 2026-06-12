const app = document.querySelector("#app");
const toastRegion = document.querySelector("#toast-region");

const state = {
  user: null,
  rooms: [],
  currentRoom: null,
  messages: [],
  eventSource: null,
  authMode: "signin",
};

const icons = {
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/></svg>`,
  logout: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 17l5-5-5-5M15 12H3"/><path d="M14 3h6v18h-6"/></svg>`,
  send: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>`,
};

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function initials(name) {
  return String(name)
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" }).format(timestamp);
}

function formatRelative(timestamp) {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Intl.DateTimeFormat([], { month: "short", day: "numeric" }).format(timestamp);
}

function showToast(message, type = "") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastRegion.append(toast);
  setTimeout(() => toast.remove(), 3_400);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Something went wrong.");
  return payload;
}

function brand() {
  return `
    <div class="brand">
      <div class="brand-mark" aria-hidden="true"><span></span><span></span></div>
      Relay
    </div>
  `;
}

function renderLanding() {
  const signUp = state.authMode === "signup";
  app.innerHTML = `
    <main class="landing">
      <nav class="landing-nav">
        ${brand()}
        <div class="nav-note">Browser-based and ready now</div>
      </nav>

      <section class="hero">
        <div class="hero-copy">
          <p class="eyebrow">No downloads. Just a code.</p>
          <h1>A room is only a <em>code</em> away.</h1>
          <p class="hero-subtitle">
            Create a private space, share six characters, and start talking.
            Messages wait when friends are away, so no one misses the moment.
          </p>
          <div class="trust-row">
            <div class="trust-item"><span class="trust-icon">✓</span> Any browser</div>
            <div class="trust-item"><span class="trust-icon">#</span> One simple code</div>
            <div class="trust-item"><span class="trust-icon">∞</span> Two or more people</div>
          </div>
        </div>

        <div class="auth-card">
          <div class="auth-inner">
            <div class="auth-tabs" role="tablist">
              <button class="auth-tab ${!signUp ? "active" : ""}" data-auth-mode="signin">Sign in</button>
              <button class="auth-tab ${signUp ? "active" : ""}" data-auth-mode="signup">Create account</button>
            </div>
            <h2 class="auth-heading">${signUp ? "Join the conversation" : "Welcome back"}</h2>
            <p class="auth-copy">
              ${signUp ? "Your first room is a few seconds away." : "Sign in to open your rooms and messages."}
            </p>
            <form id="auth-form" class="form-stack">
              ${
                signUp
                  ? `<div class="field">
                      <label for="display-name">DISPLAY NAME</label>
                      <input id="display-name" name="displayName" autocomplete="name" placeholder="How friends see you" required maxlength="32" />
                    </div>`
                  : ""
              }
              <div class="field">
                <label for="username">USERNAME</label>
                <input id="username" name="username" autocomplete="username" placeholder="your_username" required maxlength="24" />
              </div>
              <div class="field">
                <label for="password">PASSWORD</label>
                <input id="password" name="password" type="password" autocomplete="${signUp ? "new-password" : "current-password"}" placeholder="At least 8 characters" required minlength="8" />
              </div>
              <button class="primary-button ${signUp ? "purple" : ""}" type="submit">
                ${signUp ? "Create my account" : "Sign in to Relay"}
              </button>
            </form>
            <p class="auth-footnote">Private rooms · No app installation · Works anywhere</p>
          </div>
        </div>
      </section>

      <section class="feature-strip" aria-label="How Relay works">
        <article class="feature">
          <div class="feature-number">01</div>
          <div><h3>Create your room</h3><p>Name the space and get a unique code instantly.</p></div>
        </article>
        <article class="feature">
          <div class="feature-number">02</div>
          <div><h3>Share the code</h3><p>Friends enter it once and can return whenever they like.</p></div>
        </article>
        <article class="feature">
          <div class="feature-number">03</div>
          <div><h3>Talk on your time</h3><p>Incoming messages stay safe until you come back online.</p></div>
        </article>
      </section>
    </main>
  `;

  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.authMode = button.dataset.authMode;
      renderLanding();
    });
  });
  document.querySelector("#auth-form").addEventListener("submit", handleAuth);
}

async function handleAuth(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  const values = Object.fromEntries(new FormData(event.currentTarget));
  button.disabled = true;
  button.textContent = state.authMode === "signup" ? "Creating…" : "Signing in…";
  try {
    const result = await api(`/api/${state.authMode}`, {
      method: "POST",
      body: JSON.stringify(values),
    });
    state.user = result.user;
    await loadDashboard();
  } catch (error) {
    showToast(error.message, "error");
    button.disabled = false;
    button.textContent = state.authMode === "signup" ? "Create my account" : "Sign in to Relay";
  }
}

function sidebar() {
  return `
    <aside class="sidebar">
      ${brand()}
      <p class="sidebar-label">Workspace</p>
      <button class="side-link active">${icons.home}<span>My rooms</span></button>
      <div class="sidebar-user">
        <div class="avatar" style="background:${state.user.color}">${escapeHTML(initials(state.user.displayName))}</div>
        <div class="user-text">
          <strong>${escapeHTML(state.user.displayName)}</strong>
          <span>@${escapeHTML(state.user.username)}</span>
        </div>
        <button class="icon-button" id="signout-button" aria-label="Sign out">${icons.logout}</button>
      </div>
    </aside>
  `;
}

async function loadDashboard() {
  closeEvents();
  state.currentRoom = null;
  const result = await api("/api/rooms");
  state.rooms = result.rooms;
  renderDashboard();
}

function renderDashboard() {
  const today = new Intl.DateTimeFormat([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date());
  app.innerHTML = `
    <div class="dashboard">
      ${sidebar()}
      <main class="dashboard-main">
        <div class="content-wrap">
          <header class="page-heading">
            <div>
              <h1>Good to see you, ${escapeHTML(state.user.displayName.split(" ")[0])}.</h1>
              <p>Start a room or step back into a conversation.</p>
            </div>
            <div class="date-chip">${escapeHTML(today)}</div>
          </header>

          <section class="action-grid">
            <article class="action-card create">
              <p class="action-kicker">Start something new</p>
              <h2>Create your own room</h2>
              <p>Choose a name. We will make a private code for you to share.</p>
              <form id="create-room-form" class="inline-form">
                <input name="name" placeholder="Weekend plans" required maxlength="48" />
                <button type="submit">Create</button>
              </form>
            </article>
            <article class="action-card join">
              <p class="action-kicker">Have an invitation?</p>
              <h2>Join with a code</h2>
              <p>Enter the six characters your friend shared. That is all you need.</p>
              <form id="join-room-form" class="inline-form">
                <input name="code" placeholder="ABC123" required maxlength="6" autocomplete="off" />
                <button type="submit">Join room</button>
              </form>
            </article>
          </section>

          <section>
            <div class="section-heading">
              <h2>Your rooms</h2>
              <span>${state.rooms.length} ${state.rooms.length === 1 ? "room" : "rooms"}</span>
            </div>
            <div class="room-list">
              ${
                state.rooms.length
                  ? state.rooms.map(roomRow).join("")
                  : `<div class="empty-state"><strong>No rooms yet</strong>Create one above, then share the code with a friend.</div>`
              }
            </div>
          </section>
        </div>
      </main>
    </div>
  `;

  document.querySelector("#signout-button").addEventListener("click", signOut);
  document.querySelector("#create-room-form").addEventListener("submit", createRoom);
  document.querySelector("#join-room-form").addEventListener("submit", joinRoom);
  document.querySelectorAll("[data-room-code]").forEach((row) => {
    row.addEventListener("click", () => openRoom(row.dataset.roomCode));
  });
}

function roomRow(room) {
  return `
    <button class="room-row" data-room-code="${room.code}">
      <div class="room-icon">${escapeHTML(room.name[0])}</div>
      <div class="room-info">
        <strong>${escapeHTML(room.name)}</strong>
        <span>${room.participantCount} ${room.participantCount === 1 ? "person" : "people"} · ${formatRelative(room.lastActivity)}</span>
      </div>
      <span class="code-badge">${room.code}</span>
      <span class="room-arrow">›</span>
    </button>
  `;
}

async function createRoom(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const result = await api("/api/rooms", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    showToast(`Room created. Code: ${result.room.code}`);
    await openRoom(result.room.code);
  } catch (error) {
    showToast(error.message, "error");
    button.disabled = false;
  }
}

async function joinRoom(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const values = Object.fromEntries(new FormData(form));
    const result = await api("/api/rooms/join", {
      method: "POST",
      body: JSON.stringify(values),
    });
    await openRoom(result.room.code);
  } catch (error) {
    showToast(error.message, "error");
    button.disabled = false;
  }
}

async function openRoom(code) {
  try {
    closeEvents();
    const [roomResult, messageResult] = await Promise.all([
      api(`/api/rooms/${code}`),
      api(`/api/rooms/${code}/messages`),
    ]);
    state.currentRoom = roomResult.room;
    state.messages = messageResult.messages;
    renderChat();
    connectEvents(code);
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderChat() {
  const room = state.currentRoom;
  app.innerHTML = `
    <div class="chat-shell">
      <aside class="chat-side">
        <div class="chat-side-top">
          ${brand()}
          <button class="back-button" data-leave-room>← Rooms</button>
        </div>
        <div class="room-identity">
          <div class="room-icon">${escapeHTML(room.name[0])}</div>
          <h1>${escapeHTML(room.name)}</h1>
          <p class="room-code-large">ROOM CODE · ${room.code}</p>
          <button class="copy-code" id="copy-code">Copy invitation code</button>
        </div>
        <p class="participant-title">People in this room</p>
        <div class="participant-list" id="participant-list">${participantsHTML(room.participants)}</div>
        <div class="privacy-note">
          <strong>Your return stays tidy</strong>
          After you leave, your own messages from this visit will be hidden when you return. Messages from friends stay.
        </div>
      </aside>

      <main class="chat-main">
        <header class="chat-header">
          <div style="display:flex;align-items:center">
            <button class="mobile-back" data-leave-room aria-label="Back to rooms">←</button>
            <div>
              <h2>${escapeHTML(room.name)}</h2>
              <p class="presence-copy" id="presence-copy">${presenceText(room)}</p>
            </div>
          </div>
          <div class="connection connecting" id="connection-state">Connecting</div>
        </header>
        <section class="messages" id="messages" aria-live="polite"></section>
        <div class="composer-wrap">
          <form class="composer" id="message-form">
            <textarea class="message-input" name="text" id="message-input" rows="1" maxlength="2000" placeholder="Write a message…" aria-label="Message"></textarea>
            <button class="send-button" type="submit" aria-label="Send message">${icons.send}</button>
          </form>
          <p class="composer-hint">Press Enter to send · Shift + Enter for a new line</p>
        </div>
      </main>
    </div>
  `;

  renderMessages();
  document.querySelectorAll("[data-leave-room]").forEach((button) => button.addEventListener("click", leaveRoom));
  document.querySelector("#copy-code").addEventListener("click", copyCode);
  document.querySelector("#message-form").addEventListener("submit", sendMessage);
  const input = document.querySelector("#message-input");
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      document.querySelector("#message-form").requestSubmit();
    }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 130)}px`;
  });
  input.focus();
}

function participantsHTML(participants) {
  return participants
    .map(
      (person) => `
        <div class="participant">
          <div class="avatar" style="background:${person.color}">${escapeHTML(initials(person.displayName))}</div>
          <span class="participant-name">${escapeHTML(person.displayName)}${person.id === state.user.id ? " (you)" : ""}</span>
          <span class="online-dot ${person.online ? "" : "offline"}" title="${person.online ? "Online" : "Offline"}"></span>
        </div>
      `,
    )
    .join("");
}

function presenceText(room) {
  const online = room.onlineCount || 0;
  return `${room.participantCount} ${room.participantCount === 1 ? "person" : "people"} · ${online} online`;
}

function renderMessages() {
  const container = document.querySelector("#messages");
  if (!container) return;
  if (!state.messages.length) {
    container.innerHTML = `
      <div class="message-empty">
        <div class="message-empty-icon">✦</div>
        <strong>This room is ready.</strong>
        <p>Send the first message or share the code with a friend.</p>
      </div>
    `;
    return;
  }
  container.innerHTML = `
    <div class="day-divider">Conversation</div>
    ${state.messages.map(messageHTML).join("")}
  `;
  container.scrollTop = container.scrollHeight;
}

function messageHTML(message) {
  return `
    <article class="message-row ${message.own ? "own" : ""}" data-message-id="${message.id}">
      <div class="avatar" style="background:${message.sender.color}">${escapeHTML(initials(message.sender.displayName))}</div>
      <div class="message-content">
        <p class="message-meta">${escapeHTML(message.own ? "You" : message.sender.displayName)} · ${formatTime(message.createdAt)}</p>
        <div class="bubble">${escapeHTML(message.text)}</div>
      </div>
    </article>
  `;
}

function connectEvents(code) {
  const source = new EventSource(`/api/rooms/${code}/events`);
  state.eventSource = source;
  source.onopen = () => {
    const indicator = document.querySelector("#connection-state");
    if (indicator) {
      indicator.textContent = "Live";
      indicator.classList.remove("connecting");
    }
  };
  source.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!state.messages.some((item) => item.id === message.id)) {
      state.messages.push(message);
      renderMessages();
    }
  });
  source.addEventListener("room", (event) => {
    state.currentRoom = JSON.parse(event.data);
    const participantList = document.querySelector("#participant-list");
    const presence = document.querySelector("#presence-copy");
    if (participantList) participantList.innerHTML = participantsHTML(state.currentRoom.participants);
    if (presence) presence.textContent = presenceText(state.currentRoom);
  });
  source.onerror = () => {
    const indicator = document.querySelector("#connection-state");
    if (indicator) {
      indicator.textContent = "Reconnecting";
      indicator.classList.add("connecting");
    }
  };
}

function closeEvents() {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
}

async function sendMessage(event) {
  event.preventDefault();
  const input = document.querySelector("#message-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  input.style.height = "auto";
  try {
    const result = await api(`/api/rooms/${state.currentRoom.code}/messages`, {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    if (!state.messages.some((item) => item.id === result.message.id)) {
      state.messages.push(result.message);
      renderMessages();
    }
    input.focus();
  } catch (error) {
    input.value = text;
    showToast(error.message, "error");
  }
}

async function leaveRoom() {
  if (!state.currentRoom) return;
  const code = state.currentRoom.code;
  closeEvents();
  try {
    await api(`/api/rooms/${code}/leave`, { method: "POST", body: "{}" });
  } catch {
    // The dashboard remains usable even if the leave marker cannot be saved.
  }
  await loadDashboard();
}

async function copyCode() {
  try {
    await navigator.clipboard.writeText(state.currentRoom.code);
    showToast(`Copied ${state.currentRoom.code}`);
  } catch {
    showToast(`Room code: ${state.currentRoom.code}`);
  }
}

async function signOut() {
  await api("/api/signout", { method: "POST", body: "{}" });
  state.user = null;
  state.rooms = [];
  renderLanding();
}

window.addEventListener("beforeunload", () => {
  if (state.currentRoom) {
    navigator.sendBeacon(`/api/rooms/${state.currentRoom.code}/leave`, new Blob(["{}"], { type: "application/json" }));
  }
});

async function boot() {
  try {
    const result = await api("/api/me");
    state.user = result.user;
    if (state.user) await loadDashboard();
    else renderLanding();
  } catch {
    renderLanding();
  }
}

boot();

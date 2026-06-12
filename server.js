const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_FILE = process.env.CHAT_DATA_FILE || path.join(__dirname, "data", "store.json");
const SESSION_TTL = 1000 * 60 * 60 * 24 * 30;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const sessions = new Map();
const roomStreams = new Map();
let store = loadStore();

function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("Could not read data store:", error);
    }
    return { users: [], rooms: [], messages: [] };
  }
}

function saveStore() {
  const directory = path.dirname(DATA_FILE);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(store, null, 2));
  fs.renameSync(temporary, DATA_FILE);
}

function json(res, status, payload, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(JSON.stringify(payload));
}

function parseCookies(req) {
  const cookies = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) {
      cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1));
    }
  }
  return cookies;
}

function currentUser(req) {
  const token = parseCookies(req).relay_session;
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (session) sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL;
  return store.users.find((user) => user.id === session.userId) || null;
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    color: user.color,
  };
}

function requireUser(req, res) {
  const user = currentUser(req);
  if (!user) json(res, 401, { error: "Please sign in to continue." });
  return user;
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 32_768) {
        reject(new Error("Request is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function randomId(bytes = 12) {
  return crypto.randomBytes(bytes).toString("hex");
}

function randomColor() {
  const colors = ["#6C5CE7", "#F15B6C", "#008E89", "#D67D00", "#3971D6", "#A63D88"];
  return colors[crypto.randomInt(colors.length)];
}

function createRoomCode() {
  let code;
  do {
    code = Array.from({ length: 6 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join("");
  } while (store.rooms.some((room) => room.code === code));
  return code;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  return {
    salt,
    hash: crypto.scryptSync(password, salt, 64).toString("hex"),
  };
}

function passwordMatches(password, user) {
  const actual = Buffer.from(hashPassword(password, user.passwordSalt).hash, "hex");
  const expected = Buffer.from(user.passwordHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function startSession(user, res) {
  const token = randomId(24);
  sessions.set(token, { userId: user.id, expiresAt: Date.now() + SESSION_TTL });
  return {
    "Set-Cookie": `relay_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL / 1000}`,
  };
}

function roomForCode(code) {
  return store.rooms.find((room) => room.code === code.toUpperCase());
}

function membershipFor(room, userId) {
  return room.memberships.find((membership) => membership.userId === userId);
}

function onlineUserIds(code) {
  const streams = roomStreams.get(code);
  return streams ? new Set(streams.keys()) : new Set();
}

function serializeRoom(room, userId) {
  const online = onlineUserIds(room.code);
  const participants = room.memberships
    .map((membership) => store.users.find((user) => user.id === membership.userId))
    .filter(Boolean)
    .map((user) => ({ ...publicUser(user), online: online.has(user.id) }));
  const roomMessages = store.messages.filter((message) => message.roomId === room.id);
  const lastMessage = roomMessages.at(-1);
  return {
    id: room.id,
    code: room.code,
    name: room.name,
    createdAt: room.createdAt,
    lastActivity: lastMessage?.createdAt || room.createdAt,
    owner: room.ownerId === userId,
    participantCount: participants.length,
    onlineCount: participants.filter((participant) => participant.online).length,
    participants,
  };
}

function serializeMessage(message, viewerId) {
  const sender = store.users.find((user) => user.id === message.senderId);
  return {
    id: message.id,
    text: message.text,
    createdAt: message.createdAt,
    own: message.senderId === viewerId,
    sender: sender ? publicUser(sender) : { displayName: "Former member", color: "#777" },
  };
}

function visibleMessages(room, userId) {
  const membership = membershipFor(room, userId);
  return store.messages
    .filter((message) => message.roomId === room.id)
    .filter((message) => {
      if (message.senderId !== userId) return true;
      return !membership.hiddenOwnBefore || message.createdAt > membership.hiddenOwnBefore;
    })
    .slice(-300)
    .map((message) => serializeMessage(message, userId));
}

function writeEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcastRoomState(room) {
  const streams = roomStreams.get(room.code);
  if (!streams) return;
  for (const [userId, responses] of streams) {
    const payload = serializeRoom(room, userId);
    for (const response of responses) writeEvent(response, "room", payload);
  }
}

function broadcastMessage(room, message) {
  const streams = roomStreams.get(room.code);
  if (!streams) return;
  for (const [userId, responses] of streams) {
    const payload = serializeMessage(message, userId);
    for (const response of responses) writeEvent(response, "message", payload);
  }
}

function addStream(room, user, req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");

  if (!roomStreams.has(room.code)) roomStreams.set(room.code, new Map());
  const users = roomStreams.get(room.code);
  if (!users.has(user.id)) users.set(user.id, new Set());
  users.get(user.id).add(res);
  broadcastRoomState(room);

  const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), 20_000);
  req.on("close", () => {
    clearInterval(keepAlive);
    const responses = users.get(user.id);
    if (responses) {
      responses.delete(res);
      if (!responses.size) users.delete(user.id);
    }
    if (!users.size) roomStreams.delete(room.code);
    broadcastRoomState(room);
  });
}

async function handleApi(req, res, url) {
  const method = req.method;
  const route = url.pathname;

  if (method === "POST" && route === "/api/signup") {
    const body = await readBody(req);
    const username = String(body.username || "").trim().toLowerCase();
    const displayName = String(body.displayName || "").trim();
    const password = String(body.password || "");
    if (!/^[a-z0-9_]{3,24}$/.test(username)) {
      return json(res, 400, { error: "Username must be 3-24 letters, numbers, or underscores." });
    }
    if (displayName.length < 2 || displayName.length > 32) {
      return json(res, 400, { error: "Display name must be 2-32 characters." });
    }
    if (password.length < 8) {
      return json(res, 400, { error: "Password must be at least 8 characters." });
    }
    if (store.users.some((user) => user.username === username)) {
      return json(res, 409, { error: "That username is already taken." });
    }
    const passwordData = hashPassword(password);
    const user = {
      id: randomId(),
      username,
      displayName,
      color: randomColor(),
      passwordSalt: passwordData.salt,
      passwordHash: passwordData.hash,
      createdAt: Date.now(),
    };
    store.users.push(user);
    saveStore();
    return json(res, 201, { user: publicUser(user) }, startSession(user, res));
  }

  if (method === "POST" && route === "/api/signin") {
    const body = await readBody(req);
    const username = String(body.username || "").trim().toLowerCase();
    const user = store.users.find((candidate) => candidate.username === username);
    if (!user || !passwordMatches(String(body.password || ""), user)) {
      return json(res, 401, { error: "Incorrect username or password." });
    }
    return json(res, 200, { user: publicUser(user) }, startSession(user, res));
  }

  if (method === "POST" && route === "/api/signout") {
    const token = parseCookies(req).relay_session;
    if (token) sessions.delete(token);
    return json(res, 200, { ok: true }, {
      "Set-Cookie": "relay_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
    });
  }

  if (method === "GET" && route === "/api/me") {
    const user = currentUser(req);
    return json(res, 200, { user: user ? publicUser(user) : null });
  }

  const user = requireUser(req, res);
  if (!user) return;

  if (method === "GET" && route === "/api/rooms") {
    const rooms = store.rooms
      .filter((room) => membershipFor(room, user.id))
      .map((room) => serializeRoom(room, user.id))
      .sort((a, b) => b.lastActivity - a.lastActivity);
    return json(res, 200, { rooms });
  }

  if (method === "POST" && route === "/api/rooms") {
    const body = await readBody(req);
    const name = String(body.name || "").trim();
    if (name.length < 2 || name.length > 48) {
      return json(res, 400, { error: "Room name must be 2-48 characters." });
    }
    const room = {
      id: randomId(),
      code: createRoomCode(),
      name,
      ownerId: user.id,
      createdAt: Date.now(),
      memberships: [{ userId: user.id, joinedAt: Date.now(), hiddenOwnBefore: null }],
    };
    store.rooms.push(room);
    saveStore();
    return json(res, 201, { room: serializeRoom(room, user.id) });
  }

  if (method === "POST" && route === "/api/rooms/join") {
    const body = await readBody(req);
    const code = String(body.code || "").trim().toUpperCase();
    const room = roomForCode(code);
    if (!room) return json(res, 404, { error: "We could not find a room with that code." });
    if (!membershipFor(room, user.id)) {
      room.memberships.push({ userId: user.id, joinedAt: Date.now(), hiddenOwnBefore: null });
      saveStore();
      broadcastRoomState(room);
    }
    return json(res, 200, { room: serializeRoom(room, user.id) });
  }

  const roomMatch = route.match(/^\/api\/rooms\/([A-Z0-9]{6})(?:\/(messages|events|leave))?$/i);
  if (roomMatch) {
    const room = roomForCode(roomMatch[1]);
    const action = roomMatch[2] || "";
    if (!room) return json(res, 404, { error: "Room not found." });
    const membership = membershipFor(room, user.id);
    if (!membership) return json(res, 403, { error: "Join this room before opening it." });

    if (method === "GET" && !action) {
      return json(res, 200, { room: serializeRoom(room, user.id) });
    }
    if (method === "GET" && action === "messages") {
      return json(res, 200, { messages: visibleMessages(room, user.id) });
    }
    if (method === "GET" && action === "events") {
      return addStream(room, user, req, res);
    }
    if (method === "POST" && action === "messages") {
      const body = await readBody(req);
      const text = String(body.text || "").trim();
      if (!text) return json(res, 400, { error: "Write a message first." });
      if (text.length > 2_000) return json(res, 400, { error: "Messages can be up to 2,000 characters." });
      const message = {
        id: randomId(),
        roomId: room.id,
        senderId: user.id,
        text,
        createdAt: Date.now(),
      };
      store.messages.push(message);
      saveStore();
      broadcastMessage(room, message);
      return json(res, 201, { message: serializeMessage(message, user.id) });
    }
    if (method === "POST" && action === "leave") {
      membership.hiddenOwnBefore = Date.now();
      saveStore();
      return json(res, 200, { ok: true });
    }
  }

  return json(res, 404, { error: "Not found." });
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function serveStatic(res, url) {
  const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const filePath = path.resolve(PUBLIC_DIR, requested);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== path.join(PUBLIC_DIR, "index.html")) {
    return json(res, 403, { error: "Forbidden." });
  }
  fs.readFile(filePath, (error, data) => {
    if (error) return json(res, error.code === "ENOENT" ? 404 : 500, { error: "File not found." });
    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
    } else {
      serveStatic(res, url);
    }
  } catch (error) {
    console.error(error);
    if (!res.headersSent) json(res, 400, { error: error.message || "Something went wrong." });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Relay is running at http://${HOST}:${PORT}`);
});

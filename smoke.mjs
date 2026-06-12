import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataFile = path.join(root, "tests", "tmp-store.json");
const port = 3211;
const origin = `http://127.0.0.1:${port}`;

await unlink(dataFile).catch(() => {});

const server = spawn(process.execPath, ["server.js"], {
  cwd: root,
  env: { ...process.env, PORT: String(port), CHAT_DATA_FILE: dataFile },
  stdio: ["ignore", "pipe", "pipe"],
});

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${origin}/api/me`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Test server did not start.");
}

function client() {
  let cookie = "";
  return async (route, options = {}) => {
    const response = await fetch(`${origin}${route}`, {
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...options,
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const body = await response.json();
    assert.equal(response.ok, true, `${response.status}: ${body.error || route}`);
    return body;
  };
}

try {
  await waitForServer();
  const alex = client();
  const sam = client();

  await alex("/api/signup", {
    method: "POST",
    body: JSON.stringify({ displayName: "Alex Chen", username: "alex", password: "password1" }),
  });
  await sam("/api/signup", {
    method: "POST",
    body: JSON.stringify({ displayName: "Sam Rivera", username: "sam", password: "password2" }),
  });

  const created = await alex("/api/rooms", {
    method: "POST",
    body: JSON.stringify({ name: "Launch crew" }),
  });
  const code = created.room.code;
  assert.match(code, /^[A-Z0-9]{6}$/);

  await sam("/api/rooms/join", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
  await alex(`/api/rooms/${code}/messages`, {
    method: "POST",
    body: JSON.stringify({ text: "Message from Alex" }),
  });

  let samMessages = await sam(`/api/rooms/${code}/messages`);
  assert.equal(samMessages.messages.at(-1).text, "Message from Alex");

  await alex(`/api/rooms/${code}/leave`, { method: "POST", body: "{}" });
  await sam(`/api/rooms/${code}/messages`, {
    method: "POST",
    body: JSON.stringify({ text: "Offline message for Alex" }),
  });

  const alexMessages = await alex(`/api/rooms/${code}/messages`);
  assert.deepEqual(
    alexMessages.messages.map((message) => message.text),
    ["Offline message for Alex"],
  );

  console.log("Smoke test passed: auth, room codes, offline delivery, and leave privacy.");
} finally {
  server.kill();
  await unlink(dataFile).catch(() => {});
}

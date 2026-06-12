import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { unlink } from "node:fs/promises";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const playwrightModule = process.env.PLAYWRIGHT_MODULE;
if (!playwrightModule) throw new Error("Set PLAYWRIGHT_MODULE to Playwright's index.mjs path.");

const { chromium } = await import(pathToFileURL(playwrightModule).href);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataFile = path.join(root, "tests", "tmp-browser-store.json");
const port = 3212;
const origin = `http://127.0.0.1:${port}`;

await unlink(dataFile).catch(() => {});
const server = spawn(process.execPath, ["server.js"], {
  cwd: root,
  env: { ...process.env, PORT: String(port), CHAT_DATA_FILE: dataFile },
  stdio: "ignore",
});

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(`${origin}/api/me`)).ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Browser test server did not start.");
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE || undefined,
  });

  const alexContext = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const alex = await alexContext.newPage();
  await alex.goto(origin);
  await alex.screenshot({ path: path.join(root, "tests", "relay-home.png"), fullPage: true });
  assert.equal(await alex.locator("h1").textContent(), "A room is only a code away.");

  await alex.getByRole("button", { name: "Create account" }).click();
  await alex.getByLabel("DISPLAY NAME").fill("Alex Browser");
  await alex.getByLabel("USERNAME").fill("alex_browser");
  await alex.getByLabel("PASSWORD").fill("password1");
  await alex.getByRole("button", { name: "Create my account" }).click();
  await alex.getByText("Good to see you, Alex.").waitFor();

  await alex.locator("#create-room-form input").fill("Friday circle");
  await alex.getByRole("button", { name: "Create", exact: true }).click();
  await alex.getByRole("heading", { name: "Friday circle", exact: true }).first().waitFor();
  const codeCopy = await alex.locator(".room-code-large").textContent();
  const code = codeCopy.match(/[A-Z0-9]{6}/)?.[0];
  assert.ok(code);

  await alex.getByRole("textbox", { name: "Message", exact: true }).fill("Alex message from this visit");
  await alex.getByRole("button", { name: "Send message" }).click();
  await alex.getByText("Alex message from this visit").waitFor();

  const jordanContext = await browser.newContext({ viewport: { width: 1100, height: 850 } });
  const jordan = await jordanContext.newPage();
  await jordan.goto(origin);
  await jordan.getByRole("button", { name: "Create account" }).click();
  await jordan.getByLabel("DISPLAY NAME").fill("Jordan Friend");
  await jordan.getByLabel("USERNAME").fill("jordan_friend");
  await jordan.getByLabel("PASSWORD").fill("password2");
  await jordan.getByRole("button", { name: "Create my account" }).click();
  await jordan.locator("#join-room-form input").fill(code);
  await jordan.getByRole("button", { name: "Join room" }).click();
  await jordan.getByRole("heading", { name: "Friday circle", exact: true }).first().waitFor();
  await jordan.getByRole("textbox", { name: "Message", exact: true }).fill("Jordan live message");
  await jordan.getByRole("button", { name: "Send message" }).click();
  await alex.getByText("Jordan live message").waitFor();

  await alex.getByRole("button", { name: "Rooms" }).click();
  await alex.getByText("Good to see you, Alex.").waitFor();
  await alex.getByText("Friday circle", { exact: true }).click();
  await alex.getByText("Jordan live message").waitFor();
  assert.equal(await alex.getByText("Alex message from this visit").count(), 0);

  await alex.setViewportSize({ width: 390, height: 844 });
  await alex.screenshot({ path: path.join(root, "tests", "relay-chat-mobile.png"), fullPage: true });

  console.log(`Browser check passed with room code ${code}.`);
} finally {
  if (browser) await browser.close();
  server.kill();
  await unlink(dataFile).catch(() => {});
}

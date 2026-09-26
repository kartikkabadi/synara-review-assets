// Live repro for PR #1345: retained vs unretained Electron Notifications on Windows.
// Ports createDesktopNotificationRetainer logic inline from apps/desktop/src/notificationRetention.ts.
const { app, BrowserWindow, Notification } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

try {
  require("node:v8").setFlagsFromString("--expose-gc");
  global.gc = require("node:vm").runInNewContext("gc");
} catch (e) {}

const LOG = path.join(__dirname, "repro-log.txt");
fs.writeFileSync(LOG, `repro start ${new Date().toISOString()} electron=${process.versions.electron} supported=${Notification.isSupported()} aumid=${app.getAppUserModelId?.()}\n`);
const log = (line) => {
  fs.appendFileSync(LOG, `${new Date().toISOString().slice(11, 19)} ${line}\n`);
  try { process.stdout.write(line + "\n"); } catch {}
};

// --- inline port of notificationRetention.ts ---
const retained = new Set();
function release(n) { retained.delete(n); log(`release size=${retained.size}`); }
function retain(n) {
  retained.add(n);
  while (retained.size > 50) {
    const oldest = retained.values().next().value;
    if (oldest === undefined) break;
    retained.delete(oldest);
  }
  n.once("click", () => release(n));
  n.once("failed", () => release(n));
  n.on("close", (details) => {
    if (details?.reason !== "timedOut") release(n);
  });
}
// ------------------------------------------------

function wire(label, n) {
  n.on("show", () => log(`show ${label}`));
  n.on("click", () => log(`click ${label}`));
  n.on("close", (d) => log(`close ${label} reason=${d?.reason}`));
  n.on("failed", (e) => log(`failed ${label} ${e}`));
}

function showUnretained() {
  const n = new Notification({ title: "UNRETAINED", body: "click me", timeoutType: "never" });
  wire("UNRETAINED", n);
  n.show();
}

function showRetained() {
  const n = new Notification({ title: "RETAINED", body: "click me", timeoutType: "never" });
  wire("RETAINED", n);
  retain(n);
  n.show();
}

let round = 0;
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 320, height: 200, x: 0, y: 0 });
  win.loadURL("data:text/html,<h1>repro</h1>");

  showRetained();
  showUnretained();

  setInterval(() => {
    if (global.gc) { global.gc(); log("gc"); }
  }, 2000);

  // Re-show a fresh pair every 45s so toasts can be observed/clicked live.
  setInterval(() => {
    round++;
    log(`reshow round ${round}`);
    showRetained();
    showUnretained();
  }, 45000);

  setInterval(() => log(`alive retained=${retained.size}`), 30000);
  log("ready");
});

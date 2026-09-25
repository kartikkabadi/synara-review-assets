// repro.mjs — verbatim JS transcription of PR #1344 (head 63475f2) code paths:
//   prependPathEntry  <- apps/server/src/provider/Layers/ProviderHealth.ts
//   envPathKeyFor     <- packages/shared/src/executable.ts
//   mergePathEntries  <- packages/shared/src/shell.ts
//   isPathName        <- packages/shared/src/shell.ts
import { spawnSync, spawn } from "node:child_process";
import assert from "node:assert/strict";

function envPathKeyFor(env, platform = process.platform) {
  if ("PATH" in env) return "PATH";
  if ("Path" in env) return "Path";
  if ("path" in env) {
    return platform === "win32" ? "path" : "PATH";
  }
  return "PATH";
}

function mergePathEntries(preferredPath, inheritedPath, platform) {
  const delimiter = platform === "win32" ? ";" : ":";
  const isWindows = platform === "win32";
  const merged = [];
  const seen = new Set();
  const dedupKey = (entry) =>
    isWindows ? entry.toLowerCase().replace(/[\\/]+$/, "") : entry;
  for (const pathValue of [preferredPath, inheritedPath]) {
    if (!pathValue) continue;
    for (const entry of pathValue.split(delimiter)) {
      const trimmedEntry = entry.trim();
      if (!trimmedEntry) continue;
      const key = dedupKey(trimmedEntry);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(trimmedEntry);
    }
  }
  return merged.length > 0 ? merged.join(delimiter) : undefined;
}

function isPathName(name) {
  return name.toUpperCase() === "PATH";
}

const prependPathEntry = (env, entry, platform = process.platform) => {
  const pathKeys = Object.keys(env).filter((key) =>
    platform === "win32" ? isPathName(key) : key === "PATH",
  );
  const envPathKey = envPathKeyFor(
    Object.fromEntries(pathKeys.map((key) => [key, ""])),
    platform,
  );
  const orderedKeys = [envPathKey, ...pathKeys.filter((key) => key !== envPathKey)];
  const inheritedPath = orderedKeys.reduce(
    (merged, key) => mergePathEntries(merged, env[key], platform),
    undefined,
  );
  const nextEnv = { ...env };
  for (const key of pathKeys) delete nextEnv[key];
  nextEnv[envPathKey] = mergePathEntries(entry, inheritedPath, platform) ?? entry;
  return nextEnv;
};

const canon = (o) =>
  JSON.stringify(Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1))));

console.log("platform:", process.platform);
console.log("=== prependPathEntry assertions ===");

// 1. single Path key gets merged under Path
const r1 = prependPathEntry({ Path: "C:\\Windows;C:\\real", HOME: "h" }, "C:\\npm", "win32");
const e1 = { Path: "C:\\npm;C:\\Windows;C:\\real", HOME: "h" };
console.log("r1:", JSON.stringify(r1));
assert.equal(canon(r1), canon(e1));
console.log("r1 PASS");

// 2. Path+PATH -> single PATH key (the one Node keeps), values merged PATH-first
const r2 = prependPathEntry({ Path: "C:\\Windows", PATH: "C:\\short" }, "C:\\npm", "win32");
const e2 = { PATH: "C:\\npm;C:\\short;C:\\Windows" };
console.log("r2:", JSON.stringify(r2));
assert.equal(canon(r2), canon(e2));
console.log("r2 PASS");

// 3. posix: only literal PATH touched, lowercase path untouched
const r3 = prependPathEntry({ PATH: "/usr/bin:/opt/bin", path: "ignored" }, "/opt/bin", "linux");
const e3 = { PATH: "/opt/bin:/usr/bin", path: "ignored" };
console.log("r3:", JSON.stringify(r3));
assert.equal(canon(r3), canon(e3));
console.log("r3 PASS");

const CMD = `${process.env.SystemRoot || "C:\\Windows"}\\System32\\cmd.exe`;
console.log("cmd:", CMD);

console.log("=== real spawn check (cmd /c echo %PATH%) ===");
const show = (label, env) => {
  const r = spawnSync(CMD, ["/c", "echo %PATH%"], { env, encoding: "utf8", timeout: 10000 });
  const out = (r.stdout || "").trim();
  console.log(`${label} -> status=${r.status} signal=${r.signal} err=${r.error ? r.error.code : "none"}`);
  console.log(`${label} PATH=[${out}]`);
  return out;
};

// new env from #1: one Path key carrying prepend + inherited
const mergedEnv = r1;
const outNew = show("new(merged Path)", mergedEnv);
// old buggy shape: Path (full) + PATH (prepend only) -> child sees only PATH
const buggyEnv = { Path: "C:\\Windows;C:\\real", PATH: "C:\\npm" };
const outOld = show("old(Path+PATH)", buggyEnv);

assert.equal(outNew, "C:\\npm;C:\\Windows;C:\\real");
assert.equal(outOld, "C:\\npm");
console.log("spawn assertions PASS (merged env gives full path; duplicated env loses it)");

console.log("=== stdin check (cmd /c set /p x=& echo got %x%) ===");
const stdinCmd = ["/c", "set /p x=& echo got %x%"];
const t0 = Date.now();
const rIg = spawnSync(CMD, stdinCmd, {
  env: mergedEnv,
  stdio: ["ignore", "pipe", "pipe"],
  encoding: "utf8",
  timeout: 5000,
});
const tIgnore = Date.now() - t0;
console.log(`ignore -> ${tIgnore}ms status=${rIg.status} signal=${rIg.signal} out=${JSON.stringify((rIg.stdout || "").trim())}`);

const t1 = Date.now();
const rPipe = spawnSync(CMD, stdinCmd, {
  env: mergedEnv,
  stdio: "pipe",
  encoding: "utf8",
  timeout: 5000,
});
const tPipe = Date.now() - t1;
console.log(`pipe   -> ${tPipe}ms status=${rPipe.status} signal=${rPipe.signal} err=${rPipe.error ? rPipe.error.code : "none"} out=${JSON.stringify((rPipe.stdout || "").trim())}`);

// async spawn with stdin "ignore" (post-fix shape)
await new Promise((resolve) => {
  const t2 = Date.now();
  const child = spawn(CMD, stdinCmd, { env: mergedEnv, stdio: ["ignore", "pipe", "pipe"] });
  child.on("exit", (code) => {
    console.log(`async ignore -> exited code=${code} at ${Date.now() - t2}ms`);
    resolve();
  });
});

// async spawn with stdin pipe left open (what the spawner did before the fix)
await new Promise((resolve) => {
  const t2 = Date.now();
  const child = spawn(CMD, stdinCmd, { env: mergedEnv, stdio: "pipe" });
  let done = false;
  const timer = setTimeout(() => {
    if (!done) {
      done = true;
      console.log(`async pipe -> still blocked at ${Date.now() - t2}ms, killing (hang reproduced)`);
      child.kill();
      resolve();
    }
  }, 4000);
  child.on("exit", () => {
    if (!done) {
      done = true;
      clearTimeout(timer);
      console.log(`async pipe -> exited at ${Date.now() - t2}ms`);
      resolve();
    }
  });
});

console.log(`SUMMARY: ignore=${tIgnore}ms pipe(spawnSync)=${tPipe}ms (timedOut=${rPipe.signal === "SIGTERM" || !!rPipe.error})`);
console.log("ALL CHECKS DONE");

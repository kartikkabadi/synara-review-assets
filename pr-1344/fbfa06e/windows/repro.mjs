// repro.ts — PR #1344 verification: Windows PATH key collision + stdin "ignore"
// node:child_process.spawn — the mechanism Effect's NodeServices spawner wraps.
// Run: node repro.ts  (also runnable under `bun repro.ts`)

import { spawn } from "node:child_process";

function run(cmd, args, opts) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, {
      env: opts.env,
      stdio: [opts.stdin ?? "ignore", "pipe", "pipe"],
      shell: false,
      windowsVerbatimArguments: true,
    });
    let out = "", err = "";
    p.stdout?.on("data", (d) => (out += d));
    p.stderr?.on("data", (d) => (err += d));
    const timer = setTimeout(() => { try { p.kill(); } catch {} }, opts.timeoutMs);
    const t0 = Date.now();
    p.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ out: out.trim(), err: err.trim(), code, signal, ms: Date.now() - t0 });
    });
    p.on("error", (e) => { clearTimeout(timer); resolve({ out, err: String(e), code: "SPAWN-ERR", signal: null, ms: Date.now() - t0 }); });
  });
}

const sys32 = "C:\\Windows\\system32";
const cmd = `${sys32}\\cmd.exe`;

console.log("=== PATH key test (synthetic env) ===");
// (a) OLD behavior: literal `PATH` key added beside the environment's existing `Path` key
const a = await run(cmd, ["/c", "echo %PATH%"], {
  env: { Path: `${sys32};C:\\realpath`, PATH: "C:\\prepended", SYSTEMROOT: "C:\\Windows" },
  stdin: "ignore", timeoutMs: 10_000,
});
console.log(`a) env{Path: real, PATH: prepended} -> child %PATH%:`);
console.log(`   ${JSON.stringify(a.out)}  exit=${a.code} ${a.ms}ms`);

// (b) NEW behavior: prepend folded into the existing `Path` key
const b = await run(cmd, ["/c", "echo %PATH%"], {
  env: { Path: `C:\\prepended;${sys32};C:\\realpath`, SYSTEMROOT: "C:\\Windows" },
  stdin: "ignore", timeoutMs: 10_000,
});
console.log(`b) env{Path: prepended;real merged} -> child %PATH%:`);
console.log(`   ${JSON.stringify(b.out)}  exit=${b.code} ${b.ms}ms`);

console.log("\n=== stdin behavior test ===");
// (c) stdin = open pipe, never written -> `set /p` blocks until timeout kill
const c = await run(cmd, ["/c", "set /p x= & echo got %x%"], {
  env: { Path: sys32, SYSTEMROOT: "C:\\Windows" },
  stdin: "pipe", timeoutMs: 5_000,
});
console.log(`c) stdin=pipe   -> ${JSON.stringify(c.out)} code=${c.code} signal=${c.signal} ${c.ms}ms (hit 5s kill => blocked on stdin)`);

// (d) stdin = "ignore" -> NUL device: immediate EOF, exits at once
const d = await run(cmd, ["/c", "set /p x= & echo got %x%"], {
  env: { Path: sys32, SYSTEMROOT: "C:\\Windows" },
  stdin: "ignore", timeoutMs: 5_000,
});
console.log(`d) stdin=ignore -> ${JSON.stringify(d.out)} code=${d.code} signal=${d.signal} ${d.ms}ms`);

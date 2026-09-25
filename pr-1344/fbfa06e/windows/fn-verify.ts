// Verifies the real envPathKeyFor from the PR checkout + the exact prependPathEntry impl.
import { envPathKeyFor } from "C:/Users/Administrator/repos/synara-verify/packages/shared/src/executable.ts";
import * as OS from "node:os";

// Exact copy of the new code in ProviderHealth.ts (fbfa06e)
const prependPathEntry = (env: NodeJS.ProcessEnv, entry: string): NodeJS.ProcessEnv => {
  const envPathKey = envPathKeyFor(env);
  return {
    ...env,
    [envPathKey]: [entry, env[envPathKey]]
      .filter((value): value is string => Boolean(value))
      .join(OS.platform() === "win32" ? ";" : ":"),
  };
};

console.log("platform:", process.platform);
console.log("envPathKeyFor({Path}) =", envPathKeyFor({ Path: "C:\\Windows" }));
console.log("envPathKeyFor({PATH}) =", envPathKeyFor({ PATH: "/usr/bin" }));
console.log("envPathKeyFor({path}) =", envPathKeyFor({ path: "x" }));
console.log("envPathKeyFor({}) =", envPathKeyFor({}));

const env1 = prependPathEntry({ Path: "C:\\Windows", HOME: "home" } as any, "npm-bin");
console.log("prepend({Path:'C:\\Windows'},'npm-bin') =", JSON.stringify(env1));
// Test expectation: { Path: "npm-bin;C:\\Windows", HOME: "home" } on win32
const env2 = prependPathEntry({ HOME: "home" } as any, "npm-bin");
console.log("prepend({HOME},'npm-bin') =", JSON.stringify(env2));
// Test expectation: { HOME: "home", PATH: "npm-bin" }

// Real-world shape: Windows process.env has "Path" — ensure no literal "PATH" key is added
const winEnv = { Path: "C:\\Windows\\system32;C:\\Windows", USERPROFILE: "C:\\U" } as any;
const out = prependPathEntry(winEnv, "C:\\prep");
console.log("win result keys:", Object.keys(out).join(","));
console.log("win Path value:", JSON.stringify(out.Path), "| stray PATH?:", "PATH" in out);

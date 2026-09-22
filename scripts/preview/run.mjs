import { spawn } from "node:child_process";
import { resolve, relative } from "node:path";
import { existsSync } from "node:fs";
import { root, loadSettings } from "./settings.mjs";

const mode = process.argv[2];
if (!["db", "dev", "build", "verify", "script"].includes(mode)) {
  throw new Error("Usage: npm run preview:db | preview | preview:build | preview:verify [-- scripts/verify-name.ts]");
}
if (process.env.NODE_ENV === "production" && mode !== "build") {
  throw new Error("Preview cannot run with NODE_ENV=production; use a local development shell");
}
const extra = process.argv.slice(3);
if (extra.length && !["script", "verify"].includes(mode)) throw new Error("This preview command does not accept additional arguments");

function checkedVerifyFile(filename) {
  const absolute = resolve(root, filename);
  const local = relative(root, absolute).replaceAll("\\", "/");
  if (!/^scripts\/verify-[a-z0-9-]+\.ts$/.test(local) || !existsSync(absolute)) {
    throw new Error("Only existing scripts/verify-*.ts verification scripts are allowed");
  }
  return absolute;
}

const settings = loadSettings();
const executable = process.env.CREATOR_PREVIEW_NODE || process.execPath;
const env = {
  ...process.env, ...settings,
  NODE_ENV: mode === "build" ? "production" : "development",
  CREATOR_LOCAL_PREVIEW: "1",
  CREATOR_PREVIEW_BUILD: mode === "build" ? "1" : "",
  NEXT_TELEMETRY_DISABLED: "1",
  NODE_OPTIONS: `--require="${resolve(root, "scripts/preview/preload.cjs").replaceAll("\\", "/")}"`,
};
const next = resolve(root, "node_modules/next/dist/bin/next");
const suite = [
  "verify-add-creator", "verify-quick-analysis", "verify-auto-stage", "verify-outreach-flow",
  "verify-editors", "verify-email-ingest", "verify-gmail-sync", "verify-email-body",
  "verify-next-step", "verify-design", "verify-workspace", "verify-workspace-db", "verify-creator-workspace",
  "verify-message-draft", "verify-gmail-health", "verify-gmail-sync-outcome",
  "verify-follow-up-coverage", "verify-gmail-sync-partial", "verify-preview-cookies", "verify-invariants",
];
const commands = mode === "db" ? [[resolve(root, "scripts/preview/server.mjs")]]
  : mode === "dev" ? [[next, "dev", "--hostname", "127.0.0.1", "--port", "3003"]]
  : mode === "build" ? [[next, "build"]]
  : mode === "script" ? [extra.length === 1 ? ["--require", "tsx/cjs", checkedVerifyFile(extra[0])] : (() => {throw new Error("Provide exactly one verification script");})()]
  : [
    [resolve(root, "scripts/preview/verify-boundary.mjs")],
    ...(extra.length ? extra.map(checkedVerifyFile) : suite.map(name => checkedVerifyFile(`scripts/${name}.ts`)))
      .map(filename => ["--require", "tsx/cjs", filename]),
  ];

async function run(args) {
  console.log(`[preview] ${mode === "verify" || mode === "script" ? relative(root, args.at(-1)) : mode}`);
  return new Promise((accept, reject) => {
    const child = spawn(executable, args, { cwd: root, env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => accept(signal ? 1 : (code ?? 1)));
  });
}
for (const command of commands) {
  const exitCode = await run(command);
  if (exitCode !== 0) { process.exitCode = exitCode; break; }
}

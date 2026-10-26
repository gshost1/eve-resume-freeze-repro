// Usage: MODE=dev|start node repro.mjs
// Kills the eve server while a tool is running, starts it again (`eve dev --resume`, or `eve start`,
// which always recovers local runs), then times how long the interrupted step takes to run again.
// Offline: a scripted mockModel, no provider or API key. MODE=start needs `npx eve build` in app/ first.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MODE = process.env.MODE ?? "dev";
const WAIT_S = Number(process.env.WAIT_SECONDS ?? 1000);
const HERE = dirname(fileURLToPath(import.meta.url));
const app = join(HERE, "app");
const SIDE = join(HERE, "side.txt");
const port = 2300 + Math.floor(Math.random() * 500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const at = () => `[${((Date.now() - t0) / 1000).toFixed(1)}s]`;
const side = () => (existsSync(SIDE) ? readFileSync(SIDE, "utf8").split("\n").filter(Boolean) : []);
const count = (re) => side().filter((l) => re.test(l)).length;
async function until(test, seconds) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) { if (test()) return true; await sleep(200); }
  return false;
}

rmSync(SIDE, { force: true });
rmSync(join(app, ".eve", ".workflow-data"), { recursive: true, force: true });

function startServer(extraArgs) {
  const args = MODE === "start"
    ? ["start", "--host", "127.0.0.1", "--port", String(port), "--no-schedules"]
    : ["dev", "--no-ui", "--host", "127.0.0.1", "--port", String(port), "--no-default-extensions", ...extraArgs];
  // detached: the kill below hits the whole process group (`eve start` serves from a child process).
  const child = spawn(process.execPath, [join(app, "node_modules/eve/bin/eve.js"), ...args], {
    cwd: app, detached: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, SIDE_LOG: SIDE, EVE_TELEMETRY_DISABLED: "1", NO_COLOR: "1", CI: "1" },
  });
  let log = "";
  child.stdout.on("data", (c) => (log += c));
  child.stderr.on("data", (c) => (log += c));
  const exited = new Promise((r) => child.once("exit", r));
  const ready = (async () => {
    for (let i = 0; i < 600; i++) {
      if (child.exitCode !== null) throw new Error(`eve ${MODE} exited:\n${log.slice(-1500)}`);
      try { if ((await fetch(`http://127.0.0.1:${port}/eve/v1/health`)).ok) return `http://127.0.0.1:${port}`; } catch {}
      await sleep(200);
    }
    throw new Error(`eve ${MODE} did not start:\n${log.slice(-1500)}`);
  })();
  const kill = async (sig) => { try { process.kill(-child.pid, sig); } catch {} await exited; };
  return { ready, kill, log: () => log };
}

const { Client } = await import(join(app, "node_modules/eve/dist/src/client/index.js"));
const connect = (base) => new Client({ baseUrl: base, host: base });

let server = startServer([]);
let client = connect(await server.ready);
console.log(`${at()} eve ${MODE} up`);
const created = await client.sessions.create({ message: "plan:effect-a,slow-25,effect-b" });
const sessionId = created.session?.state?.sessionId ?? created.session?.sessionId;
(async () => { try { for await (const _ of created.response); } catch {} })();
await until(() => count(/slow-start/) === 1, 30);
const stepStartedAt = Date.now();
console.log(`${at()} slow tool started (session ${sessionId})`);
await sleep(3000);
await server.kill("SIGKILL");
console.log(`${at()} server killed with SIGKILL mid-tool`);
// Part of a SIGKILLed eve server can keep answering on its port for a while before it exits.
// Wait until the port is free so the restart below is the only server.
const portFree = async () => { try { await fetch(`http://127.0.0.1:${port}/eve/v1/health`, { signal: AbortSignal.timeout(1000) }); return false; } catch { return true; } };
const freedAt = Date.now();
while (!(await portFree())) await sleep(500);
console.log(`${at()} port free after ${((Date.now() - freedAt) / 1000).toFixed(1)}s`);

server = startServer(["--resume"]);
client = connect(await server.ready);
const restartedAt = Date.now();
console.log(`${at()} server restarted (${MODE === "start" ? "eve start" : "eve dev --resume"})`);
const session = client.sessions.attach(sessionId);
await sleep(5000);
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    const r = await session.send("plan:effect-c");
    console.log(`${at()} message sent during the wait: accepted`);
    (async () => { try { for await (const _ of r); } catch {} })();
    break;
  } catch (e) {
    console.log(`${at()} message sent during the wait: ${e.message}${attempt < 3 ? ", retrying" : ""}`);
    await sleep(2000);
  }
}

// The session is idle until either the interrupted tool runs again or the message above is taken up
// (a follow-up steers the resumed turn, so it can replace the rest of the plan). Time the first one.
const before = side().length;
const resumed = await until(() => side().length > before, WAIT_S);
if (resumed) {
  const first = side()[before].split(" ").slice(1).join(" ");
  console.log(`${at()} session resumed (${first}): ${((Date.now() - restartedAt) / 1000).toFixed(1)}s after the restart, ${((Date.now() - stepStartedAt) / 1000).toFixed(1)}s after the interrupted tool started`);
  await until(() => count(/effect (b|c)/) >= 1 && !side().at(-1).includes("slow-start"), 60);
  await sleep(1000);
} else {
  console.log(`${at()} session did nothing for ${WAIT_S}s after the restart`);
}
console.log(`side effects, in order:\n${side().map((l) => `  ${l.split(" ").slice(1).join(" ")}`).join("\n")}`);
await server.kill("SIGTERM");
process.exit(0);

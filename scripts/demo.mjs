import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const children = [];

function waitForPort(port, timeout = 90_000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ port, host: "127.0.0.1" }, () => {
        socket.end();
        resolve();
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() - start > timeout) reject(new Error(`timed out waiting for port ${port}`));
        else setTimeout(attempt, 400);
      });
    };
    attempt();
  });
}

function find(parts) {
  const candidates = [
    path.join(root, "node_modules", ...parts),
    path.join(root, "contracts", "node_modules", ...parts),
    path.join(root, "web", "node_modules", ...parts),
    path.join(root, "relayer", "node_modules", ...parts),
  ];
  for (const candidate of candidates) {
    const probe = spawnSync(process.execPath, ["-e", "process.exit(require('fs').existsSync(process.argv[1]) ? 0 : 1)", candidate]);
    if (probe.status === 0) return candidate;
  }
  throw new Error(`Cannot find ${parts.join("/")}. Run npm install from the repo root.`);
}

function start(args, opts = {}) {
  const child = spawn(process.execPath, args, {
    cwd: opts.cwd ?? root,
    env: { ...process.env, ...opts.env },
    stdio: "inherit",
  });
  children.push(child);
  child.on("exit", (code) => {
    if (code && code !== 0 && !opts.allowExit) {
      console.error(`process exited ${code}: ${args.join(" ")}`);
    }
  });
  return child;
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.pid) continue;
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
  }
  process.exit(code);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const payouts = path.join(root, "rail", "data", "payouts.json");
mkdirSync(path.dirname(payouts), { recursive: true });
writeFileSync(payouts, "{}\n");

const hardhat = find(["hardhat", "internal", "cli", "cli.js"]);
const tsx = find(["tsx", "dist", "cli.mjs"]);
const nextBin = find(["next", "dist", "bin", "next"]);

console.log("Starting local Hardhat node on 8545");
start([hardhat, "node", "--hostname", "127.0.0.1", "--port", "8545"], { cwd: path.join(root, "contracts") });
await waitForPort(8545);

console.log("Deploying PurposeVault");
const deploy = spawnSync(process.execPath, [hardhat, "run", "scripts/deploy.ts", "--network", "localhost"], {
  cwd: path.join(root, "contracts"),
  env: { ...process.env, RPC_URL: "http://127.0.0.1:8545" },
  stdio: "inherit",
});
if (deploy.status !== 0) shutdown(deploy.status ?? 1);

console.log("Starting relayer on 8787");
start([tsx, path.join(root, "relayer", "src", "index.ts")], {
  env: {
    RPC_URL: "http://127.0.0.1:8545",
    AUDIT_HMAC_KEY: process.env.AUDIT_HMAC_KEY ?? "purposepay-demo-audit-key",
    PORT: "8787",
  },
});
await waitForPort(8787);

console.log("Starting web on http://127.0.0.1:3000/send");
start([nextBin, "dev", "-p", "3000"], {
  cwd: path.join(root, "web"),
  env: { NEXT_PUBLIC_RELAYER_URL: "http://127.0.0.1:8787" },
});
await waitForPort(3000);
console.log("PurposePay demo is up at http://127.0.0.1:3000/send");

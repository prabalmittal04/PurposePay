import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Contract, JsonRpcProvider } from "ethers";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const port = 18545;
const rpc = `http://127.0.0.1:${port}`;

function resolveBin(parts) {
  const candidates = [
    path.join(root, "node_modules", ...parts),
    path.join(root, "contracts", "node_modules", ...parts),
    path.join(root, "relayer", "node_modules", ...parts),
  ];
  for (const candidate of candidates) {
    const probe = spawnSync(process.execPath, ["-e", "process.exit(require('fs').existsSync(process.argv[1])?0:1)", candidate]);
    if (probe.status === 0) return candidate;
  }
  throw new Error(`missing ${parts.join("/")}`);
}

function waitForPort(target, timeout = 60_000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ port: target, host: "127.0.0.1" }, () => {
        socket.end();
        resolve();
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() - start > timeout) reject(new Error(`timed out waiting for ${target}`));
        else setTimeout(attempt, 300);
      });
    };
    attempt();
  });
}

function killTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

function run(command, args, env, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("exit", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`exit ${code}\n${output}`));
    });
  });
}

test("relayer crash after the rail write confirms exactly once on resume", { timeout: 180_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pp-resume-"));
  const payouts = path.join(dir, "payouts.json");
  const deployments = path.join(dir, "deployments");
  const hardhat = resolveBin(["hardhat", "internal", "cli", "cli.js"]);
  const tsx = resolveBin(["tsx", "dist", "cli.mjs"]);
  const node = spawn(process.execPath, [hardhat, "node", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: path.join(root, "contracts"),
    stdio: "ignore",
  });
  try {
    await waitForPort(port);
    await run(process.execPath, [hardhat, "run", "scripts/deploy.ts", "--network", "localhost"], {
      RPC_URL: rpc,
      DEPLOYMENTS_DIR: deployments,
    }, path.join(root, "contracts"));
    const deployment = JSON.parse(await readFile(path.join(deployments, "local.json"), "utf8"));
    const shared = {
      RPC_URL: rpc,
      DEPLOYMENTS_FILE: path.join(deployments, "local.json"),
      PAYOUTS_PATH: payouts,
      AUDIT_HMAC_KEY: "resume-test-key",
    };
    await run(process.execPath, [tsx, path.join(root, "relayer", "src", "index.ts")], {
      ...shared,
      SETTLE_OPEN: "1",
      CRASH_AFTER_RAIL: "1",
    });
    const artifact = JSON.parse(
      await readFile(path.join(root, "contracts", "artifacts", "contracts", "PurposeVault.sol", "PurposeVault.json"), "utf8"),
    );
    const provider = new JsonRpcProvider(rpc);
    const vault = new Contract(deployment.vault, artifact.abi, provider);
    const pending = await vault.remittances(0);
    assert.equal(Number(pending.status), 2);
    const firstFile = JSON.parse(await readFile(payouts, "utf8"));
    const ids = Object.keys(firstFile);
    assert.equal(ids.length, 1);
    assert.equal(firstFile[ids[0]].outcome, "CONFIRMED");
    assert.equal(firstFile[ids[0]].referenceType, "SIMULATED");
    await run(process.execPath, [tsx, path.join(root, "relayer", "src", "index.ts")], {
      ...shared,
      RESUME_AND_EXIT: "1",
    });
    const settled = await vault.remittances(0);
    assert.equal(Number(settled.status), 4);
    const events = await vault.queryFilter(vault.filters.RemittanceSettled());
    assert.equal(events.length, 1);
    const secondFile = JSON.parse(await readFile(payouts, "utf8"));
    assert.equal(Object.keys(secondFile).length, 1);
    assert.equal(secondFile[ids[0]].simulatedReference, firstFile[ids[0]].simulatedReference);
    provider.destroy();
  } finally {
    killTree(node);
    await rm(dir, { recursive: true, force: true });
  }
});

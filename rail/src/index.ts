import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Outcome = "CONFIRMED" | "DEFINITE_REJECT" | "UNKNOWN";

export type PayoutRecord = {
  outcome: Outcome;
  referenceType: "SIMULATED" | "SANDBOX";
  simulatedReference: string | null;
};

export type PayoutRequest = {
  payoutId: string;
  vpa: string;
  amountPaise: string;
};

const here = path.dirname(fileURLToPath(import.meta.url));

export function defaultPayoutsPath() {
  return process.env.PAYOUTS_PATH ?? path.resolve(here, "..", "data", "payouts.json");
}

export function readAll(file = defaultPayoutsPath()): Record<string, PayoutRecord> {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, PayoutRecord>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function getRecord(payoutId: string, file = defaultPayoutsPath()): PayoutRecord | null {
  return readAll(file)[payoutId] ?? null;
}

export function putRecord(payoutId: string, record: PayoutRecord, file = defaultPayoutsPath()): PayoutRecord {
  const all = readAll(file);
  if (all[payoutId]) return all[payoutId];
  all[payoutId] = record;
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(all, null, 2));
  try {
    renameSync(tmp, file);
  } catch {
    rmSync(file, { force: true });
    renameSync(tmp, file);
  }
  return record;
}

export class SandboxUnconfigured extends Error {
  constructor() {
    super("DRUNIX_SANDBOX_URL is not set");
    this.name = "SandboxUnconfigured";
  }
}

function simulatedReference(payoutId: string) {
  const digits = (BigInt(payoutId) % 1_000_000_000_000n).toString().padStart(12, "0");
  return `SIM-${digits}`;
}

export async function mockUpi(request: PayoutRequest): Promise<PayoutRecord> {
  if (process.env.MOCK_UPI_MODE === "unknown") {
    return { outcome: "UNKNOWN", referenceType: "SIMULATED", simulatedReference: null };
  }
  if (process.env.MOCK_UPI_MODE === "reject") {
    return { outcome: "DEFINITE_REJECT", referenceType: "SIMULATED", simulatedReference: null };
  }
  return {
    outcome: "CONFIRMED",
    referenceType: "SIMULATED",
    simulatedReference: simulatedReference(request.payoutId),
  };
}

export async function drunixSandbox(request: PayoutRequest): Promise<PayoutRecord> {
  const url = process.env.DRUNIX_SANDBOX_URL;
  if (!url) throw new SandboxUnconfigured();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { outcome: "UNKNOWN", referenceType: "SANDBOX", simulatedReference: null };
    }
    const body = (await response.json()) as { outcome?: Outcome; reference?: string };
    const outcome = body.outcome ?? "UNKNOWN";
    if (outcome !== "CONFIRMED" && outcome !== "DEFINITE_REJECT" && outcome !== "UNKNOWN") {
      return { outcome: "UNKNOWN", referenceType: "SANDBOX", simulatedReference: null };
    }
    return {
      outcome,
      referenceType: "SANDBOX",
      simulatedReference: outcome === "CONFIRMED" ? (body.reference ?? null) : null,
    };
  } catch {
    return { outcome: "UNKNOWN", referenceType: "SANDBOX", simulatedReference: null };
  } finally {
    clearTimeout(timer);
  }
}

const inflight = new Map<string, Promise<PayoutRecord>>();

async function settleOnce(request: PayoutRequest, file: string): Promise<PayoutRecord> {
  const existing = getRecord(request.payoutId, file);
  if (existing) return existing;
  const fresh = process.env.DRUNIX_SANDBOX_URL ? await drunixSandbox(request) : await mockUpi(request);
  return putRecord(request.payoutId, fresh, file);
}

export async function payout(request: PayoutRequest, file = defaultPayoutsPath()): Promise<PayoutRecord> {
  const key = `${file}\n${request.payoutId}`;
  const pending = inflight.get(key);
  if (pending) return pending;
  const run = settleOnce(request, file);
  inflight.set(key, run);
  try {
    return await run;
  } finally {
    if (inflight.get(key) === run) inflight.delete(key);
  }
}

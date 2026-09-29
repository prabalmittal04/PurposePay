import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Contract, Interface, JsonRpcProvider, Wallet, keccak256, toUtf8Bytes, type TransactionResponse } from "ethers";
import { partyRef, toCsv, type AuditRow } from "../../agents/compliance.ts";
import { DISCLAIMER, reviewNotice, type Notice } from "../../agents/guardian.ts";
import { quoteFromGross } from "../../agents/quote.ts";
import { getRecord, payout } from "../../rail/src/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");

const STATUS = ["NONE", "OPEN", "PAYOUT_PENDING", "PAYOUT_UNKNOWN", "SETTLED", "REFUNDED"] as const;
const PURPOSE = ["TUITION", "MEDICAL", "RENT", "GENERAL"] as const;
const GROSS = 200_000_000n;

type Parties = {
  senderVpa: string;
  beneficiaryVpa: string;
  beneficiaryName: string;
  senderName: string;
  harbourview: { name: string; vpa: string; category: string };
  northgate: { name: string; vpa: string; category: string };
  citycare: { name: string; vpa: string; category: string };
  friendVpa: string;
  purposeTag: string;
  purposeCode: string;
  purposeCodeLabel: string;
  grossUsd6: string;
};

type Deployment = {
  vault: string;
  senderKey: string;
  relayerKey: string;
  rpcUrl: string;
  seededRemittanceId: number;
};

const parties = JSON.parse(readFileSync(path.join(root, "registry", "parties.json"), "utf8")) as Parties;
const notices = JSON.parse(readFileSync(path.join(root, "registry", "notices.json"), "utf8")) as Notice[];
const sendNotice = notices.find((notice) => notice.usedOnSend) ?? notices[0];

const NAMES = [
  "UnregisteredPayee",
  "CategoryMismatch",
  "PayeeNotAuthorized",
  "QuoteExpired",
  "InvalidStatus",
  "BadQuote",
  "NotRelayer",
  "ZeroAmount",
  "PayoutIdMismatch",
] as const;

function loadDeployment(): Deployment {
  const file = process.env.DEPLOYMENTS_FILE ?? path.join(root, "deployments", "local.json");
  return JSON.parse(readFileSync(file, "utf8")) as Deployment;
}

function loadVaultAbi() {
  const file = path.join(root, "contracts", "artifacts", "contracts", "PurposeVault.sol", "PurposeVault.json");
  return JSON.parse(readFileSync(file, "utf8")).abi;
}

function auditKey() {
  return process.env.AUDIT_HMAC_KEY ?? "purposepay-demo-audit-key";
}

function commit(vpa: string) {
  return Wallet.createRandom().provider ? "" : "";
}

export function errorName(iface: Interface, error: unknown) {
  const blobs: string[] = [];
  const stack: unknown[] = [error];
  const seen = new Set<unknown>();
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    const record = current as Record<string, unknown>;
    for (const key of ["data", "message", "shortMessage", "reason"]) {
      if (typeof record[key] === "string") blobs.push(record[key]);
    }
    if (record.error) stack.push(record.error);
    if (record.info) stack.push(record.info);
  }
  for (const blob of blobs) {
    if (blob.startsWith("0x")) {
      try {
        const parsed = iface.parseError(blob);
        if (parsed?.name) return parsed.name;
      } catch {
        /* keep looking */
      }
    }
    for (const name of NAMES) {
      if (blob.includes(name)) return name;
    }
  }
  return "Reverted";
}

type Row = {
  id: number;
  status: string;
  statusCode: number;
  purposeTag: string;
  grossUsd6: string;
  feeUsd6: string;
  netUsd6: string;
  netInrPaise: string;
  quoteId: string;
  payoutId: string;
  beneficiaryCommitment: string;
  authorizedPayeeCommitment: string;
  ratePaisePerUsd: string;
};

function normalize(id: number, raw: Record<string, bigint | string | number>) {
  const statusCode = Number(raw.status);
  const purposeCode = Number(raw.purpose);
  return {
    id,
    status: STATUS[statusCode] ?? "NONE",
    statusCode,
    purposeTag: PURPOSE[purposeCode] ?? "TUITION",
    grossUsd6: raw.grossUsd6.toString(),
    feeUsd6: raw.feeUsd6.toString(),
    netUsd6: raw.netUsd6.toString(),
    netInrPaise: raw.netInrPaise.toString(),
    quoteId: String(raw.quoteId),
    payoutId: String(raw.payoutId),
    beneficiaryCommitment: String(raw.beneficiaryCommitment).toLowerCase(),
    authorizedPayeeCommitment: String(raw.authorizedPayeeCommitment).toLowerCase(),
    ratePaisePerUsd: raw.ratePaisePerUsd.toString(),
  } satisfies Row;
}

type Session = {
  deployment: Deployment;
  provider: JsonRpcProvider;
  sender: Wallet;
  relayer: Wallet;
  iface: Interface;
  asSender: Contract;
  asRelayer: Contract;
  reader: Contract;
};

let session: Session | null = null;

async function connect() {
  if (session) return session;
  const deployment = loadDeployment();
  const abi = loadVaultAbi();
  const provider = new JsonRpcProvider(process.env.RPC_URL ?? deployment.rpcUrl ?? "http://127.0.0.1:8545");
  const sender = new Wallet(deployment.senderKey, provider);
  const relayer = new Wallet(deployment.relayerKey, provider);
  const iface = new Interface(abi);
  session = {
    deployment,
    provider,
    sender,
    relayer,
    iface,
    asSender: new Contract(deployment.vault, abi, sender),
    asRelayer: new Contract(deployment.vault, abi, relayer),
    reader: new Contract(deployment.vault, abi, provider),
  };
  return session;
}

function vpaCommit(vpa: string) {
  return keccak256(toUtf8Bytes(vpa)).toLowerCase();
}

function vpaDirectory() {
  const rows: { vpa: string; name: string }[] = [
    { vpa: parties.senderVpa, name: parties.senderName },
    { vpa: parties.beneficiaryVpa, name: parties.beneficiaryName },
    { vpa: parties.harbourview.vpa, name: parties.harbourview.name },
    { vpa: parties.northgate.vpa, name: parties.northgate.name },
    { vpa: parties.citycare.vpa, name: parties.citycare.name },
    { vpa: parties.friendVpa, name: "Unregistered demo VPA" },
  ];
  return new Map(rows.map((row) => [vpaCommit(row.vpa), row]));
}

async function readRow(reader: Contract, id: number) {
  const raw = await reader.remittances(id);
  return normalize(id, raw);
}

async function allRows(reader: Contract) {
  const count = Number(await reader.remittanceCount());
  const rows: Row[] = [];
  for (let id = 0; id < count; id += 1) rows.push(await readRow(reader, id));
  return rows;
}

async function settledTx(reader: Contract, id: number) {
  const events = await reader.queryFilter(reader.filters.RemittanceSettled(id));
  return events.at(-1)?.transactionHash ?? "";
}

function hmacFor(commitment: string) {
  const found = vpaDirectory().get(commitment.toLowerCase());
  if (!found) return "";
  return partyRef(found.vpa, auditKey());
}

async function auditRows(): Promise<AuditRow[]> {
  const { reader } = await connect();
  const rows = await allRows(reader);
  const out: AuditRow[] = [];
  for (const row of rows) {
    const record = row.payoutId === "0x0000000000000000000000000000000000000000000000000000000000000000"
      ? null
      : getRecord(row.payoutId);
    out.push({
      remittanceId: String(row.id),
      purposeTag: row.purposeTag,
      purposeCode: parties.purposeCode,
      quoteId: row.quoteId,
      grossUsd6: row.grossUsd6,
      feeUsd6: row.feeUsd6,
      netUsd6: row.netUsd6,
      netInrPaise: row.netInrPaise,
      payoutId: row.payoutId,
      partyRef: hmacFor(row.authorizedPayeeCommitment),
      beneficiaryRef: hmacFor(row.beneficiaryCommitment),
      referenceType: record?.referenceType ?? "",
      simulatedReference: record?.simulatedReference ?? "",
      txHash: row.status === "SETTLED" ? await settledTx(reader, row.id) : "",
    });
  }
  return out;
}

const nextNonce = new Map<string, number>();

async function transact(wallet: Wallet, send: (nonce: number) => Promise<TransactionResponse>) {
  const key = wallet.address.toLowerCase();
  let nonce = nextNonce.get(key);
  if (nonce === undefined) {
    nonce = await wallet.provider!.getTransactionCount(wallet.address, "pending");
  }
  try {
    const tx = await send(nonce);
    nextNonce.set(key, nonce + 1);
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      nextNonce.delete(key);
      throw new Error("transaction was mined and reverted");
    }
    return { tx, receipt };
  } catch (error) {
    nextNonce.delete(key);
    throw error;
  }
}

let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function resumeOne(id: number) {
  const { asRelayer, reader } = await connect();
  const row = await readRow(reader, id);
  if (row.status !== "PAYOUT_PENDING" && row.status !== "PAYOUT_UNKNOWN") return row;
  const stored = getRecord(row.payoutId);
  if (stored?.outcome === "DEFINITE_REJECT") {
    console.log(`payout ${row.payoutId} DEFINITE_REJECT is logged; state left unchanged; refund is roadmap`);
    return row;
  }
  if (stored?.outcome === "CONFIRMED") {
    if (row.status !== "SETTLED") {
      const { relayer } = await connect();
      await transact(relayer, (nonce) => asRelayer.confirmPayout(id, row.payoutId, { nonce }));
    }
    return readRow(reader, id);
  }
  if (!stored) {
    return payReserved(id);
  }
  if (stored.outcome === "UNKNOWN" && row.status === "PAYOUT_PENDING") {
    const { relayer } = await connect();
    await transact(relayer, (nonce) => asRelayer.markUnknown(id, row.payoutId, { nonce }));
  }
  return readRow(reader, id);
}

async function payReserved(id: number) {
  const { asRelayer, reader } = await connect();
  const row = await readRow(reader, id);
  const payee = vpaDirectory().get(row.authorizedPayeeCommitment.toLowerCase());
  if (!payee) throw new Error("authorized payee is not in the local directory");
  const result = await payout({
    payoutId: row.payoutId,
    vpa: payee.vpa,
    amountPaise: row.netInrPaise,
  });
  if (process.env.CRASH_AFTER_RAIL === "1") {
    console.log("CRASH_AFTER_RAIL: persisted rail result, exiting before confirmPayout");
    process.exit(0);
  }
  if (result.outcome === "CONFIRMED") {
    const { relayer } = await connect();
    await transact(relayer, (nonce) => asRelayer.confirmPayout(id, row.payoutId, { nonce }));
  } else if (result.outcome === "UNKNOWN") {
    const { relayer } = await connect();
    await transact(relayer, (nonce) => asRelayer.markUnknown(id, row.payoutId, { nonce }));
  } else {
    console.log(`payout ${row.payoutId} DEFINITE_REJECT is logged; state left unchanged; refund is roadmap`);
  }
  return readRow(reader, id);
}

async function resumeAll() {
  const { reader } = await connect();
  const rows = await allRows(reader);
  for (const row of rows) {
    if (row.status === "PAYOUT_PENDING" || row.status === "PAYOUT_UNKNOWN") {
      await resumeOne(row.id);
    }
  }
}

async function createTuition(payeeVpa: string) {
  const { asSender, sender, iface } = await connect();
  let txHash = "";
  try {
    const { tx, receipt } = await transact(sender, (nonce) =>
      asSender.createRemittance(vpaCommit(parties.beneficiaryVpa), vpaCommit(payeeVpa), 0, GROSS, {
        gasLimit: 500_000,
        nonce,
      }),
    );
    txHash = receipt.hash;
    return { ok: true as const, txHash, id: Number(await asSender.remittanceCount()) - 1 };
  } catch (error) {
    const details = error as { receipt?: { hash?: string }; transaction?: { hash?: string } };
    return {
      ok: false as const,
      txHash: details.receipt?.hash ?? details.transaction?.hash ?? txHash,
      error: errorName(iface, error),
      kind: "transaction" as const,
    };
  }
}

async function settleNew() {
  const created = await createTuition(parties.harbourview.vpa);
  if (!created.ok) return created;
  const guardian = await reviewNotice(sendNotice, parties.purposeTag);
  if (guardian.decision === "hold") {
    return { ok: false as const, error: "GuardianHold", guardian, id: created.id, txHash: created.txHash, kind: "transaction" as const };
  }
  const { asRelayer, relayer, reader } = await connect();
  const { receipt: reserveReceipt } = await transact(relayer, (nonce) => asRelayer.reservePayout(created.id, { nonce }));
  const after = await payReserved(created.id);
  const record = getRecord(after.payoutId);
  return {
    ok: true as const,
    id: created.id,
    status: after.status,
    grossUsd6: after.grossUsd6,
    feeUsd6: after.feeUsd6,
    netUsd6: after.netUsd6,
    netInrPaise: after.netInrPaise,
    quoteId: after.quoteId,
    payoutId: after.payoutId,
    simulatedReference: record?.simulatedReference ?? null,
    referenceType: record?.referenceType ?? null,
    txs: { create: created.txHash, reserve: reserveReceipt.hash, confirm: await settledTx(reader, created.id) },
    guardian,
    payeeName: parties.harbourview.name,
    payeeVpa: parties.harbourview.vpa,
    beneficiaryName: parties.beneficiaryName,
    beneficiaryVpa: parties.beneficiaryVpa,
  };
}

async function previewNorthgate() {
  const { reader, iface } = await connect();
  const rows = await allRows(reader);
  const subject = rows.find((row) => row.authorizedPayeeCommitment === vpaCommit(parties.harbourview.vpa));
  if (!subject) {
    return { ok: false, error: "NoHarbourviewRemittance", kind: "view", label: "policy preview (view call)" };
  }
  try {
    await reader.previewPayout.staticCall(subject.id, vpaCommit(parties.northgate.vpa));
    return { ok: true, kind: "view", label: "policy preview (view call)", id: subject.id };
  } catch (error) {
    return {
      ok: false,
      error: errorName(iface, error),
      kind: "view",
      label: "policy preview (view call)",
      id: subject.id,
    };
  }
}

async function demoPayload() {
  const { reader } = await connect();
  const quote = await reader.quote();
  const math = quoteFromGross(GROSS, BigInt(quote.ratePaisePerUsd));
  const rows = await allRows(reader);
  return {
    rail: process.env.DRUNIX_SANDBOX_URL ? "DrunixSandbox" : "MockUPI",
    chain: "local Hardhat",
    disclaimer: DISCLAIMER,
    purposeTag: parties.purposeTag,
    purposeCode: parties.purposeCode,
    purposeCodeLabel: parties.purposeCodeLabel,
    formula: {
      grossUsd6: math.grossUsd6.toString(),
      feeUsd6: math.feeUsd6.toString(),
      netUsd6: math.netUsd6.toString(),
      netInrPaise: math.netInrPaise.toString(),
      ratePaisePerUsd: math.ratePaisePerUsd.toString(),
      feeBps: math.feeBps.toString(),
    },
    parties: {
      senderName: parties.senderName,
      senderVpa: parties.senderVpa,
      beneficiaryName: parties.beneficiaryName,
      beneficiaryVpa: parties.beneficiaryVpa,
      schoolName: parties.harbourview.name,
      schoolVpa: parties.harbourview.vpa,
      otherSchoolName: parties.northgate.name,
      otherSchoolVpa: parties.northgate.vpa,
      hospitalName: parties.citycare.name,
      hospitalVpa: parties.citycare.vpa,
      friendVpa: parties.friendVpa,
    },
    treasury: await reader.treasury(),
    remittances: rows,
    limitations: [
      "A relayer that stays down leaves funds in PAYOUT_PENDING or PAYOUT_UNKNOWN. Automatic refund on timeout is not built, because a late credit would double-pay.",
      "SETTLED means the relayer attested that the adapter returned CONFIRMED for this payout id.",
      "A definite rail reject is logged and left on chain. Refund after reject is roadmap.",
    ],
  };
}

function writeJson(res: ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  res.end(data);
}

async function route(req: IncomingMessage, res: ServerResponse) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    res.end();
    return;
  }
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      writeJson(res, 200, { ok: true });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/demo") {
      writeJson(res, 200, await demoPayload());
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/send") {
      writeJson(res, 200, await enqueue(() => settleNew()));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/trick/unregistered") {
      writeJson(res, 200, await enqueue(() => createTuition(parties.friendVpa)));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/trick/hospital") {
      writeJson(res, 200, await enqueue(() => createTuition(parties.citycare.vpa)));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/trick/preview") {
      writeJson(res, 200, await previewNorthgate());
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/audit") {
      const rows = await auditRows();
      writeJson(res, 200, {
        rows,
        purposeCodeLabel: parties.purposeCodeLabel,
        note: "Demo extract, not a regulatory filing. Party columns are HMAC-SHA256 refs. referenceType SIMULATED is not an NPCI or bank RRN.",
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/audit.csv") {
      const csv = toCsv(await auditRows());
      res.writeHead(200, {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": "attachment; filename=purposepay-audit.csv",
        "access-control-allow-origin": "*",
      });
      res.end(csv);
      return;
    }
    writeJson(res, 404, { error: "not found" });
  } catch (error) {
    writeJson(res, 500, { error: error instanceof Error ? error.message : "relayer error" });
  }
}

async function settleFirstOpen() {
  const { reader } = await connect();
  const rows = await allRows(reader);
  const open = rows.find((row) => row.status === "OPEN" && row.authorizedPayeeCommitment === vpaCommit(parties.harbourview.vpa));
  if (!open) return;
  const guardian = await reviewNotice(sendNotice, parties.purposeTag);
  if (guardian.decision !== "approve") {
    throw new Error(`guardian held the send notice: ${guardian.reasons.join(",")}`);
  }
  const { asRelayer, relayer } = await connect();
  await transact(relayer, (nonce) => asRelayer.reservePayout(open.id, { nonce }));
  await payReserved(open.id);
}

async function main() {
  await resumeAll();
  if (process.env.SETTLE_OPEN === "1") await settleFirstOpen();
  if (process.env.RESUME_AND_EXIT === "1" || process.env.CRASH_AFTER_RAIL === "1") {
    session?.provider.destroy();
    return;
  }
  const port = Number(process.env.PORT ?? 8787);
  const server = createServer((req, res) => {
    void route(req, res);
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`relayer http://127.0.0.1:${port}`);
  });
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

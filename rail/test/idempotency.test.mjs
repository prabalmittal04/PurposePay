import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { payout } from "../src/index.ts";

test("a second payout with the same id returns the stored simulated reference", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pp-rail-"));
  const file = path.join(dir, "payouts.json");
  const request = {
    payoutId: "0x00000000000000000000000000000000000000000000000000000000000000ab",
    vpa: "fees@harbourview.demo",
    amountPaise: "1661650",
  };
  let calls = 0;
  const first = await payout(request, file);
  calls += 1;
  const second = await payout(request, file);
  calls += 1;
  assert.equal(first.outcome, "CONFIRMED");
  assert.equal(first.referenceType, "SIMULATED");
  assert.equal(second.simulatedReference, first.simulatedReference);
  assert.match(first.simulatedReference ?? "", /^SIM-\d{12}$/);
  const stored = JSON.parse(await readFile(file, "utf8"));
  assert.equal(Object.keys(stored).length, 1);
  assert.equal(calls, 2);
});

test("two concurrent payouts for the same id create one credit", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pp-rail-"));
  const file = path.join(dir, "payouts.json");
  const request = {
    payoutId: "0x00000000000000000000000000000000000000000000000000000000000000cd",
    vpa: "fees@harbourview.demo",
    amountPaise: "1661650",
  };
  const [first, second] = await Promise.all([payout(request, file), payout(request, file)]);
  assert.equal(first.simulatedReference, second.simulatedReference);
  assert.equal(first.outcome, "CONFIRMED");
  const stored = JSON.parse(await readFile(file, "utf8"));
  assert.equal(Object.keys(stored).length, 1);
});

test("a retry after a stored confirm does not create a second rail outcome", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pp-rail-"));
  const file = path.join(dir, "payouts.json");
  const request = {
    payoutId: "0x00000000000000000000000000000000000000000000000000000000000000ef",
    vpa: "fees@harbourview.demo",
    amountPaise: "1661650",
  };
  const first = await payout(request, file);
  process.env.MOCK_UPI_MODE = "reject";
  try {
    const second = await payout(request, file);
    assert.equal(second.outcome, "CONFIRMED");
    assert.equal(second.simulatedReference, first.simulatedReference);
    const stored = JSON.parse(await readFile(file, "utf8"));
    assert.equal(Object.keys(stored).length, 1);
  } finally {
    delete process.env.MOCK_UPI_MODE;
  }
});

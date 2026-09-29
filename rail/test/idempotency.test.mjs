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

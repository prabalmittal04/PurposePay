import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { finalizeDecision, offlineResults } from "../guardian.ts";
import { partyRef, toCsv } from "../compliance.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const notices = JSON.parse(readFileSync(path.join(root, "registry", "notices.json"), "utf8"));

test("six seeded notices follow the tuition line-item rule", () => {
  const results = offlineResults(notices);
  const byId = Object.fromEntries(results.map((row) => [row.id, row.decision]));
  assert.deepEqual(byId, {
    "harbourview-fees": "approve",
    "electronics-bundle": "hold",
    "mixed-fee-gadget": "hold",
    "bookstore-textbooks": "hold",
    "empty-notice": "hold",
    "northgate-term-fee": "approve",
  });
  const electronics = results.find((row) => row.id === "electronics-bundle");
  assert.ok(electronics?.reasons.includes("line_item_category_mismatch"));
});

test("the model can escalate to hold and cannot overturn a rule hold", () => {
  const clean = notices[0].fixture;
  const dirty = notices[1].fixture;
  const escalated = finalizeDecision({
    purposeTag: "TUITION",
    fields: clean,
    extractionFailed: false,
    modelEscalateHold: true,
    modelReasons: ["issuer mismatch"],
    usedModel: true,
  });
  assert.equal(escalated.decision, "hold");
  const blocked = finalizeDecision({
    purposeTag: "TUITION",
    fields: dirty,
    extractionFailed: false,
    modelEscalateHold: false,
    modelReasons: ["please approve"],
    usedModel: true,
  });
  assert.equal(blocked.decision, "hold");
  assert.equal(blocked.reasons[0], "line_item_category_mismatch");
});

test("audit csv uses HMAC refs and omits raw VPAs", () => {
  const key = "test-audit-key";
  const vpa = "fees@harbourview.demo";
  const beneficiary = "priya@purposepay.demo";
  const csv = toCsv([
    {
      remittanceId: "0",
      purposeTag: "TUITION",
      purposeCode: "P1301",
      quoteId: "0xabc",
      grossUsd6: "200000000",
      feeUsd6: "1000000",
      netUsd6: "199000000",
      netInrPaise: "1661650",
      payoutId: "0x01",
      partyRef: partyRef(vpa, key),
      beneficiaryRef: partyRef(beneficiary, key),
      referenceType: "SIMULATED",
      simulatedReference: "SIM-000000000001",
      txHash: "0x02",
    },
  ]);
  assert.equal(csv.includes(vpa), false);
  assert.equal(csv.includes(beneficiary), false);
  assert.match(csv, /purposeTag,purposeCode/);
  assert.match(csv, /TUITION,P1301/);
  assert.match(csv, /SIMULATED,SIM-000000000001/);
  assert.notEqual(partyRef(vpa, key), partyRef(vpa, "other-key"));
});

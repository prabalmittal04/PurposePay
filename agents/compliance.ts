import { createHmac } from "node:crypto";

export const CSV_HEADERS = [
  "remittanceId",
  "purposeTag",
  "purposeCode",
  "quoteId",
  "grossUsd6",
  "feeUsd6",
  "netUsd6",
  "netInrPaise",
  "payoutId",
  "partyRef",
  "beneficiaryRef",
  "referenceType",
  "simulatedReference",
  "txHash",
] as const;

export type AuditRow = Record<(typeof CSV_HEADERS)[number], string>;

export function partyRef(vpa: string, key: string) {
  return createHmac("sha256", key).update(`vpa:${vpa}`).digest("hex");
}

export function toCsv(rows: AuditRow[]) {
  const lines = [CSV_HEADERS.join(",")];
  for (const row of rows) {
    lines.push(CSV_HEADERS.map((header) => row[header] ?? "").join(","));
  }
  return `${lines.join("\n")}\n`;
}

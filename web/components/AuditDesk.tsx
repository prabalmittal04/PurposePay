"use client";

import { useEffect, useState } from "react";
import { formatInr, formatUsd, relayerUrl } from "../lib/format";

type Row = {
  remittanceId: string;
  purposeTag: string;
  purposeCode: string;
  quoteId: string;
  grossUsd6: string;
  feeUsd6: string;
  netUsd6: string;
  netInrPaise: string;
  payoutId: string;
  partyRef: string;
  beneficiaryRef: string;
  referenceType: string;
  simulatedReference: string;
  txHash: string;
};

export function AuditDesk() {
  const [rows, setRows] = useState<Row[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${relayerUrl}/api/audit`)
      .then((response) => response.json())
      .then((body) => {
        setRows(body.rows ?? []);
        setNote(body.note ?? "");
      })
      .catch(() => setError("Relayer is not up. Start it with npm run demo."));
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <p className="max-w-2xl text-sm leading-6 text-ink/70">{note}</p>
        <div className="flex gap-2">
          <a className="rounded-full bg-ink px-4 py-2 text-sm text-paper" href={`${relayerUrl}/api/audit.csv`}>
            Download CSV
          </a>
          <button type="button" className="rounded-full border border-ink px-4 py-2 text-sm" onClick={() => window.print()}>
            Print
          </button>
        </div>
      </div>
      {error && <p className="text-sm text-clay">{error}</p>}
      <p className="text-xs uppercase tracking-[0.16em] text-ink/50">purposeCode is a demo mapping. purposeTag is the product tag.</p>
      <div className="overflow-x-auto rounded-3xl border border-line bg-card">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-line text-xs uppercase tracking-wider text-ink/50">
            <tr>
              <th className="px-4 py-3">Id</th>
              <th className="px-4 py-3">Tag</th>
              <th className="px-4 py-3">Demo code</th>
              <th className="px-4 py-3">Net INR</th>
              <th className="px-4 py-3">Reference</th>
              <th className="px-4 py-3">Party ref</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.remittanceId} className="border-b border-line/70 align-top">
                <td className="px-4 py-3">{row.remittanceId}</td>
                <td className="px-4 py-3">{row.purposeTag}</td>
                <td className="px-4 py-3">{row.purposeCode}</td>
                <td className="px-4 py-3">
                  {formatInr(row.netInrPaise)}
                  <span className="block text-xs text-ink/50">{formatUsd(row.netUsd6)} net of {formatUsd(row.feeUsd6)}</span>
                </td>
                <td className="px-4 py-3">
                  {row.simulatedReference || "—"}
                  <span className="block text-xs text-ink/50">{row.referenceType || "not paid"}</span>
                </td>
                <td className="px-4 py-3 font-mono text-[11px] leading-5">
                  {row.partyRef ? `${row.partyRef.slice(0, 18)}…` : "—"}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-ink/60" colSpan={6}>No remittances yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

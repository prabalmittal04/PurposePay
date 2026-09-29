"use client";

import { useEffect, useState } from "react";
import { formatInr, formatRate, formatUsd, relayerUrl } from "../lib/format";

type Formula = {
  grossUsd6: string;
  feeUsd6: string;
  netUsd6: string;
  netInrPaise: string;
  ratePaisePerUsd: string;
  feeBps: string;
};

type Parties = {
  senderName: string;
  senderVpa: string;
  beneficiaryName: string;
  beneficiaryVpa: string;
  schoolName: string;
  schoolVpa: string;
};

type Guardian = { decision: string; reasons: string[]; disclaimer: string };

type SendResult = {
  ok: boolean;
  error?: string;
  id?: number;
  status?: string;
  grossUsd6?: string;
  feeUsd6?: string;
  netUsd6?: string;
  netInrPaise?: string;
  quoteId?: string;
  payoutId?: string;
  simulatedReference?: string | null;
  referenceType?: string | null;
  txs?: { create: string; reserve: string; confirm: string };
  guardian?: Guardian;
  payeeName?: string;
  payeeVpa?: string;
  beneficiaryName?: string;
  beneficiaryVpa?: string;
};

export function SendDesk() {
  const [formula, setFormula] = useState<Formula | null>(null);
  const [parties, setParties] = useState<Parties | null>(null);
  const [rail, setRail] = useState("MockUPI");
  const [treasury, setTreasury] = useState("");
  const [result, setResult] = useState<SendResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${relayerUrl}/api/demo`)
      .then((response) => response.json())
      .then((body) => {
        setFormula(body.formula);
        setParties(body.parties);
        setRail(body.rail);
        setTreasury(body.treasury ?? "");
      })
      .catch(() => setError("Relayer is not up. Start it with npm run demo."));
  }, []);

  async function send() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${relayerUrl}/api/send`, { method: "POST" });
      const body = (await response.json()) as SendResult;
      setResult(body);
      if (!body.ok) setError(body.error ?? "Send did not settle");
    } catch {
      setError("Send failed before the relayer answered.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <p className="max-w-2xl text-lg leading-8">
        {parties ? parties.senderName : "The sender"} locks $200 for {parties ? parties.beneficiaryName : "the beneficiary"}.
        The contract reads the owner-set rate. Payout can go only to {parties ? parties.schoolName : "the approved school"}.
        The rail in this run is {rail}. A simulated reference is not an NPCI settlement id.
      </p>
      {formula && (
        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-3xl border border-line bg-card p-6">
            <p className="text-xs uppercase tracking-[0.18em] text-ink/50">Contract formula</p>
            <p className="mt-3 font-display text-4xl">{formatInr(formula.netInrPaise)}</p>
            <dl className="mt-4 space-y-1 text-sm">
              <div className="flex justify-between"><dt>Gross</dt><dd>{formatUsd(formula.grossUsd6)}</dd></div>
              <div className="flex justify-between"><dt>Fee, 0.50%, taken before conversion</dt><dd>{formatUsd(formula.feeUsd6)}</dd></div>
              <div className="flex justify-between"><dt>Net converted</dt><dd>{formatUsd(formula.netUsd6)}</dd></div>
              <div className="flex justify-between"><dt>Owner rate</dt><dd>{formatRate(formula.ratePaisePerUsd)} / USD</dd></div>
            </dl>
            <p className="mt-4 text-xs leading-5 text-ink/60">
              199,000,000 × 8,350 / 1,000,000 = 1,661,650 paise. Floor division. The sender cannot pass a rate.
            </p>
          </section>
          <section className="rounded-3xl border border-line bg-card p-6">
            <p className="text-xs uppercase tracking-[0.18em] text-ink/50">Illustrative comparison, not a live SWIFT quote</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-paper p-4">
                <p className="text-xs uppercase tracking-wider text-ink/50">SWIFT, illustrated</p>
                <p className="mt-2 font-display text-2xl">about 6%</p>
                <p className="text-sm text-ink/70">about 2 days</p>
              </div>
              <div className="rounded-2xl bg-moss/10 p-4">
                <p className="text-xs uppercase tracking-wider text-moss">This local script</p>
                <p className="mt-2 font-display text-2xl">0.50%</p>
                <p className="text-sm text-ink/70">adapter confirm, then SETTLED</p>
              </div>
            </div>
          </section>
        </div>
      )}
      <button
        type="button"
        onClick={send}
        disabled={busy || !formula}
        className="rounded-full bg-ink px-6 py-3 text-sm text-paper disabled:opacity-50"
      >
        {busy ? "Reserving, then confirming…" : "Lock $200 for Harbourview"}
      </button>
      {error && <p className="text-sm text-clay">{error}</p>}
      {result?.ok && result.guardian && (
        <section className="grid gap-4 rounded-3xl border border-line bg-card p-6 md:grid-cols-[1.2fr_0.8fr]">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-moss">Status {result.status}</p>
            <ol className="mt-4 space-y-2 text-sm">
              <li>OPEN — create {short(result.txs?.create)}</li>
              <li>PAYOUT_PENDING — reserve {short(result.txs?.reserve)}</li>
              <li>SETTLED — confirm {short(result.txs?.confirm)} only after the adapter returned CONFIRMED</li>
              <li>Treasury receives the gross $200. The 0.50% fee stays a stored calculation. {short(treasury)}</li>
            </ol>
            <p className="mt-4 text-sm">
              Simulated reference <span className="font-mono">{result.simulatedReference}</span>
              <span className="text-ink/60"> · {result.referenceType}</span>
            </p>
            <p className="mt-2 text-xs text-ink/60">{result.guardian.disclaimer}</p>
            <p className="mt-1 text-xs text-ink/60">
              Guardian {result.guardian.decision}: {result.guardian.reasons.join(", ")}. The rule is the floor.
            </p>
          </div>
          <div className="rounded-3xl bg-ink p-5 text-paper">
            <p className="text-[11px] uppercase tracking-[0.2em] text-saffron">Beneficiary view</p>
            <p className="mt-3 font-display text-3xl">{result.netInrPaise ? formatInr(result.netInrPaise) : ""}</p>
            <p className="mt-2 text-sm text-paper/80">For {result.beneficiaryName}</p>
            <p className="font-mono text-xs text-paper/70">{result.beneficiaryVpa}</p>
            <p className="mt-4 text-sm">Paid to {result.payeeName}</p>
            <p className="font-mono text-xs text-paper/70">{result.payeeVpa}</p>
            <p className="mt-4 text-xs leading-5 text-paper/70">No wallet on this screen. The credit is a simulated rail result for this demo.</p>
          </div>
        </section>
      )}
    </div>
  );
}

function short(hash?: string) {
  if (!hash) return "—";
  return `${hash.slice(0, 10)}…${hash.slice(-4)}`;
}

"use client";

import { useState } from "react";
import { Hint } from "./Hint";
import { relayerUrl } from "../lib/format";

type Attempt = {
  ok?: boolean;
  error?: string;
  txHash?: string;
  kind?: string;
  label?: string;
  id?: number;
  status?: string;
  explanation?: string;
};

export function TrickDesk() {
  const [unregistered, setUnregistered] = useState<Attempt | null>(null);
  const [hospital, setHospital] = useState<Attempt | null>(null);
  const [preview, setPreview] = useState<Attempt | null>(null);
  const [rejected, setRejected] = useState<Attempt | null>(null);
  const [refunded, setRefunded] = useState<Attempt | null>(null);
  const [busy, setBusy] = useState("");

  async function post(path: string, setter: (value: Attempt) => void, key: string) {
    setBusy(key);
    try {
      const response = await fetch(`${relayerUrl}${path}`, { method: "POST" });
      setter(await response.json());
    } catch {
      setter({ ok: false, error: "Relayer did not answer" });
    } finally {
      setBusy("");
    }
  }

  async function viewPreview() {
    setBusy("preview");
    try {
      const response = await fetch(`${relayerUrl}/api/trick/preview`);
      setPreview(await response.json());
    } catch {
      setPreview({ ok: false, error: "Relayer did not answer" });
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-4">
      <ol className="grid gap-2 text-sm sm:grid-cols-2">
        <li className="rounded-2xl border border-line bg-card px-4 py-3">1. Submit the unregistered VPA. The transaction reverts.</li>
        <li className="rounded-2xl border border-line bg-card px-4 py-3">2. Submit Citycare on tuition. The transaction reverts.</li>
        <li className="rounded-2xl border border-line bg-card px-4 py-3">3. Run the Northgate view. No money moves.</li>
        <li className="rounded-2xl border border-line bg-card px-4 py-3">4. Mark a definite reject, then refund the locked $200.</li>
      </ol>
      <p className="max-w-2xl leading-7">
        The first two rows submit <span className="font-medium">createRemittance</span> transactions. They revert before tokens move.
        The third row is a view call. No payout function accepts a payee, so a different school cannot be substituted after create.
      </p>
      <article className="rounded-3xl border border-line bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-ink/50">Transaction</p>
            <h2 className="font-display text-2xl">friend@purposepay.demo</h2>
            <p className="text-sm text-ink/70">Unregistered. Expected UnregisteredPayee.</p>
          </div>
          <Hint tip="Sends createRemittance for friend@purposepay.demo. Expect UnregisteredPayee. Arun keeps the tokens.">
            <button type="button" className="rounded-full border border-ink px-4 py-2 text-sm" onClick={() => post("/api/trick/unregistered", setUnregistered, "friend")} disabled={busy !== ""}>
              {busy === "friend" ? "Submitting…" : "Submit transaction"}
            </button>
          </Hint>
        </div>
        {unregistered && <Result attempt={unregistered} />}
      </article>
      <article className="rounded-3xl border border-line bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-ink/50">Transaction</p>
            <h2 className="font-display text-2xl">Citycare Clinic</h2>
            <p className="text-sm text-ink/70">Registered hospital on a tuition remittance. Expected CategoryMismatch.</p>
          </div>
          <Hint tip="Sends createRemittance for Citycare Clinic on tuition. Expect CategoryMismatch. A hospital is not a school.">
            <button type="button" className="rounded-full border border-ink px-4 py-2 text-sm" onClick={() => post("/api/trick/hospital", setHospital, "hospital")} disabled={busy !== ""}>
              {busy === "hospital" ? "Submitting…" : "Submit transaction"}
            </button>
          </Hint>
        </div>
        {hospital && <Result attempt={hospital} />}
      </article>
      <article className="rounded-3xl border border-dashed border-saffron bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-saffron">policy preview (view call)</p>
            <h2 className="font-display text-2xl">Northgate Academy</h2>
            <p className="text-sm text-ink/70">A registered school Arun did not approve on this remittance. This call does not move state.</p>
          </div>
          <Hint tip="View call only. Asks if Northgate can be paid on this Harbourview remittance. Expect PayeeNotAuthorized. State does not change.">
            <button type="button" className="rounded-full border border-saffron px-4 py-2 text-sm text-saffron" onClick={viewPreview} disabled={busy !== ""}>
              {busy === "preview" ? "Calling view…" : "Run view call"}
            </button>
          </Hint>
        </div>
        {preview && <Result attempt={preview} />}
      </article>
      <article className="rounded-3xl border border-clay/40 bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-clay">PAYOUT_REJECTED</p>
            <h2 className="font-display text-2xl">Definite rail reject</h2>
            <p className="text-sm text-ink/70">
              The adapter reports that no credit was created. This is not pending and not settled. The sender can refund the locked $200.
              An unknown payout still cannot be refunded on a timer.
            </p>
          </div>
          <Hint tip="Reserves a Harbourview payout, stores a definite reject, and sets PAYOUT_REJECTED. No simulated credit is created.">
            <button
              type="button"
              className="rounded-full border border-clay px-4 py-2 text-sm text-clay"
              onClick={() => post("/api/demo/reject", setRejected, "reject")}
              disabled={busy !== ""}
            >
              {busy === "reject" ? "Submitting…" : "Mark rejected"}
            </button>
          </Hint>
        </div>
        {rejected && <Result attempt={rejected} />}
        {rejected?.id !== undefined && rejected.status === "PAYOUT_REJECTED" && (
          <Hint tip="Returns the locked $200 to the sender. This is allowed because the status is PAYOUT_REJECTED. An unknown payout cannot be refunded this way." className="mt-3">
            <button
              type="button"
              className="rounded-full bg-ink px-4 py-2 text-sm text-paper"
              onClick={() => post(`/api/demo/refund/${rejected.id}`, setRefunded, "refund")}
              disabled={busy !== ""}
            >
              {busy === "refund" ? "Refunding…" : "Refund the gross $200"}
            </button>
          </Hint>
        )}
        {refunded && <Result attempt={refunded} />}
      </article>
    </div>
  );
}

function Result({ attempt }: { attempt: Attempt }) {
  return (
    <p className="mt-4 rounded-2xl bg-paper px-4 py-3 text-sm">
      <span className="font-medium">{attempt.error ?? (attempt.ok ? "allowed" : "reverted")}</span>
      {attempt.kind ? <span className="text-ink/60"> · {attempt.label ?? attempt.kind}</span> : null}
      {attempt.status ? <span className="text-ink/60"> · {attempt.status}</span> : null}
      {attempt.explanation ? <span className="mt-1 block text-ink/70">{attempt.explanation}</span> : null}
      {attempt.txHash ? <span className="mt-1 block font-mono text-xs text-ink/70">{attempt.txHash}</span> : null}
    </p>
  );
}

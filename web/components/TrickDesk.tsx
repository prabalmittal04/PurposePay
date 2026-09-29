"use client";

import { useState } from "react";
import { relayerUrl } from "../lib/format";

type Attempt = {
  ok?: boolean;
  error?: string;
  txHash?: string;
  kind?: string;
  label?: string;
};

export function TrickDesk() {
  const [unregistered, setUnregistered] = useState<Attempt | null>(null);
  const [hospital, setHospital] = useState<Attempt | null>(null);
  const [preview, setPreview] = useState<Attempt | null>(null);
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
          <button type="button" className="rounded-full border border-ink px-4 py-2 text-sm" onClick={() => post("/api/trick/unregistered", setUnregistered, "friend")} disabled={busy !== ""}>
            {busy === "friend" ? "Submitting…" : "Submit transaction"}
          </button>
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
          <button type="button" className="rounded-full border border-ink px-4 py-2 text-sm" onClick={() => post("/api/trick/hospital", setHospital, "hospital")} disabled={busy !== ""}>
            {busy === "hospital" ? "Submitting…" : "Submit transaction"}
          </button>
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
          <button type="button" className="rounded-full border border-saffron px-4 py-2 text-sm text-saffron" onClick={viewPreview} disabled={busy !== ""}>
            {busy === "preview" ? "Calling view…" : "Run view call"}
          </button>
        </div>
        {preview && <Result attempt={preview} />}
      </article>
    </div>
  );
}

function Result({ attempt }: { attempt: Attempt }) {
  return (
    <p className="mt-4 rounded-2xl bg-paper px-4 py-3 text-sm">
      <span className="font-medium">{attempt.error ?? (attempt.ok ? "allowed" : "reverted")}</span>
      {attempt.kind ? <span className="text-ink/60"> · {attempt.label ?? attempt.kind}</span> : null}
      {attempt.txHash ? <span className="mt-1 block font-mono text-xs text-ink/70">{attempt.txHash}</span> : null}
    </p>
  );
}

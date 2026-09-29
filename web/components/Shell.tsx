import Link from "next/link";
import { Hint } from "./Hint";

const links = [
  { href: "/send", label: "Send", tip: "Lock $200 for Harbourview and settle. Treasury receives $199. The fee account keeps $1." },
  { href: "/trick", label: "Policy", tip: "Try a bad payee, a hospital, a different school, and a reject that can be refunded." },
  { href: "/audit", label: "Audit", tip: "Open the extract. Party columns are HMAC refs. Download the CSV or print it." },
];

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line/80 bg-paper/80">
        <div className="mx-auto flex max-w-5xl flex-wrap items-end justify-between gap-4 px-6 py-6">
          <div>
            <p className="text-[11px] uppercase tracking-[0.28em] text-saffron">PurposePay · local demo</p>
            <h1 className="font-display text-3xl leading-tight text-ink">Tuition, bound to one school</h1>
          </div>
          <nav className="flex gap-2 text-sm">
            {links.map((link) => (
              <Hint key={link.href} tip={link.tip}>
                <Link
                  href={link.href}
                  className="rounded-full border border-line px-4 py-1.5 hover:border-saffron hover:text-saffron"
                >
                  {link.label}
                </Link>
              </Hint>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
      <footer className="mx-auto max-w-5xl space-y-2 px-6 pb-12 text-sm leading-6 text-ink/70">
        <p>A silent relayer leaves a reserved payout in PAYOUT_PENDING or PAYOUT_UNKNOWN. Timeout refund is not built, because a late credit would double-pay.</p>
        <p>SETTLED is a local relayer attestation that the adapter returned CONFIRMED. The contract does not check the rail itself. This demo is not a trustless settlement protocol.</p>
        <p>A definite reject is PAYOUT_REJECTED. The sender can refund the gross because no credit was created. An unknown payout cannot be refunded on a timer.</p>
        <p>Purpose code P1301 is a demo mapping beside the tag TUITION. Ask a Citi mentor before treating it as a filing code.</p>
      </footer>
    </div>
  );
}

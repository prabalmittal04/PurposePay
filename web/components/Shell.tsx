import Link from "next/link";

const links = [
  { href: "/send", label: "Send" },
  { href: "/trick", label: "Policy" },
  { href: "/audit", label: "Audit" },
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
              <Link
                key={link.href}
                href={link.href}
                className="rounded-full border border-line px-4 py-1.5 hover:border-saffron hover:text-saffron"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
      <footer className="mx-auto max-w-5xl space-y-2 px-6 pb-12 text-sm leading-6 text-ink/70">
        <p>A silent relayer leaves a reserved payout in PAYOUT_PENDING or PAYOUT_UNKNOWN. Timeout refund is not built, because a late credit would double-pay.</p>
        <p>SETTLED is the relayer attesting that the adapter returned CONFIRMED. A definite rail reject is logged and left on chain.</p>
        <p>Purpose code P1301 is a demo mapping beside the tag TUITION. Ask a Citi mentor before treating it as a filing code.</p>
      </footer>
    </div>
  );
}

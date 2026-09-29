export function Hint({
  tip,
  children,
  className = "",
}: {
  tip: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={`group relative inline-flex ${className}`}>
      <span title={tip} className="inline-flex">
        {children}
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-30 mt-2 hidden w-64 rounded-xl bg-ink px-3 py-2 text-left text-xs leading-5 text-paper group-hover:block group-focus-within:block"
      >
        {tip}
      </span>
    </span>
  );
}

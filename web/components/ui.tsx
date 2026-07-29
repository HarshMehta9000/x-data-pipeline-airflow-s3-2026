import type { ReactNode } from "react";

export function Section({
  id,
  eyebrow,
  title,
  lede,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  lede?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="mx-auto w-full max-w-[1200px] px-6 py-16 sm:py-20">
      <header className="mb-8 max-w-[68ch]">
        <p className="mono mb-3 text-12 uppercase tracking-[0.14em] text-faint">
          {eyebrow}
        </p>
        <h2 className="text-28 font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        {lede ? <p className="mt-3 text-16 text-muted">{lede}</p> : null}
      </header>
      {children}
    </section>
  );
}

export function Panel({
  children,
  className = "",
  float = false,
}: {
  children: ReactNode;
  className?: string;
  float?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border border-hairline bg-surface ${float ? "shadow-[var(--shadow)]" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

export function PanelHead({
  title,
  right,
}: {
  title: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
      <h3 className="text-14 font-semibold text-ink">{title}</h3>
      {right}
    </div>
  );
}

export function CyclingBadge({ cycling }: { cycling: boolean }) {
  return (
    <span
      className={`mono inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-12 ${
        cycling
          ? "border-hairline text-faint"
          : "border-transparent bg-accent-soft text-accent"
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-1.5 w-1.5 rounded-full ${cycling ? "bg-faint" : "bg-accent"}`}
      />
      {cycling ? "cycling" : "yours"}
    </span>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone = "ink",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "ink" | "accent" | "failed" | "success";
}) {
  const toneClass =
    tone === "accent"
      ? "text-accent"
      : tone === "failed"
        ? "text-st-failed"
        : tone === "success"
          ? "text-st-success"
          : "text-ink";
  return (
    <div className="min-w-0">
      <p className="text-12 text-faint">{label}</p>
      <p className={`tnum mt-1 text-20 font-semibold ${toneClass}`}>{value}</p>
      {sub ? <p className="mt-0.5 text-12 text-muted">{sub}</p> : null}
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 max-w-[68ch] text-14 text-muted">
      {children}
    </p>
  );
}

/** Reads as an aside, never as a finding. */
export function Callout({
  kind = "note",
  children,
}: {
  kind?: "note" | "flag";
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border px-4 py-3 text-14 ${
        kind === "flag"
          ? "border-st-retry/40 bg-st-retry-bg text-ink"
          : "border-hairline bg-surface-2 text-muted"
      }`}
    >
      {children}
    </div>
  );
}

export function Mono({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`mono text-12 ${className}`}>{children}</span>;
}

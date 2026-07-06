/**
 * The shared watch-progress bar: an accent-filled track whose width reflects a
 * 0–1 fraction. Renders nothing when there's no progress. Pass `className` to
 * position/size it (e.g. `absolute inset-x-0 bottom-0` on a card thumbnail).
 */
export default function ProgressBar({
  fraction,
  className,
}: Readonly<{ fraction: number; className?: string }>) {
  if (fraction <= 0) return null;
  const pct = Math.round(Math.min(Math.max(fraction, 0), 1) * 100);
  return (
    <div className={`h-1 bg-white/30 ${className ?? ""}`}>
      <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
    </div>
  );
}

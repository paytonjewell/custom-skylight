/** Progress ring (Today and Tasks). Colour comes from the surrounding --c. */
export function Ring({ done, total, size }: { done: number; total: number; size: number }) {
  const r = size / 2 - 5,
    c = 2 * Math.PI * r,
    f = total ? done / total : 0,
    m = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={m} cy={m} r={r} className="ring-bg" />
      {/* Nothing done: no arc at all (a zero-length arc still draws a dot with its round cap) */}
      {f > 0 && (
        <circle
          cx={m}
          cy={m}
          r={r}
          className="ring-fg"
          strokeDasharray={`${c * f} ${c}`}
          transform={`rotate(-90 ${m} ${m})`}
        />
      )}
    </svg>
  );
}

/** What's written in a progress ring: ✓ when all are done, "2/5" on the way, – when there's nothing */
export const ringLabel = (done: number, total: number): string =>
  total > 0 && done === total ? '✓' : total ? `${done}/${total}` : '–';

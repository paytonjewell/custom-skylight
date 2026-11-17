/** Progress ring (Today and Tasks). Colour comes from the surrounding --c. */
export function Ring({ done, total, size }: { done: number; total: number; size: number }) {
  const r = size / 2 - 5, c = 2 * Math.PI * r, f = total ? done / total : 0, m = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={m} cy={m} r={r} className="ring-bg" />
      <circle cx={m} cy={m} r={r} className="ring-fg" strokeDasharray={`${c * f} ${c}`} transform={`rotate(-90 ${m} ${m})`} />
    </svg>
  );
}

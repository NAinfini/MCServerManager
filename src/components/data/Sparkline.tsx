interface SparklineProps {
  label: string;
  values: Array<number | null | undefined>;
  threshold?: number;
}

export function Sparkline({ label, threshold, values }: SparklineProps) {
  const samples = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  if (samples.length === 0) {
    return (
      <div aria-label={label} className="sparkline sparkline-empty" role="img">
        —
      </div>
    );
  }

  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const range = Math.max(max - min, 1);
  const denominator = Math.max(samples.length - 1, 1);
  const points = samples
    .map((value, index) => {
      const x = (index / denominator) * 100;
      const y = 30 - ((value - min) / range) * 28;
      return `${x},${y}`;
    })
    .join(" ");
  const isWarning =
    threshold !== undefined && samples.some((value) => value < threshold);

  return (
    <svg
      aria-label={label}
      className={`sparkline${isWarning ? " sparkline-warning" : ""}`}
      preserveAspectRatio="none"
      role="img"
      viewBox="0 0 100 32"
    >
      <polyline fill="none" points={points} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

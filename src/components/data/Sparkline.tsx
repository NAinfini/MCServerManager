interface SparklineProps {
  label: string;
  values: Array<number | null | undefined>;
  threshold?: number;
  /** The value the metric is read against — 100 for a percentage, 20 for TPS,
      the memory ceiling for memory. Scaling to the series' own range instead
      turns a steady reading into a full-height block that claims a swing the
      data never had. */
  max?: number;
  /** Renders the value inside the per-sample tooltip. */
  formatValue?: (value: number) => string;
}

const HEIGHT = 32;
const TOP = 3;
const BOTTOM = 30;

export function Sparkline({
  formatValue,
  label,
  max,
  threshold,
  values,
}: SparklineProps) {
  const samples = values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  if (samples.length === 0) {
    return (
      <div aria-label={label} className="sparkline sparkline-empty" role="img">
        —
      </div>
    );
  }

  const low = Math.min(...samples);
  const high = Math.max(...samples);
  /* With a ceiling the curve sits at its true fraction of that ceiling. Without
     one the series still has to be scaled to itself, but the range is padded so
     a flat run reads as a line near the middle rather than a filled box. */
  const pad = (high - low || Math.abs(high) || 1) * 0.25;
  const scaleMin = max === undefined ? low - pad : Math.min(0, low);
  const scaleMax = max === undefined ? high + pad : Math.max(max, high);
  const span = scaleMax - scaleMin || 1;
  const toY = (value: number) =>
    BOTTOM - ((value - scaleMin) / span) * (BOTTOM - TOP);

  /* A polyline needs two points to paint anything, so a series that has only
     produced one sample so far was rendering a blank box. Repeating it draws the
     one value we do have as a flat run instead of showing nothing. */
  const series = samples.length === 1 ? [samples[0], samples[0]] : samples;
  const step = 100 / (series.length - 1);
  const points = series.map((value, index) => ({
    value,
    x: index * step,
    y: toY(value),
  }));
  const coordinates = points.map((point) => `${point.x},${point.y}`).join(" ");
  const latest = points[points.length - 1];
  const isWarning =
    threshold !== undefined && samples.some((value) => value < threshold);
  const format = formatValue ?? ((value: number) => String(value));

  return (
    <svg
      aria-label={label}
      className={`sparkline${isWarning ? " sparkline-warning" : ""}`}
      preserveAspectRatio="none"
      role="img"
      viewBox={`0 0 100 ${HEIGHT}`}
    >
      {/* The baseline and the halfway rule give the curve something to be read
          against; a line floating in an empty box carries no scale at all. */}
      <line
        className="sparkline-grid"
        vectorEffect="non-scaling-stroke"
        x1="0"
        x2="100"
        y1={(TOP + BOTTOM) / 2}
        y2={(TOP + BOTTOM) / 2}
      />
      <line
        className="sparkline-axis"
        vectorEffect="non-scaling-stroke"
        x1="0"
        x2="100"
        y1={BOTTOM}
        y2={BOTTOM}
      />
      {/* The fill is what makes a two-sample series legible as a trend rather
          than a stray hairline. */}
      <polygon
        className="sparkline-area"
        points={`0,${BOTTOM} ${coordinates} 100,${BOTTOM}`}
      />
      <polyline
        className="sparkline-line"
        fill="none"
        points={coordinates}
        vectorEffect="non-scaling-stroke"
      />
      <line
        className="sparkline-current"
        vectorEffect="non-scaling-stroke"
        x1="0"
        x2="100"
        y1={latest.y}
        y2={latest.y}
      />
      {/* Native SVG tooltips: hovering a band names the sample under the
          cursor, so the curve can be read value by value without pulling in a
          charting library. */}
      {/* Off `samples`, not `series`: the duplicated point a single-sample run
          carries would otherwise lay two identical bands over each other. */}
      {samples.map((value, index) => (
        <rect
          className="sparkline-hit"
          height={HEIGHT}
          key={index}
          width={samples.length === 1 ? 100 : step}
          x={samples.length === 1 ? 0 : index * step - step / 2}
          y={0}
        >
          <title>{format(value)}</title>
        </rect>
      ))}
    </svg>
  );
}

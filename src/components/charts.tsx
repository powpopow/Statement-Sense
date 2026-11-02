/**
 * Two small charts, drawn as inline SVG.
 *
 * Both are single-series magnitude charts, so they carry direct value labels
 * instead of a legend, and a hover tooltip for the detail.
 */
import { useState, type ReactNode } from 'react'

export interface Datum {
  label: string
  value: number
  color: string
  detail?: string
}

function Tooltip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <div className="chart-tip" style={{ left: x + 12, top: y + 12 }}>
      {children}
    </div>
  )
}

const ROW_HEIGHT = 30
const BAR_HEIGHT = 16
const LABEL_WIDTH = 132

/** Horizontal bars: best form for comparing magnitude across named categories. */
export function BarChart({ data, format }: { data: Datum[]; format: (n: number) => string }) {
  const [hover, setHover] = useState<{ x: number; y: number; datum: Datum } | null>(null)

  if (!data.length) return <p className="muted small">No spending to chart yet.</p>

  const max = Math.max(...data.map((d) => d.value), 1)
  const height = data.length * ROW_HEIGHT
  // Leave room on the right for the value label that sits past the bar end.
  const plotWidth = 1000 - LABEL_WIDTH - 110

  return (
    <>
      <svg viewBox={`0 0 1000 ${height}`} width="100%" height={height} role="img" aria-label="Spending by category">
        {data.map((d, i) => {
          const y = i * ROW_HEIGHT
          const width = Math.max((d.value / max) * plotWidth, 2)
          return (
            <g
              key={d.label}
              onMouseMove={(e) => setHover({ x: e.clientX, y: e.clientY, datum: d })}
              onMouseLeave={() => setHover(null)}
            >
              <rect x={0} y={y} width={1000} height={ROW_HEIGHT} fill="transparent" />
              <text
                x={LABEL_WIDTH - 10}
                y={y + ROW_HEIGHT / 2}
                textAnchor="end"
                dominantBaseline="central"
                fontSize={13}
                fill="var(--text-secondary)"
              >
                {d.label}
              </text>
              <rect
                x={LABEL_WIDTH}
                y={y + (ROW_HEIGHT - BAR_HEIGHT) / 2}
                width={width}
                height={BAR_HEIGHT}
                rx={4}
                fill={d.color}
              />
              <text
                x={LABEL_WIDTH + width + 10}
                y={y + ROW_HEIGHT / 2}
                dominantBaseline="central"
                fontSize={13}
                fill="var(--text-primary)"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {format(d.value)}
              </text>
            </g>
          )
        })}
      </svg>
      {hover && (
        <Tooltip x={hover.x} y={hover.y}>
          <strong>{hover.datum.label}</strong>
          <br />
          {format(hover.datum.value)}
          {hover.datum.detail && (
            <>
              <br />
              <span className="muted">{hover.datum.detail}</span>
            </>
          )}
        </Tooltip>
      )}
    </>
  )
}

/** Vertical columns for a time series, where reading left to right is natural. */
export function ColumnChart({ data, format }: { data: Datum[]; format: (n: number) => string }) {
  const [hover, setHover] = useState<{ x: number; y: number; datum: Datum } | null>(null)

  if (!data.length) return <p className="muted small">Not enough history to chart yet.</p>

  const max = Math.max(...data.map((d) => d.value), 1)
  const width = 1000
  const height = 220
  const padBottom = 28
  const padTop = 24
  const slot = width / data.length
  const barWidth = Math.min(slot * 0.62, 56)

  return (
    <>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="Spending by month">
        <line x1={0} y1={height - padBottom} x2={width} y2={height - padBottom} stroke="var(--border)" strokeWidth={1} />
        {data.map((d, i) => {
          const barHeight = Math.max(((d.value / max) * (height - padTop - padBottom)), 2)
          const x = i * slot + (slot - barWidth) / 2
          const y = height - padBottom - barHeight
          return (
            <g
              key={d.label}
              onMouseMove={(e) => setHover({ x: e.clientX, y: e.clientY, datum: d })}
              onMouseLeave={() => setHover(null)}
            >
              <rect x={i * slot} y={0} width={slot} height={height} fill="transparent" />
              <rect x={x} y={y} width={barWidth} height={barHeight} rx={4} fill={d.color} />
              <text
                x={i * slot + slot / 2}
                y={height - padBottom + 16}
                textAnchor="middle"
                fontSize={12}
                fill="var(--text-muted)"
              >
                {d.label}
              </text>
            </g>
          )
        })}
      </svg>
      {hover && (
        <Tooltip x={hover.x} y={hover.y}>
          <strong>{hover.datum.label}</strong>
          <br />
          {format(hover.datum.value)}
          {hover.datum.detail && (
            <>
              <br />
              <span className="muted">{hover.datum.detail}</span>
            </>
          )}
        </Tooltip>
      )}
    </>
  )
}

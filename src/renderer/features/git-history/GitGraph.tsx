import { memo } from 'react';
import type { RowGraphData } from './graph-layout';

export const RAIL_WIDTH = 16;
export const ROW_HEIGHT = 32;
const NODE_RADIUS = 4;
const STROKE_WIDTH = 1.5;

function GitGraphCell({ data }: { data: RowGraphData }) {
  const width = (data.maxRail + 1) * RAIL_WIDTH;

  return (
    <svg width={width} height={ROW_HEIGHT} className="shrink-0" style={{ minWidth: width }}>
      {/* Vertical line segments */}
      {data.verticals.map((v, i) => {
        const x = v.rail * RAIL_WIDTH + RAIL_WIDTH / 2;
        const y1 = v.top ? 0 : ROW_HEIGHT / 2;
        const y2 = v.bottom ? ROW_HEIGHT : ROW_HEIGHT / 2;
        return (
          <line
            key={`v-${i}`}
            x1={x}
            y1={y1}
            x2={x}
            y2={y2}
            stroke={v.color}
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
          />
        );
      })}

      {/* Branch/merge curves */}
      {data.curves.map((c, i) => {
        const x1 = c.fromRail * RAIL_WIDTH + RAIL_WIDTH / 2;
        const x2 = c.toRail * RAIL_WIDTH + RAIL_WIDTH / 2;
        // Departure curve: starts at node mid-height, exits at bottom
        // Arrival curve: enters from top, arrives at node mid-height
        const d = c.arrival
          ? `M ${x1} 0 C ${x1} ${ROW_HEIGHT * 0.25}, ${x2} ${ROW_HEIGHT * 0.25}, ${x2} ${ROW_HEIGHT / 2}`
          : `M ${x1} ${ROW_HEIGHT / 2} C ${x1} ${ROW_HEIGHT * 0.75}, ${x2} ${ROW_HEIGHT * 0.75}, ${x2} ${ROW_HEIGHT}`;
        return (
          <path
            key={`c-${i}`}
            d={d}
            stroke={c.color}
            strokeWidth={STROKE_WIDTH}
            fill="none"
            strokeLinecap="round"
          />
        );
      })}

      {/* Commit node circle */}
      <circle
        cx={data.nodeRail * RAIL_WIDTH + RAIL_WIDTH / 2}
        cy={ROW_HEIGHT / 2}
        r={data.hasRefs ? NODE_RADIUS + 1 : NODE_RADIUS}
        fill={data.nodeColor}
        stroke="rgb(var(--color-bg-elevated))"
        strokeWidth={data.hasRefs ? 2 : 1.5}
      />
    </svg>
  );
}

export default memo(GitGraphCell);

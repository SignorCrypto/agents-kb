import { memo, useMemo } from 'react';
import type { GraphLayout } from './graph-layout';

export const RAIL_WIDTH = 16;
export const ROW_HEIGHT = 32;
const NODE_RADIUS = 4;
const STROKE_WIDTH = 1.5;

function GitGraph({ layout }: { layout: GraphLayout }) {
  const width = (layout.maxRail + 1) * RAIL_WIDTH + RAIL_WIDTH;
  const height = layout.nodes.length * ROW_HEIGHT;

  const paths = useMemo(() => {
    return layout.edges.map((edge, i) => {
      const x1 = edge.fromRail * RAIL_WIDTH + RAIL_WIDTH / 2;
      const y1 = edge.fromRow * ROW_HEIGHT + ROW_HEIGHT / 2;
      const x2 = edge.toRail * RAIL_WIDTH + RAIL_WIDTH / 2;
      const y2 = edge.toRow * ROW_HEIGHT + ROW_HEIGHT / 2;

      let d: string;
      if (x1 === x2) {
        // Straight vertical line
        d = `M ${x1} ${y1} L ${x2} ${y2}`;
      } else {
        // Curved merge/branch line using cubic bezier
        const midY = (y1 + y2) / 2;
        d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
      }

      return (
        <path
          key={`e-${i}`}
          d={d}
          stroke={edge.color}
          strokeWidth={STROKE_WIDTH}
          fill="none"
          strokeLinecap="round"
        />
      );
    });
  }, [layout.edges]);

  const circles = useMemo(() => {
    return layout.nodes.map((node) => {
      const cx = node.rail * RAIL_WIDTH + RAIL_WIDTH / 2;
      const cy = node.row * ROW_HEIGHT + ROW_HEIGHT / 2;
      const hasRefs = node.commit.refs.length > 0;
      return (
        <circle
          key={`n-${node.commit.hash}`}
          cx={cx}
          cy={cy}
          r={hasRefs ? NODE_RADIUS + 1 : NODE_RADIUS}
          fill={node.color}
          stroke="rgb(var(--color-bg-elevated))"
          strokeWidth={hasRefs ? 2 : 1.5}
        />
      );
    });
  }, [layout.nodes]);

  return (
    <svg
      width={width}
      height={height}
      className="shrink-0"
      style={{ minWidth: width }}
    >
      {paths}
      {circles}
    </svg>
  );
}

export default memo(GitGraph);

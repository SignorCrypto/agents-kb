import type { GitCommit } from '../../types/index';

export interface GraphNode {
  commit: GitCommit;
  rail: number;
  row: number;
  color: string;
}

export interface GraphEdge {
  fromRow: number;
  fromRail: number;
  toRow: number;
  toRail: number;
  color: string;
}

export interface RowVertical {
  rail: number;
  color: string;
  top: boolean;   // line enters from top of row
  bottom: boolean; // line exits to bottom of row
}

export interface RowCurve {
  fromRail: number;
  toRail: number;
  color: string;
  arrival?: boolean; // true = curve arrives from above into this row's node
}

export interface RowGraphData {
  nodeRail: number;
  nodeColor: string;
  hasRefs: boolean;
  verticals: RowVertical[];
  curves: RowCurve[];
  maxRail: number; // max rail with content at this specific row
}

export interface GraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  maxRail: number;
  rowGraphData: RowGraphData[];
}

// Colors that work well on both light and dark backgrounds
const RAIL_COLORS = [
  '#3b82f6', // blue
  '#ef4444', // red
  '#10b981', // emerald
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
];

function getRailColor(rail: number): string {
  return RAIL_COLORS[rail % RAIL_COLORS.length];
}

/**
 * Computes a git graph layout from topologically-ordered commits.
 *
 * Each commit is assigned to a "rail" (vertical lane). First parents continue
 * on the same rail; merge parents branch off to separate rails. When a parent
 * is claimed by multiple children, the lowest-numbered rail wins so the main
 * branch stays on rail 0.
 */
export function computeGraphLayout(commits: GitCommit[]): GraphLayout {
  if (commits.length === 0) return { nodes: [], edges: [], maxRail: 0, rowGraphData: [] };

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  let maxRail = 0;

  // Each lane slot holds the hash it expects next, or null if free.
  const lanes: (string | null)[] = [];
  const hashToNode = new Map<string, GraphNode>();

  function findLane(hash: string): number {
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === hash) return i;
    }
    return -1;
  }

  function findAllLanes(hash: string): number[] {
    const result: number[] = [];
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === hash) result.push(i);
    }
    return result;
  }

  function findFreeLane(): number {
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === null) return i;
    }
    lanes.push(null);
    return lanes.length - 1;
  }

  // ── Pass 1: assign rails ──────────────────────────────────────────────────

  for (let row = 0; row < commits.length; row++) {
    const commit = commits[row];

    // Find all lanes expecting this commit (can be >1 for merge convergence)
    const expected = findAllLanes(commit.hash);

    let rail: number;
    if (expected.length > 0) {
      // Take the lowest lane; free all others
      rail = expected[0];
      for (let i = 1; i < expected.length; i++) {
        lanes[expected[i]] = null;
      }
    } else {
      rail = findFreeLane();
    }

    lanes[rail] = null; // commit has arrived
    const color = getRailColor(rail);
    if (rail > maxRail) maxRail = rail;

    const node: GraphNode = { commit, rail, row, color };
    nodes.push(node);
    hashToNode.set(commit.hash, node);

    // Reserve lanes for parents
    const parents = commit.parents;
    for (let pi = 0; pi < parents.length; pi++) {
      const parentHash = parents[pi];
      const existing = findLane(parentHash);

      if (pi === 0) {
        // First parent continues on this rail
        if (existing === -1) {
          lanes[rail] = parentHash;
        } else if (existing > rail) {
          // Parent is reserved on a higher lane — pull it to this (lower) lane
          // so the main branch stays on the leftmost rail
          lanes[existing] = null;
          lanes[rail] = parentHash;
        }
        // If existing <= rail, leave it (parent already on a lower lane)
      } else {
        // Merge parent: give it its own lane if not already reserved
        if (existing === -1) {
          const newLane = findFreeLane();
          lanes[newLane] = parentHash;
          if (newLane > maxRail) maxRail = newLane;
        }
      }
    }

    // Root commit: nothing more to reserve
    if (parents.length === 0) {
      lanes[rail] = null;
    }
  }

  // ── Pass 2: draw edges ────────────────────────────────────────────────────

  for (const node of nodes) {
    for (let pi = 0; pi < node.commit.parents.length; pi++) {
      const parentNode = hashToNode.get(node.commit.parents[pi]);
      if (!parentNode) continue;

      edges.push({
        fromRow: node.row,
        fromRail: node.rail,
        toRow: parentNode.row,
        toRail: parentNode.rail,
        color: pi === 0 ? node.color : getRailColor(parentNode.rail),
      });
    }
  }

  // ── Pass 3: compute per-row graph data for dynamic-width rendering ───────

  const rowGraphData: RowGraphData[] = nodes.map((node) => ({
    nodeRail: node.rail,
    nodeColor: node.color,
    hasRefs: node.commit.refs.length > 0,
    verticals: [],
    curves: [],
    maxRail: node.rail,
  }));

  function mergeVertical(data: RowGraphData, rail: number, color: string, top: boolean, bottom: boolean) {
    const existing = data.verticals.find((v) => v.rail === rail);
    if (existing) {
      existing.top = existing.top || top;
      existing.bottom = existing.bottom || bottom;
    } else {
      data.verticals.push({ rail, color, top, bottom });
      if (rail > data.maxRail) data.maxRail = rail;
    }
  }

  for (const edge of edges) {
    const { fromRow, fromRail, toRow, toRail, color } = edge;

    if (fromRail === toRail) {
      // Straight vertical edge
      mergeVertical(rowGraphData[fromRow], fromRail, color, false, true);
      for (let r = fromRow + 1; r < toRow; r++) {
        mergeVertical(rowGraphData[r], fromRail, color, true, true);
      }
      if (toRow < rowGraphData.length) {
        mergeVertical(rowGraphData[toRow], toRail, color, true, false);
      }
    } else if (fromRail < toRail) {
      // Branching out: curve departs at child row, then straight on target rail
      rowGraphData[fromRow].curves.push({ fromRail, toRail, color });
      rowGraphData[fromRow].maxRail = Math.max(rowGraphData[fromRow].maxRail, fromRail, toRail);
      for (let r = fromRow + 1; r < toRow; r++) {
        mergeVertical(rowGraphData[r], toRail, color, true, true);
      }
      if (toRow < rowGraphData.length) {
        mergeVertical(rowGraphData[toRow], toRail, color, true, false);
      }
    } else {
      // Merging in: straight on source rail, then curve arrives at parent row
      mergeVertical(rowGraphData[fromRow], fromRail, color, false, true);
      for (let r = fromRow + 1; r < toRow; r++) {
        mergeVertical(rowGraphData[r], fromRail, color, true, true);
      }
      if (toRow < rowGraphData.length) {
        rowGraphData[toRow].curves.push({ fromRail, toRail, color, arrival: true });
        rowGraphData[toRow].maxRail = Math.max(rowGraphData[toRow].maxRail, fromRail, toRail);
      }
    }
  }

  // Compute actual maxRail from nodes (excludes phantom lane allocations)
  const actualMaxRail = nodes.reduce((max, n) => Math.max(max, n.rail), 0);

  return { nodes, edges, maxRail: actualMaxRail, rowGraphData };
}

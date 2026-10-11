/* Zone geometry shared by the Strategy Builder and the Simulator. */

export type Pt = [number, number]; // [col, row] — lattice point, (0,0) = top-left field corner
export type ZoneMode = 'replace' | 'add' | 'erase';


/** One colour per zone, cycled by the zone's position in the list. */
export const ZONE_COLORS = ['#fabc4d', '#38bdf8', '#f472b6', '#a78bfa', '#34d399', '#fb923c', '#f87171'];

export const keyOf = ([c, r]: Pt) => `${c},${r}`;
export const samePt = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1];

/** Bresenham line between two grid dots (inclusive), so fast drags don't skip dots. */
export const rasterLine = (a: Pt, b: Pt): Pt[] => {
  const pts: Pt[] = [];
  let [x0, y0] = a;
  const [x1, y1] = b;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  while (true) {
    pts.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
  return pts;
};

export const pointInPolygon = (x: number, y: number, poly: Pt[]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
};

/** Boundary dots + (if closed) every dot enclosed by the drawn outline. ptCols/ptRows = dot counts. */
export const enclosedDots = (path: Pt[], ptCols: number, ptRows: number, closed: boolean) => {
  // Rasterise every edge so clicked corners get straight, gap-free borders
  const out = new Set<string>([keyOf(path[0])]);
  for (let i = 1; i < path.length; i++) {
    rasterLine(path[i - 1], path[i]).forEach((p) => out.add(keyOf(p)));
  }
  if (!closed || path.length < 3) return out;
  rasterLine(path[path.length - 1], path[0]).forEach((p) => out.add(keyOf(p)));
  for (let r = 0; r < ptRows; r++) {
    for (let c = 0; c < ptCols; c++) {
      if (pointInPolygon(c, r, path)) out.add(keyOf([c, r]));
    }
  }
  return out;
};

/**
 * Zone SHAPES are stored as filled "quarters": every grid cell is split by both diagonals into
 * 4 triangles (0 = top, 1 = right, 2 = bottom, 3 = left). This keeps exactly what you drew:
 * straight/adjacent edges stay straight, and a diagonal only appears where you drew one.
 * Keys are "col,row,q". cols/rows = number of cells.
 */
export const qKey = (c: number, r: number, q: number) => `${c},${r},${q}`;

/** Centroid of quarter q of cell (c,r), in lattice units. */
export const quarterCentroid = (c: number, r: number, q: number): [number, number] =>
  q === 0
    ? [c + 0.5, r + 1 / 6]
    : q === 1
    ? [c + 5 / 6, r + 0.5]
    : q === 2
    ? [c + 0.5, r + 5 / 6]
    : [c + 1 / 6, r + 0.5];

/** Every quarter whose centre lies inside the closed outline. */
export const polygonQuarters = (path: Pt[], cols: number, rows: number): Set<string> => {
  const out = new Set<string>();
  if (path.length < 3) return out;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      for (let q = 0; q < 4; q++) {
        const [x, y] = quarterCentroid(c, r, q);
        if (pointInPolygon(x, y, path)) out.add(qKey(c, r, q));
      }
    }
  }
  return out;
};

/** Legacy zones (saved before shapes were stored) — rebuild a shape from their dots. */
export const quartersFromDots = (dots: Set<string>, cols: number, rows: number): Set<string> => {
  const out = new Set<string>();
  const has = (c: number, r: number) => dots.has(`${c},${r}`);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tl = has(c, r), tr = has(c + 1, r), br = has(c + 1, r + 1), bl = has(c, r + 1);
      const n = +tl + +tr + +br + +bl;
      let qs: number[] = [];
      if (n === 4) qs = [0, 1, 2, 3];
      else if (n === 3) qs = !tl ? [1, 2] : !tr ? [2, 3] : !br ? [3, 0] : [0, 1];
      qs.forEach((q) => out.add(qKey(c, r, q)));
    }
  }
  return out;
};

/**
 * Outline of a set of quarters as an SVG path (lattice units). Shared internal edges cancel,
 * the remaining boundary edges are chained into closed loops and collinear points dropped.
 */
export const quartersPath = (quarters: Set<string>): string => {
  // Work in doubled coordinates so cell centres are integers
  const edges = new Map<string, [Pt, Pt]>();
  const k2 = ([x, y]: Pt) => `${x},${y}`;
  quarters.forEach((key) => {
    const [c, r, q] = key.split(',').map(Number);
    const tl: Pt = [2 * c, 2 * r];
    const tr: Pt = [2 * c + 2, 2 * r];
    const br: Pt = [2 * c + 2, 2 * r + 2];
    const bl: Pt = [2 * c, 2 * r + 2];
    const ctr: Pt = [2 * c + 1, 2 * r + 1];
    const tri: Pt[] =
      q === 0 ? [tl, tr, ctr] : q === 1 ? [tr, br, ctr] : q === 2 ? [br, bl, ctr] : [bl, tl, ctr];
    for (let i = 0; i < 3; i++) {
      const a = tri[i];
      const b = tri[(i + 1) % 3];
      const rev = `${k2(b)}>${k2(a)}`;
      if (edges.has(rev)) edges.delete(rev);
      else edges.set(`${k2(a)}>${k2(b)}`, [a, b]);
    }
  });

  const out = new Map<string, Pt[]>();
  edges.forEach(([a, b]) => {
    const k = k2(a);
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push(b);
  });
  const take = (k: string): Pt | undefined => {
    const list = out.get(k);
    if (!list) return undefined;
    const p = list.pop();
    if (!list.length) out.delete(k);
    return p;
  };

  let d = '';
  while (out.size) {
    const startKey = out.keys().next().value as string;
    const loop: Pt[] = [startKey.split(',').map(Number) as Pt];
    let cur = startKey;
    for (let guard = 0; guard < 200000; guard++) {
      const nxt = take(cur);
      if (!nxt) break;
      cur = k2(nxt);
      if (cur === startKey) break;
      loop.push(nxt);
    }
    // Drop collinear points so straight edges are single segments
    const pts = loop.filter((p, i) => {
      const a = loop[(i - 1 + loop.length) % loop.length];
      const b = loop[(i + 1) % loop.length];
      return (p[0] - a[0]) * (b[1] - p[1]) !== (p[1] - a[1]) * (b[0] - p[0]);
    });
    if (pts.length < 3) continue;
    d += pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x / 2} ${y / 2}`).join('') + 'Z';
  }
  return d;
};

/** Grid-following line between two dots: only horizontal/vertical steps (no diagonal cuts). */
export const rasterLine4 = (a: Pt, b: Pt): Pt[] => {
  const pts: Pt[] = [a];
  let [x, y] = a;
  const dx = Math.abs(b[0] - x);
  const dy = Math.abs(b[1] - y);
  const sx = b[0] > x ? 1 : -1;
  const sy = b[1] > y ? 1 : -1;
  let ix = 0;
  let iy = 0;
  while (ix < dx || iy < dy) {
    if ((0.5 + ix) / dx < (0.5 + iy) / dy) {
      x += sx;
      ix++;
    } else {
      y += sy;
      iy++;
    }
    pts.push([x, y]);
  }
  return pts;
};


/* ------------------------------------------------------------------ */
/* Shared helpers used by both the Strategy Builder and the Simulator  */
/* ------------------------------------------------------------------ */

/** Number of grid CELLS for a resolution label (dots = cells + 1 in each direction). */
export const gridDimsFor = (resolution: string): { cols: number; rows: number } =>
  resolution === 'Coarse (8x6)'
    ? { cols: 8, rows: 6 }
    : resolution === 'Fine (16x12)'
    ? { cols: 16, rows: 12 }
    : { cols: 12, rows: 9 };

/** A situation's drawn shape as quarter-cells (falls back to rebuilding legacy dot-only zones). */
export const quartersOfSituation = (
  sit: { selectedDots: string[]; selectedQuarters?: string[] },
  cols: number,
  rows: number
): Set<string> =>
  sit.selectedQuarters
    ? new Set(sit.selectedQuarters)
    : quartersFromDots(new Set(sit.selectedDots), cols, rows);

/**
 * Which quarter-cell a point lies in. u, v are fractional lattice coordinates
 * (0..cols, 0..rows across the field). Returns null when off the field.
 */
export const quarterAt = (u: number, v: number, cols: number, rows: number): string | null => {
  if (u < 0 || v < 0 || u > cols || v > rows) return null;
  const c = Math.min(cols - 1, Math.floor(u));
  const r = Math.min(rows - 1, Math.floor(v));
  const fx = u - c;
  const fy = v - r;
  const q =
    fy <= fx && fy <= 1 - fx ? 0 : fx >= fy && fx >= 1 - fy ? 1 : fy >= fx && fy >= 1 - fx ? 2 : 3;
  return qKey(c, r, q);
};

export const zoneColor = (index: number) => ZONE_COLORS[(index < 0 ? 0 : index) % ZONE_COLORS.length];

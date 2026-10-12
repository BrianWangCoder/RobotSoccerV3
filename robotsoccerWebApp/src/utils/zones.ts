/* Zone geometry shared by the Strategy Builder and the Simulator. */
import polygonClipping, { MultiPolygon } from 'polygon-clipping';

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
 * Legacy shape format: "quarters" — every grid cell split by both diagonals into 4 triangles
 * (0 = top, 1 = right, 2 = bottom, 3 = left), keyed "col,row,q". Only read for old saves.
 */
export const qKey = (c: number, r: number, q: number) => `${c},${r},${q}`;

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


/* ------------------------------------------------------------------ */
/* Shared helpers used by both the Strategy Builder and the Simulator  */
/* ------------------------------------------------------------------ */

/** Number of grid CELLS for a resolution label (dots = cells + 1 in each direction). */
export const RESOLUTIONS = [
  { label: 'Very Coarse (4x3)', cols: 4, rows: 3 },
  { label: 'Coarse (8x6)', cols: 8, rows: 6 },
  { label: 'Medium (12x9)', cols: 12, rows: 9 },
  { label: 'Fine (16x12)', cols: 16, rows: 12 },
  { label: 'Extra Fine (20x15)', cols: 20, rows: 15 },
  { label: 'Ultra Fine (24x18)', cols: 24, rows: 18 },
] as const;

export const gridDimsFor = (resolution: string): { cols: number; rows: number } => {
  const r = RESOLUTIONS.find((r) => r.label === resolution);
  return r ? { cols: r.cols, rows: r.rows } : { cols: 12, rows: 9 };
};

/** A situation's drawn shape as quarter-cells (falls back to rebuilding legacy dot-only zones). */
export const quartersOfSituation = (
  sit: { selectedDots: string[]; selectedQuarters?: string[] },
  cols: number,
  rows: number
): Set<string> =>
  sit.selectedQuarters
    ? new Set(sit.selectedQuarters)
    : quartersFromDots(new Set(sit.selectedDots), cols, rows);

export const zoneColor = (index: number) => ZONE_COLORS[(index < 0 ? 0 : index) % ZONE_COLORS.length];

/* ------------------------------------------------------------------ */
/* Polygon zone shapes                                                 */
/* ------------------------------------------------------------------ */

/**
 * Zone shapes are stored as exact polygons in NORMALISED field units (0..1 across, 0..1 down),
 * so edges at any angle stay perfectly straight and the shape survives resolution changes.
 * Format is polygon-clipping's MultiPolygon: polygons → rings (outer first, then holes) → [x, y].
 */
export type ZoneShape = MultiPolygon;

/** Closed outline (lattice dots) → normalised shape; self-crossings are resolved by the union. */
export const shapeFromPath = (path: Pt[], cols: number, rows: number): ZoneShape =>
  path.length < 3
    ? []
    : polygonClipping.union([[path.map(([c, r]) => [c / cols, r / rows] as [number, number])]]);

export const mergeShapes = (drawn: ZoneShape, mode: ZoneMode, current: ZoneShape): ZoneShape => {
  if (mode === 'replace') return drawn;
  if (mode === 'add') return polygonClipping.union(current, drawn);
  return current.length ? polygonClipping.difference(current, drawn) : [];
};

/** Legacy zones stored as quarter-cells — rebuild a polygon from their triangles. */
export const shapeFromQuarters = (quarters: Set<string>, cols: number, rows: number): ZoneShape => {
  if (!quarters.size) return [];
  const tris: ZoneShape = [...quarters].map((key) => {
    const [c, r, q] = key.split(',').map(Number);
    const tl: Pt = [c, r];
    const tr: Pt = [c + 1, r];
    const br: Pt = [c + 1, r + 1];
    const bl: Pt = [c, r + 1];
    const ctr: Pt = [c + 0.5, r + 0.5];
    const tri = q === 0 ? [tl, tr, ctr] : q === 1 ? [tr, br, ctr] : q === 2 ? [br, bl, ctr] : [bl, tl, ctr];
    return [tri.map(([x, y]) => [x / cols, y / rows] as [number, number])];
  });
  return polygonClipping.union(tris[0], ...tris.slice(1));
};

type ShapeCarrier = {
  selectedDots: string[];
  selectedQuarters?: string[];
  selectedShape?: ZoneShape;
};
const shapeCache = new WeakMap<object, { cols: number; rows: number; shape: ZoneShape }>();

/** A situation's shape (rebuilt from quarters / dots for zones saved in older formats). */
export const shapeOfSituation = (sit: ShapeCarrier, cols: number, rows: number): ZoneShape => {
  if (sit.selectedShape) return sit.selectedShape;
  const hit = shapeCache.get(sit);
  if (hit && hit.cols === cols && hit.rows === rows) return hit.shape;
  const shape = shapeFromQuarters(quartersOfSituation(sit, cols, rows), cols, rows);
  shapeCache.set(sit, { cols, rows, shape });
  return shape;
};

/** SVG path for a shape inside a `0 0 cols rows` viewBox (use fillRule="evenodd"). */
export const shapePath = (shape: ZoneShape, cols: number, rows: number): string =>
  shape
    .flatMap((poly) =>
      poly.map(
        (ring) =>
          ring
            .slice(0, -1) // polygon-clipping repeats the first point at the end
            .map(([x, y], i) => `${i ? 'L' : 'M'}${x * cols} ${y * rows}`)
            .join('') + 'Z'
      )
    )
    .join('');

/** Is a normalised point inside (even-odd across all rings, so holes are excluded)? */
export const pointInShape = (x: number, y: number, shape: ZoneShape): boolean => {
  let inside = false;
  shape.forEach((poly) =>
    poly.forEach((ring) => {
      if (pointInPolygon(x, y, ring as Pt[])) inside = !inside;
    })
  );
  return inside;
};

const onSegment = (x: number, y: number, [ax, ay]: number[], [bx, by]: number[]) => {
  const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
  const len = Math.hypot(bx - ax, by - ay) || 1;
  if (Math.abs(cross) / len > 1e-9) return false;
  return (
    x >= Math.min(ax, bx) - 1e-9 &&
    x <= Math.max(ax, bx) + 1e-9 &&
    y >= Math.min(ay, by) - 1e-9 &&
    y <= Math.max(ay, by) + 1e-9
  );
};

/** Lattice dots inside or exactly on the edge of a shape. */
export const dotsInShape = (shape: ZoneShape, cols: number, rows: number): Set<string> => {
  const out = new Set<string>();
  if (!shape.length) return out;
  const rings = shape.flat();
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const x = c / cols;
      const y = r / rows;
      const onEdge = rings.some((ring) =>
        ring.some((p, i) => i > 0 && onSegment(x, y, ring[i - 1], p))
      );
      if (onEdge || pointInShape(x, y, shape)) out.add(keyOf([c, r]));
    }
  }
  return out;
};

/** Area-weighted centre of a shape (normalised units), or null when empty. */
export const shapeCentroid = (shape: ZoneShape): [number, number] | null => {
  let a = 0;
  let cx = 0;
  let cy = 0;
  shape.flat().forEach((ring) => {
    for (let i = 1; i < ring.length; i++) {
      const [x0, y0] = ring[i - 1];
      const [x1, y1] = ring[i];
      const f = x0 * y1 - x1 * y0;
      a += f;
      cx += (x0 + x1) * f;
      cy += (y0 + y1) * f;
    }
  });
  if (Math.abs(a) < 1e-12) return null;
  return [cx / (3 * a), cy / (3 * a)];
};

/**
 * Straightens a freehand outline (Ramer–Douglas–Peucker). Points whose index is in `keep`
 * (clicked corners) are never removed; wobbly dragged runs between them become straight edges.
 */
export const simplifyPath = (path: Pt[], keep: Set<number>, eps = 0.75): Pt[] => {
  if (path.length < 3) return path;
  const dist = (p: Pt, a: Pt, b: Pt) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (!len) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    return Math.abs(dx * (a[1] - p[1]) - dy * (a[0] - p[0])) / len;
  };
  const rdp = (pts: Pt[]): Pt[] => {
    if (pts.length < 3) return pts;
    let best = -1;
    let at = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = dist(pts[i], pts[0], pts[pts.length - 1]);
      if (d > best) {
        best = d;
        at = i;
      }
    }
    if (best <= eps) return [pts[0], pts[pts.length - 1]];
    return [...rdp(pts.slice(0, at + 1)).slice(0, -1), ...rdp(pts.slice(at))];
  };
  // The outline is closed, so the run after the last kept point wraps back to the start
  const anchors = [...new Set([0, ...[...keep].filter((i) => i > 0 && i < path.length)])].sort(
    (a, b) => a - b
  );
  const ring = [...path, path[0]];
  const out: Pt[] = [];
  anchors.forEach((s, k) => {
    const e = k + 1 < anchors.length ? anchors[k + 1] : path.length;
    out.push(...rdp(ring.slice(s, e + 1)).slice(0, -1));
  });
  return out;
};

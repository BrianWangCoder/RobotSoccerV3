import React, { useEffect, useRef, useState } from 'react';
import {
  Save,
  Copy,
  Upload,
  RotateCcw,
  Navigation,
  RotateCw,
  RefreshCw,
  Shield,
  Activity,
  Zap,
  Flame,
  X,
  Plus,
  Info,
  ChevronDown,
  Layers,
  Bot,
  Hexagon,
  Trash2,
} from 'lucide-react';
import {
  StrategyConfig,
  ScriptBlock,
  RobotRoutine,
  BlockType,
} from '../types/strategy';

/* ------------------------------------------------------------------ */
/* Block definitions (single source of truth for palette + workspace) */
/* ------------------------------------------------------------------ */

interface FieldDef {
  key: string;
  label: string;
  width: string;
  def: string;
}

interface BlockDef {
  label: string;
  category: ScriptBlock['category'];
  icon: React.ElementType;
  iconClass?: string;
  bg: string;
  hover: string;
  input: string;
  fields: FieldDef[];
}

const BLOCK_DEFS: Record<BlockType, BlockDef> = {
  move: {
    label: 'Move to',
    category: 'motion',
    icon: Navigation,
    iconClass: 'rotate-45',
    bg: 'bg-[#2563eb]',
    hover: 'hover:bg-[#1d4ed8]',
    input: 'bg-[#1e40af]',
    fields: [
      { key: 'start', label: 'Start', width: 'w-16', def: '[0, 0]' },
      { key: 'stop', label: 'Stop', width: 'w-20', def: '[120, -50]' },
      { key: 'speed', label: 'Speed', width: 'w-14', def: '80%' },
    ],
  },
  turn: {
    label: 'Turn',
    category: 'motion',
    icon: RotateCw,
    bg: 'bg-[#2563eb]',
    hover: 'hover:bg-[#1d4ed8]',
    input: 'bg-[#1e40af]',
    fields: [
      { key: 'speed', label: 'Speed', width: 'w-16', def: '60°/s' },
      { key: 'angle', label: 'Angle', width: 'w-16', def: '180°' },
    ],
  },
  spin: {
    label: 'Spin',
    category: 'motion',
    icon: RefreshCw,
    bg: 'bg-[#2563eb]',
    hover: 'hover:bg-[#1d4ed8]',
    input: 'bg-[#1e40af]',
    fields: [{ key: 'rpm', label: 'Speed [rpm]', width: 'w-16', def: '450' }],
  },
  defender: {
    label: 'Defender',
    category: 'tactical',
    icon: Shield,
    bg: 'bg-[#16a34a]',
    hover: 'hover:bg-[#15803d]',
    input: 'bg-[#15803d]',
    fields: [
      { key: 'start', label: 'Start', width: 'w-24', def: '[Left Flank]' },
      { key: 'stop', label: 'Stop', width: 'w-24', def: '[Penalty Arc]' },
    ],
  },
  goalkeeper: {
    label: 'GoalKeeper',
    category: 'tactical',
    icon: Activity,
    bg: 'bg-[#16a34a]',
    hover: 'hover:bg-[#15803d]',
    input: 'bg-[#15803d]',
    fields: [
      { key: 'start', label: 'Start', width: 'w-20', def: '[Post L]' },
      { key: 'stop', label: 'Stop', width: 'w-20', def: '[Post R]' },
    ],
  },
  kickA: {
    label: 'KickA',
    category: 'kick',
    icon: Zap,
    bg: 'bg-[#ea580c]',
    hover: 'hover:bg-[#c2410c]',
    input: 'bg-[#c2410c]',
    fields: [
      { key: 'threshold', label: 'Threshold', width: 'w-16', def: '0.85' },
      { key: 'speed', label: 'Speed', width: 'w-16', def: '95%' },
    ],
  },
  kickB: {
    label: 'KickB',
    category: 'kick',
    icon: Flame,
    bg: 'bg-[#ea580c]',
    hover: 'hover:bg-[#c2410c]',
    input: 'bg-[#c2410c]',
    fields: [
      { key: 'threshold', label: 'Threshold', width: 'w-16', def: '0.65' },
      { key: 'speed', label: 'Speed', width: 'w-16', def: '75%' },
    ],
  },
};

const PALETTE_GROUPS: { title: string; color: string; types: BlockType[] }[] = [
  { title: '● MOTION & KINEMATICS', color: 'text-[#3b82f6]', types: ['move', 'turn', 'spin'] },
  { title: '● TACTICAL ROLES', color: 'text-[#22c55e]', types: ['defender', 'goalkeeper'] },
  { title: '● KICK PROTOCOL', color: 'text-[#f97316]', types: ['kickA', 'kickB'] },
];

const newId = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

const createBlock = (type: BlockType): ScriptBlock => {
  const d = BLOCK_DEFS[type];
  return {
    id: newId('blk'),
    type,
    category: d.category,
    params: Object.fromEntries(d.fields.map((f) => [f.key, f.def])),
  } as ScriptBlock;
};

/* ------------------------------------------------------------------ */
/* Drag & drop types                                                   */
/* ------------------------------------------------------------------ */

type DragPayload =
  | { kind: 'new-block'; blockType: BlockType }
  | { kind: 'stack'; routineId: string; blockIds: string[] }
  | { kind: 'new-hat'; robotId: number }
  | { kind: 'routine'; routineId: string; fromPalette?: boolean };

type DropHint =
  | { kind: 'blocks'; routineId: string; index: number }
  | { kind: 'routines'; index: number }
  | { kind: 'delete' }
  | null;

interface DragState {
  payload: DragPayload;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  width: number;
}

interface PendingDrag {
  payload: DragPayload;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  width: number;
  onClick?: () => void;
}

const DRAG_THRESHOLD = 5;

/** Works out where the dragged item would land, purely from the DOM under the pointer. */
const computeHint = (payload: DragPayload, x: number, y: number): DropHint => {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!el) return null;

  if (el.closest('[data-palette]')) {
    const deletable =
      payload.kind === 'stack' || (payload.kind === 'routine' && !payload.fromPalette);
    return deletable ? { kind: 'delete' } : null;
  }

  const canvas = el.closest('[data-canvas]') as HTMLElement | null;
  if (!canvas) return null;

  // Blocks snap into a robot stack
  if (payload.kind === 'new-block' || payload.kind === 'stack') {
    const wrapper = el.closest('[data-routine-id]') as HTMLElement | null;
    if (!wrapper) return null;
    const blocks = Array.from(wrapper.querySelectorAll<HTMLElement>('[data-block-id]'));
    let index = blocks.length;
    for (let i = 0; i < blocks.length; i++) {
      const r = blocks[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) {
        index = i;
        break;
      }
    }
    return { kind: 'blocks', routineId: wrapper.dataset.routineId!, index };
  }

  // Hats / whole stacks slot between other stacks
  const wrappers = Array.from(canvas.querySelectorAll<HTMLElement>('[data-routine-id]'));
  let index = wrappers.length;
  for (let i = 0; i < wrappers.length; i++) {
    const r = wrappers[i].getBoundingClientRect();
    if (y < r.top + r.height / 2) {
      index = i;
      break;
    }
  }
  return { kind: 'routines', index };
};

/* ------------------------------------------------------------------ */
/* Presentational pieces                                               */
/* ------------------------------------------------------------------ */

interface BlockViewProps {
  block: ScriptBlock;
  ghost?: boolean;
  onParamChange?: (key: string, value: string) => void;
  onDelete?: () => void;
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
}

const BlockView: React.FC<BlockViewProps> = ({
  block,
  ghost,
  onParamChange,
  onDelete,
  onPointerDown,
}) => {
  const def = BLOCK_DEFS[block.type as BlockType];
  const Icon = def.icon;
  const params = block.params as Record<string, string | undefined>;

  return (
    <div
      data-block-id={ghost ? undefined : block.id}
      onPointerDown={onPointerDown}
      className={`${def.bg} text-white px-3 py-2 flex items-center justify-between text-xs shadow-xs ${
        ghost ? '' : 'cursor-grab active:cursor-grabbing touch-none'
      }`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <Icon className={`w-3.5 h-3.5 shrink-0 ${def.iconClass ?? ''}`} />
        <span className="font-bold">{def.label}</span>
        {def.fields.map((f) => (
          <React.Fragment key={f.key}>
            <span className="text-white/80 text-[11px]">{f.label}:</span>
            <input
              data-no-drag
              type="text"
              readOnly={ghost}
              value={params[f.key] ?? f.def}
              onChange={(e) => onParamChange?.(f.key, e.target.value)}
              className={`${f.width} ${def.input} text-center text-white text-[11px] px-1 py-0.5 font-mono focus:outline-hidden cursor-text select-text`}
            />
          </React.Fragment>
        ))}
      </div>
      {onDelete && (
        <button
          data-no-drag
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="text-white/70 hover:text-white ml-2 p-0.5"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};

interface HatViewProps {
  robotId: number;
  situationName: string;
  ghost?: boolean;
  onDelete?: () => void;
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
}

const HatView: React.FC<HatViewProps> = ({
  robotId,
  situationName,
  ghost,
  onDelete,
  onPointerDown,
}) => (
  <div
    onPointerDown={onPointerDown}
    className={`relative bg-[#d97706] hover:bg-[#b45309] text-white px-3.5 py-2.5 flex items-center justify-between shadow-md ${
      ghost ? '' : 'cursor-grab active:cursor-grabbing touch-none'
    }`}
  >
    <div className="flex items-center gap-2 font-bold text-xs tracking-wide">
      <Bot className="w-4 h-4 text-white" />
      <span>
        Robot {robotId}{' '}
        <span className="font-normal opacity-90">(When Ball in {situationName})</span>
      </span>
    </div>
    {onDelete && (
      <button
        data-no-drag
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="text-white/80 hover:text-white p-0.5 hover:bg-black/20"
        title="Delete Robot Stack"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    )}
  </div>
);

/* ------------------------------------------------------------------ */
/* Zone drawing helpers                                                */
/* ------------------------------------------------------------------ */

type Pt = [number, number]; // [col, row] — lattice point, (0,0) = top-left field corner
type ZoneMode = 'replace' | 'add' | 'erase';

/** Field outline inside the 400x300 SVG is x 20..380, y 20..280 → dots sit exactly on it. */
const FIELD_INSET_X = (20 / 400) * 100; // %
const FIELD_INSET_Y = (20 / 300) * 100; // %

/** One colour per zone, cycled by the zone's position in the list. */
const ZONE_COLORS = ['#fabc4d', '#38bdf8', '#f472b6', '#a78bfa', '#34d399', '#fb923c', '#f87171'];

const keyOf = ([c, r]: Pt) => `${c},${r}`;
const samePt = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1];

/** Bresenham line between two grid dots (inclusive), so fast drags don't skip dots. */
const rasterLine = (a: Pt, b: Pt): Pt[] => {
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

const pointInPolygon = (x: number, y: number, poly: Pt[]) => {
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
const enclosedDots = (path: Pt[], ptCols: number, ptRows: number, closed: boolean) => {
  const out = new Set<string>(path.map(keyOf));
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
 * Turns a set of selected dots into the outline of the actual shape (SVG path in lattice units).
 * Each grid cell is filled when ≥3 of its 4 corner dots are selected (3 → triangle, so diagonal
 * edges stay diagonal). Shared internal edges cancel out, leaving only the true boundary, which is
 * then chained into closed loops. cols/rows = number of cells.
 */
const zonePathFor = (dots: Set<string>, cols: number, rows: number): string => {
  const has = (c: number, r: number) => dots.has(`${c},${r}`);
  const edges = new Map<string, [Pt, Pt]>();

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Clockwise on screen; filtering keeps the winding consistent for triangles too.
      const corners: Pt[] = [
        [c, r],
        [c + 1, r],
        [c + 1, r + 1],
        [c, r + 1],
      ];
      const poly = corners.filter(([x, y]) => has(x, y));
      if (poly.length < 3) continue;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const rev = `${keyOf(b)}>${keyOf(a)}`;
        if (edges.has(rev)) edges.delete(rev);
        else edges.set(`${keyOf(a)}>${keyOf(b)}`, [a, b]);
      }
    }
  }

  const out = new Map<string, Pt[]>();
  edges.forEach(([a, b]) => {
    const k = keyOf(a);
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
    const [sc, sr] = startKey.split(',').map(Number);
    d += `M${sc} ${sr}`;
    let cur = startKey;
    for (let guard = 0; guard < 100000; guard++) {
      const nxt = take(cur);
      if (!nxt) break;
      cur = keyOf(nxt);
      if (cur === startKey) break;
      d += `L${nxt[0]} ${nxt[1]}`;
    }
    d += 'Z';
  }
  return d;
};

/* ------------------------------------------------------------------ */
/* Main view                                                           */
/* ------------------------------------------------------------------ */

interface StrategyBuilderViewProps {
  strategy: StrategyConfig;
  onUpdateStrategy: (updated: StrategyConfig) => void;
  onSaveStrategy: () => void;
  onSaveAsStrategy: () => void;
  onImportStrategy: () => void;
}

export const StrategyBuilderView: React.FC<StrategyBuilderViewProps> = ({
  strategy,
  onUpdateStrategy,
  onSaveStrategy,
  onSaveAsStrategy,
  onImportStrategy,
}) => {
  const activeSituation =
    strategy.situations.find((s) => s.id === strategy.activeSituationId) ||
    strategy.situations[0];

  const situationNameFor = (situationId: string) =>
    strategy.situations.find((s) => s.id === situationId)?.name ?? activeSituation.name;

  type Situation = StrategyConfig['situations'][number];

  const colorFor = (situationId: string) => {
    const i = strategy.situations.findIndex((s) => s.id === situationId);
    return ZONE_COLORS[(i < 0 ? 0 : i) % ZONE_COLORS.length];
  };
  const activeColor = colorFor(activeSituation.id);

  /* ---------------- zone (situation) management ---------------- */

  const handleSelectZone = (id: string) => {
    if (id !== strategy.activeSituationId)
      onUpdateStrategy({ ...strategy, activeSituationId: id });
  };

  const handleAddZone = () => {
    const nums = strategy.situations
      .map((s) => parseInt(s.name.replace(/\D/g, ''), 10))
      .filter((n) => !isNaN(n));
    const n = Math.max(0, ...nums) + 1;
    const zone = {
      ...activeSituation,
      id: newId('sit'),
      name: `Situation ${n}`,
      priority: 'Medium Priority',
      selectedDots: [],
      minCol: 0,
      maxCol: 0,
      minRow: 0,
      maxRow: 0,
    } as Situation;
    onUpdateStrategy({
      ...strategy,
      situations: [...strategy.situations, zone],
      activeSituationId: zone.id,
    });
  };

  const handleDeleteZone = (id: string) => {
    if (strategy.situations.length <= 1) return;
    const remaining = strategy.situations.filter((s) => s.id !== id);
    onUpdateStrategy({
      ...strategy,
      situations: remaining,
      routines: strategy.routines.filter((r) => r.situationId !== id),
      activeSituationId:
        id === activeSituation.id ? remaining[0].id : strategy.activeSituationId,
    });
  };

  const handleRenameZone = (id: string, name: string) => {
    onUpdateStrategy({
      ...strategy,
      situations: strategy.situations.map((s) => (s.id === id ? { ...s, name } : s)),
    });
  };

  // Grid resolution = number of cells; dots sit on cell corners, so there are cols+1 × rows+1 dots
  // running from field edge to field edge (incl. the halfway line).
  const gridDims =
    strategy.resolution === 'Coarse (8x6)'
      ? { cols: 8, rows: 6 }
      : strategy.resolution === 'Fine (16x12)'
      ? { cols: 16, rows: 12 }
      : { cols: 12, rows: 9 };
  const ptCols = gridDims.cols + 1;
  const ptRows = gridDims.rows + 1;

  const [selectedRobotForAdd, setSelectedRobotForAdd] = useState<number>(1);
  const [sliderVal, setSliderVal] = useState<number>(1); // 0 = Coarse, 1 = Med, 2 = Fine

  /* ---------------- drag state ---------------- */
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hint, setHint] = useState<DropHint>(null);
  const pendingRef = useRef<PendingDrag | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const hintRef = useRef<DropHint>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const strategyRef = useRef(strategy);
  strategyRef.current = strategy;
  const updateRef = useRef(onUpdateStrategy);
  updateRef.current = onUpdateStrategy;

  const commit = (routines: RobotRoutine[]) =>
    updateRef.current({ ...strategyRef.current, routines });

  /** Applies a finished drag to the strategy. */
  const applyDrop = (payload: DragPayload, h: DropHint) => {
    const s = strategyRef.current;
    if (!h) return; // dropped nowhere useful → snaps back

    if (h.kind === 'delete') {
      if (payload.kind === 'stack') {
        commit(
          s.routines.map((r) =>
            r.id === payload.routineId
              ? { ...r, blocks: r.blocks.filter((b) => !payload.blockIds.includes(b.id)) }
              : r
          )
        );
      } else if (payload.kind === 'routine') {
        commit(s.routines.filter((r) => r.id !== payload.routineId));
      }
      return;
    }

    if (h.kind === 'blocks') {
      let routines = s.routines;
      let moving: ScriptBlock[];

      if (payload.kind === 'new-block') {
        moving = [createBlock(payload.blockType)];
      } else if (payload.kind === 'stack') {
        const src = routines.find((r) => r.id === payload.routineId);
        if (!src) return;
        moving = src.blocks.filter((b) => payload.blockIds.includes(b.id));
        routines = routines.map((r) =>
          r.id === src.id
            ? { ...r, blocks: r.blocks.filter((b) => !payload.blockIds.includes(b.id)) }
            : r
        );
      } else {
        return;
      }

      let targetRobot: number | null = null;
      routines = routines.map((r) => {
        if (r.id !== h.routineId) return r;
        targetRobot = r.robotId;
        const blocks = [...r.blocks];
        blocks.splice(h.index, 0, ...moving);
        return { ...r, blocks };
      });
      commit(routines);
      if (targetRobot !== null) setSelectedRobotForAdd(targetRobot);
      return;
    }

    // h.kind === 'routines' — index is relative to the active zone's stacks only
    const routines = [...s.routines];
    let moving: RobotRoutine;
    if (payload.kind === 'routine') {
      const idx = routines.findIndex((r) => r.id === payload.routineId);
      if (idx < 0) return;
      moving = routines.splice(idx, 1)[0];
    } else if (payload.kind === 'new-hat') {
      moving = {
        id: newId(`routine_r${payload.robotId}`),
        robotId: payload.robotId,
        situationId: s.activeSituationId,
        blocks: [],
      };
    } else {
      return;
    }
    const ctx = routines.filter((r) => r.situationId === s.activeSituationId);
    const insertAt =
      h.index < ctx.length
        ? routines.indexOf(ctx[h.index])
        : ctx.length
        ? routines.indexOf(ctx[ctx.length - 1]) + 1
        : routines.length;
    routines.splice(insertAt, 0, moving);
    commit(routines);
    setSelectedRobotForAdd(moving.robotId);
  };

  const applyDropRef = useRef(applyDrop);
  applyDropRef.current = applyDrop;

  // Global pointer listeners (registered once, read everything through refs)
  useEffect(() => {
    const reset = () => {
      pendingRef.current = null;
      dragRef.current = null;
      hintRef.current = null;
      setDrag(null);
      setHint(null);
    };

    const autoScroll = (x: number, y: number) => {
      const ws = workspaceRef.current;
      if (!ws) return;
      const r = ws.getBoundingClientRect();
      if (x < r.left || x > r.right) return;
      if (y < r.top + 48) ws.scrollBy(0, -14);
      else if (y > r.bottom - 48) ws.scrollBy(0, 14);
    };

    const onMove = (e: PointerEvent) => {
      const p = pendingRef.current;
      if (!p) return;
      if (!dragRef.current) {
        if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) < DRAG_THRESHOLD) return;
        dragRef.current = {
          payload: p.payload,
          x: e.clientX,
          y: e.clientY,
          offsetX: p.offsetX,
          offsetY: p.offsetY,
          width: p.width,
        };
      } else {
        dragRef.current = { ...dragRef.current, x: e.clientX, y: e.clientY };
      }
      setDrag(dragRef.current);
      const h = computeHint(dragRef.current.payload, e.clientX, e.clientY);
      hintRef.current = h;
      setHint(h);
      autoScroll(e.clientX, e.clientY);
    };

    const onUp = () => {
      const p = pendingRef.current;
      const d = dragRef.current;
      const h = hintRef.current;
      reset();
      if (!p) return;
      if (!d) {
        p.onClick?.(); // no movement → treat as a click
        return;
      }
      applyDropRef.current(d.payload, h);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dragRef.current) reset();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', reset);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', reset);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    document.body.style.cursor = drag ? 'grabbing' : '';
    return () => {
      document.body.style.cursor = '';
    };
  }, [drag !== null]);

  const beginPointer = (
    e: React.PointerEvent<HTMLElement>,
    payload: DragPayload,
    onClick?: () => void
  ) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('input, [data-no-drag]')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    pendingRef.current = {
      payload,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      width: rect.width,
      onClick,
    };
  };

  const startStackDrag = (
    e: React.PointerEvent<HTMLElement>,
    routine: RobotRoutine,
    blockId: string
  ) => {
    e.stopPropagation();
    const idx = routine.blocks.findIndex((b) => b.id === blockId);
    // Scratch behaviour: grabbing a block takes every block below it too
    const blockIds = routine.blocks.slice(idx).map((b) => b.id);
    beginPointer(e, { kind: 'stack', routineId: routine.id, blockIds });
  };

  const startPaletteHatDrag = (e: React.PointerEvent<HTMLElement>, robotId: number) => {
    const existing = strategy.routines.find(
      (r) => r.robotId === robotId && r.situationId === strategy.activeSituationId
    );
    beginPointer(
      e,
      existing
        ? { kind: 'routine', routineId: existing.id, fromPalette: true }
        : { kind: 'new-hat', robotId },
      () => handleAddRobotHat(robotId)
    );
  };

  /* ---------------- zone drawing ---------------- */

  const fieldRef = useRef<HTMLDivElement>(null); // exact field rectangle (dot lattice frame)
  const pathRef = useRef<Pt[] | null>(null);
  const closedRef = useRef(false);
  const zoneModeRef = useRef<ZoneMode>('replace');
  const [drawPath, setDrawPath] = useState<Pt[] | null>(null);
  const [drawClosed, setDrawClosed] = useState(false);

  const commitDots = (dots: string[]) => {
    const cols = dots.map((d) => parseInt(d.split(',')[0], 10));
    const rows = dots.map((d) => parseInt(d.split(',')[1], 10));
    onUpdateStrategy({
      ...strategy,
      situations: strategy.situations.map((sit) =>
        sit.id === activeSituation.id
          ? {
              ...sit,
              selectedDots: dots,
              minCol: cols.length ? Math.min(...cols) : 0,
              maxCol: cols.length ? Math.max(...cols) : 0,
              minRow: rows.length ? Math.min(...rows) : 0,
              maxRow: rows.length ? Math.max(...rows) : 0,
            }
          : sit
      ),
    });
  };

  const toggleDot = (col: number, row: number) => {
    const key = `${col},${row}`;
    const current = activeSituation.selectedDots;
    commitDots(current.includes(key) ? current.filter((d) => d !== key) : [...current, key]);
  };

  const mergeZone = (drawn: Set<string>, mode: ZoneMode): Set<string> => {
    const current = new Set(activeSituation.selectedDots);
    if (mode === 'replace') return drawn;
    if (mode === 'add') return new Set([...current, ...drawn]);
    return new Set([...current].filter((k) => !drawn.has(k)));
  };

  /** Nearest lattice dot to the pointer (works slightly outside the field too, for edge dots). */
  const dotAt = (e: React.PointerEvent): Pt | null => {
    const el = fieldRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const c = Math.round(((e.clientX - r.left) / r.width) * gridDims.cols);
    const row = Math.round(((e.clientY - r.top) / r.height) * gridDims.rows);
    return [
      Math.max(0, Math.min(gridDims.cols, c)),
      Math.max(0, Math.min(gridDims.rows, row)),
    ];
  };

  const handleGridPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const d = dotAt(e);
    if (!d) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    zoneModeRef.current = e.altKey ? 'erase' : e.shiftKey ? 'add' : 'replace';
    pathRef.current = [d];
    closedRef.current = false;
    setDrawPath([d]);
    setDrawClosed(false);
  };

  const handleGridPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const path = pathRef.current;
    if (!path || closedRef.current) return;
    const d = dotAt(e);
    if (!d) return;
    const last = path[path.length - 1];
    if (samePt(d, last)) return;

    const next = [...path];
    for (const p of rasterLine(last, d).slice(1)) {
      if (samePt(p, next[0])) {
        if (next.length >= 3) {
          closedRef.current = true; // loop enclosed → zone done
          break;
        }
        continue; // too short to be a shape, ignore touching start
      }
      next.push(p);
    }
    pathRef.current = next;
    setDrawPath(next);
    setDrawClosed(closedRef.current);
  };

  const handleGridPointerUp = () => {
    const path = pathRef.current;
    if (!path) return;
    pathRef.current = null;
    setDrawPath(null);
    setDrawClosed(false);

    if (path.length === 1) {
      toggleDot(path[0][0], path[0][1]); // plain click
      return;
    }
    // Auto-close on release if it's at least a triangle
    const closed = closedRef.current || path.length >= 3;
    const drawn = enclosedDots(path, ptCols, ptRows, closed);
    commitDots([...mergeZone(drawn, zoneModeRef.current)]);
  };

  // Live preview while drawing
  const previewDots = drawPath
    ? mergeZone(
        enclosedDots(drawPath, ptCols, ptRows, drawClosed || drawPath.length >= 3),
        zoneModeRef.current
      )
    : null;
  const pathKeys = new Set(drawPath?.map(keyOf) ?? []);

  // Real zone outlines (traced shapes) for every zone; the active one uses the live preview
  const shownDots = previewDots ?? new Set(activeSituation.selectedDots);
  const zoneShapes = strategy.situations.map((sit) => {
    const isActive = sit.id === activeSituation.id;
    return {
      sit,
      isActive,
      color: colorFor(sit.id),
      path: zonePathFor(
        isActive ? shownDots : new Set(sit.selectedDots),
        gridDims.cols,
        gridDims.rows
      ),
    };
  });
  // Inactive zones draw first so the active zone sits on top
  const orderedShapes = [
    ...zoneShapes.filter((z) => !z.isActive),
    ...zoneShapes.filter((z) => z.isActive),
  ];

  // Colour for dots that belong to other (inactive) zones
  const otherDotColor = new Map<string, string>();
  zoneShapes.forEach((z) => {
    if (z.isActive) return;
    z.sit.selectedDots.forEach((k) => {
      if (!otherDotColor.has(k)) otherDotColor.set(k, z.color);
    });
  });

  /* ---------------- click-to-add (still supported) ---------------- */

  const handleAddBlockToRobot = (type: BlockType, targetRobotId: number = selectedRobotForAdd) => {
    const newBlock = createBlock(type);
    const existing = strategy.routines.find(
      (r) => r.robotId === targetRobotId && r.situationId === strategy.activeSituationId
    );

    const updatedRoutines: RobotRoutine[] = existing
      ? strategy.routines.map((r) =>
          r.id === existing.id ? { ...r, blocks: [...r.blocks, newBlock] } : r
        )
      : [
          ...strategy.routines,
          {
            id: newId(`routine_r${targetRobotId}`),
            robotId: targetRobotId,
            situationId: strategy.activeSituationId,
            blocks: [newBlock],
          },
        ];

    onUpdateStrategy({ ...strategy, routines: updatedRoutines });
  };

  const handleAddRobotHat = (robotId: number) => {
    setSelectedRobotForAdd(robotId);
    const existing = strategy.routines.find(
      (r) => r.robotId === robotId && r.situationId === strategy.activeSituationId
    );
    if (!existing) {
      onUpdateStrategy({
        ...strategy,
        routines: [
          ...strategy.routines,
          {
            id: newId(`routine_r${robotId}`),
            robotId,
            situationId: strategy.activeSituationId,
            blocks: [],
          },
        ],
      });
    }
  };

  const handleDeleteRoutine = (routineId: string) => {
    onUpdateStrategy({
      ...strategy,
      routines: strategy.routines.filter((r) => r.id !== routineId),
    });
  };

  const handleDeleteBlock = (routineId: string, blockId: string) => {
    onUpdateStrategy({
      ...strategy,
      routines: strategy.routines.map((r) =>
        r.id === routineId ? { ...r, blocks: r.blocks.filter((b) => b.id !== blockId) } : r
      ),
    });
  };

  const handleUpdateParam = (
    routineId: string,
    blockId: string,
    paramKey: string,
    value: string
  ) => {
    onUpdateStrategy({
      ...strategy,
      routines: strategy.routines.map((r) =>
        r.id !== routineId
          ? r
          : {
              ...r,
              blocks: r.blocks.map((b) =>
                b.id !== blockId ? b : { ...b, params: { ...b.params, [paramKey]: value } }
              ),
            }
      ),
    });
  };

  const handleResetWorkspace = () => {
    onUpdateStrategy({
      ...strategy,
      routines: strategy.routines.filter((r) => r.situationId !== activeSituation.id),
    });
  };

  const handleChangePriority = (
    p: 'Low Priority' | 'Medium Priority' | 'High Priority' | 'Critical'
  ) => {
    onUpdateStrategy({
      ...strategy,
      situations: strategy.situations.map((s) =>
        s.id === activeSituation.id ? { ...s, priority: p } : s
      ),
    });
  };

  const handleResolutionSlider = (val: number) => {
    setSliderVal(val);
    const res = val === 0 ? 'Coarse (8x6)' : val === 2 ? 'Fine (16x12)' : 'Medium (12x9)';
    onUpdateStrategy({ ...strategy, resolution: res });
  };

  const activeRoutines = strategy.routines.filter((r) => r.situationId === activeSituation.id);
  const totalBlocks = activeRoutines.reduce((acc, r) => acc + r.blocks.length, 0);

  /* ---------------- render helpers ---------------- */

  const hiddenRoutineId =
    drag?.payload.kind === 'routine' ? drag.payload.routineId : null;
  const hiddenBlockIds = new Set(drag?.payload.kind === 'stack' ? drag.payload.blockIds : []);
  const draggingFromWorkspace =
    drag !== null &&
    (drag.payload.kind === 'stack' ||
      (drag.payload.kind === 'routine' && !drag.payload.fromPalette));

  const movingBlockCount =
    drag?.payload.kind === 'stack' ? drag.payload.blockIds.length : 1;

  const blockPlaceholder = (
    <div
      key="__block_placeholder"
      className="bg-[#8E95A5]/20 border border-dashed border-[#8E95A5]/60"
      style={{ height: Math.min(movingBlockCount, 4) * 36 }}
    />
  );

  const routinePlaceholder = (
    <div
      key="__routine_placeholder"
      className="h-12 mb-5 bg-[#d97706]/15 border border-dashed border-[#fabc4d]/60"
    />
  );

  const visibleRoutines = activeRoutines.filter((r) => r.id !== hiddenRoutineId);

  const renderRoutine = (routine: RobotRoutine) => {
    const isSelectedRobot = selectedRobotForAdd === routine.robotId;
    const visibleBlocks = routine.blocks.filter((b) => !hiddenBlockIds.has(b.id));
    const showHere = hint?.kind === 'blocks' && hint.routineId === routine.id;

    const blockNodes: React.ReactNode[] = [];
    visibleBlocks.forEach((block, i) => {
      if (showHere && hint.index === i) blockNodes.push(blockPlaceholder);
      blockNodes.push(
        <BlockView
          key={block.id}
          block={block}
          onPointerDown={(e) => startStackDrag(e, routine, block.id)}
          onParamChange={(key, value) => handleUpdateParam(routine.id, block.id, key, value)}
          onDelete={() => handleDeleteBlock(routine.id, block.id)}
        />
      );
    });
    if (showHere && hint.index === visibleBlocks.length) blockNodes.push(blockPlaceholder);

    return (
      <div
        key={routine.id}
        data-routine-id={routine.id}
        onClick={() => setSelectedRobotForAdd(routine.robotId)}
        className="pb-5"
      >
        <div
          className={`flex flex-col transition-all duration-150 ${
            isSelectedRobot ? 'ring-1 ring-[#fabc4d]/40' : ''
          }`}
        >
          <HatView
            robotId={routine.robotId}
            situationName={situationNameFor(routine.situationId)}
            onPointerDown={(e) => beginPointer(e, { kind: 'routine', routineId: routine.id })}
            onDelete={() => handleDeleteRoutine(routine.id)}
          />
          <div className="flex flex-col space-y-1 mt-1 pl-3 border-l-2 border-[#fabc4d]/30 min-h-[8px]">
            {blockNodes}
          </div>
        </div>
      </div>
    );
  };

  const routineNodes: React.ReactNode[] = [];
  visibleRoutines.forEach((routine, i) => {
    if (hint?.kind === 'routines' && hint.index === i) routineNodes.push(routinePlaceholder);
    routineNodes.push(renderRoutine(routine));
  });
  if (hint?.kind === 'routines' && hint.index === visibleRoutines.length)
    routineNodes.push(routinePlaceholder);

  const renderGhost = () => {
    if (!drag) return null;
    const p = drag.payload;
    let content: React.ReactNode = null;

    if (p.kind === 'new-block') {
      content = <BlockView ghost block={createBlock(p.blockType)} />;
    } else if (p.kind === 'stack') {
      const src = strategy.routines.find((r) => r.id === p.routineId);
      content = (
        <div className="flex flex-col space-y-1">
          {src?.blocks
            .filter((b) => p.blockIds.includes(b.id))
            .map((b) => <BlockView key={b.id} ghost block={b} />)}
        </div>
      );
    } else if (p.kind === 'new-hat') {
      content = <HatView ghost robotId={p.robotId} situationName={activeSituation.name} />;
    } else {
      const r = strategy.routines.find((x) => x.id === p.routineId);
      if (r) {
        content = (
          <div className="flex flex-col">
            <HatView ghost robotId={r.robotId} situationName={situationNameFor(r.situationId)} />
            {r.blocks.length > 0 && (
              <div className="flex flex-col space-y-1 mt-1 pl-3 border-l-2 border-[#fabc4d]/30">
                {r.blocks.map((b) => (
                  <BlockView key={b.id} ghost block={b} />
                ))}
              </div>
            )}
          </div>
        );
      }
    }

    return (
      <div
        className="fixed z-[100] pointer-events-none transition-opacity duration-100"
        style={{
          left: drag.x - drag.offsetX,
          top: drag.y - drag.offsetY,
          width: drag.width,
          opacity: hint?.kind === 'delete' ? 0.4 : 0.92,
          filter: 'drop-shadow(0 10px 18px rgba(0,0,0,0.55))',
        }}
      >
        {content}
      </div>
    );
  };

  /* ---------------- render ---------------- */

  return (
    <div className="flex-1 flex flex-col w-full bg-[#0F1115] text-[#e2e2e8] overflow-hidden select-none">
      {/* Subheader Action Bar */}
      <div className="h-12 border-b border-[#2D3139] bg-[#181A1E] px-4 md:px-6 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={onSaveStrategy}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[#fabc4d] hover:bg-[#ffc665] text-[#111317] text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer"
          >
            <Save className="w-3.5 h-3.5 fill-[#111317]" />
            <span>SAVE</span>
          </button>

          <button
            onClick={onSaveAsStrategy}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1e2024] border border-[#2D3139] hover:border-[#fabc4d] text-[#e2e2e8] text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>SAVE AS</span>
          </button>

          <button
            onClick={onImportStrategy}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1e2024] border border-[#2D3139] hover:border-[#fabc4d] text-[#e2e2e8] text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>IMPORT</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-[#8E95A5] uppercase tracking-wider">
            ACTIVE STRATEGY:
          </span>
          <div className="px-3 py-1 bg-[#0F1115] border border-[#2D3139] text-[#fabc4d] text-xs font-mono font-bold tracking-wide">
            {strategy.filename}
          </div>
        </div>
      </div>

      {/* 3-Column Workspace Layout */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-0 overflow-hidden">
        {/* COLUMN 1: SOCCER FIELD */}
        <div className="lg:col-span-4 border-r border-[#2D3139] bg-[#181A1E] flex flex-col p-4 overflow-y-auto">
          <div className="flex items-center justify-between pb-3 border-b border-[#2D3139]">
            <div className="flex items-center gap-2">
              <Hexagon className="w-4 h-4 text-[#fabc4d]" />
              <span className="text-xs font-bold uppercase tracking-wider text-white">
                SOCCER FIELD
              </span>
            </div>
            <div className="text-xs font-bold tracking-wide" style={{ color: activeColor }}>
              Zone: {activeSituation.name}
            </div>
          </div>

          <div className="mt-3 relative bg-[#131B18] border border-[#2D3139] aspect-4/3 w-full overflow-hidden">
            <svg
              viewBox="0 0 400 300"
              className="absolute inset-0 w-full h-full stroke-[#1E3F30] stroke-[1.2] fill-none pointer-events-none"
            >
              <rect x="20" y="20" width="360" height="260" />
              <line x1="200" y1="20" x2="200" y2="280" />
              <circle cx="200" cy="150" r="45" />
              <circle cx="200" cy="150" r="2" fill="#1E3F30" />
              <rect x="20" y="70" width="65" height="160" />
              <rect x="20" y="105" width="25" height="90" />
              <path d="M 85 115 A 40 40 0 0 1 85 185" />
              <rect x="8" y="115" width="12" height="70" stroke="#2D3139" />
              <rect x="315" y="70" width="65" height="160" />
              <rect x="355" y="105" width="25" height="90" />
              <path d="M 315 115 A 40 40 0 0 0 315 185" />
              <rect x="380" y="115" width="12" height="70" stroke="#2D3139" />
            </svg>

            {/* Interaction layer covers the whole card so edge dots are easy to hit */}
            <div
              onPointerDown={handleGridPointerDown}
              onPointerMove={handleGridPointerMove}
              onPointerUp={handleGridPointerUp}
              onPointerCancel={handleGridPointerUp}
              className="absolute inset-0 z-10 cursor-crosshair touch-none"
            >
              {/* Exact field rectangle: dot (0,0) = top-left corner, (cols,rows) = bottom-right */}
              <div
                ref={fieldRef}
                className="absolute"
                style={{
                  left: `${FIELD_INSET_X}%`,
                  right: `${FIELD_INSET_X}%`,
                  top: `${FIELD_INSET_Y}%`,
                  bottom: `${FIELD_INSET_Y}%`,
                }}
              >
                {/* Traced zone shapes — every zone stays on the grid */}
                <svg
                  viewBox={`0 0 ${gridDims.cols} ${gridDims.rows}`}
                  preserveAspectRatio="none"
                  className="absolute inset-0 w-full h-full overflow-visible pointer-events-none"
                >
                  {orderedShapes.map(
                    (z) =>
                      z.path && (
                        <path
                          key={z.sit.id}
                          d={z.path}
                          fill={z.color}
                          fillOpacity={z.isActive ? 0.12 : 0.06}
                          fillRule="nonzero"
                          stroke={z.color}
                          strokeOpacity={z.isActive ? (previewDots ? 0.6 : 1) : 0.45}
                          strokeWidth={z.isActive ? 2 : 1.5}
                          strokeDasharray={z.isActive ? '6 4' : '3 4'}
                          strokeLinejoin="round"
                          vectorEffect="non-scaling-stroke"
                        />
                      )
                  )}
                </svg>

                {/* Dot lattice — includes the field boundary and halfway line */}
                {Array.from({ length: ptRows }).map((_, r) =>
                  Array.from({ length: ptCols }).map((_, c) => {
                    const key = `${c},${r}`;
                    const isSelected = shownDots.has(key);
                    const onPath = pathKeys.has(key);
                    const otherColor = otherDotColor.get(key);
                    const dotStyle: React.CSSProperties | undefined = onPath
                      ? undefined
                      : isSelected
                      ? { backgroundColor: activeColor, boxShadow: `0 0 6px ${activeColor}` }
                      : otherColor
                      ? { backgroundColor: otherColor, opacity: 0.55 }
                      : undefined;
                    return (
                      <div
                        key={key}
                        className="absolute w-3 h-3 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center group"
                        style={{
                          left: `${(c / gridDims.cols) * 100}%`,
                          top: `${(r / gridDims.rows) * 100}%`,
                        }}
                        title={`Grid Coordinate: [${c}, ${r}]`}
                      >
                        <div
                          style={dotStyle}
                          className={`w-1.5 h-1.5 transition-all duration-100 ${
                            onPath
                              ? 'bg-white shadow-[0_0_6px_#ffffff] scale-150'
                              : isSelected
                              ? `scale-125 ${previewDots ? 'opacity-70' : ''}`
                              : otherColor
                              ? ''
                              : 'bg-[#2D3139] group-hover:bg-[#8E95A5]'
                          }`}
                        />
                      </div>
                    );
                  })
                )}

                {/* Live outline while drawing */}
                {drawPath && drawPath.length > 1 && (
                  <svg
                    viewBox={`0 0 ${gridDims.cols} ${gridDims.rows}`}
                    preserveAspectRatio="none"
                    className="absolute inset-0 w-full h-full overflow-visible pointer-events-none"
                  >
                    <polyline
                      points={drawPath.map(([c, r]) => `${c},${r}`).join(' ')}
                      fill="none"
                      stroke="#ffffff"
                      strokeOpacity={0.85}
                      strokeWidth={1.5}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                    {!drawClosed && drawPath.length >= 3 && (
                      <line
                        x1={drawPath[drawPath.length - 1][0]}
                        y1={drawPath[drawPath.length - 1][1]}
                        x2={drawPath[0][0]}
                        y2={drawPath[0][1]}
                        stroke="#ffffff"
                        strokeOpacity={0.4}
                        strokeWidth={1.5}
                        strokeDasharray="4 4"
                        vectorEffect="non-scaling-stroke"
                      />
                    )}
                  </svg>
                )}

                {/* Zone labels anchored at each shape's top-left — click one to select that zone */}
                {!drawPath &&
                  orderedShapes.map(
                    ({ sit, color, isActive }) =>
                      sit.selectedDots.length > 0 && (
                        <div
                          key={sit.id}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            handleSelectZone(sit.id);
                          }}
                          className={`absolute flex items-center gap-1.5 text-[10px] font-bold bg-[#0F1115]/90 px-1.5 py-0.5 border whitespace-nowrap cursor-pointer ${
                            isActive ? 'z-30' : 'z-20 opacity-70 hover:opacity-100'
                          }`}
                          style={{
                            color,
                            borderColor: isActive ? color : `${color}80`,
                            left: `${(sit.minCol / gridDims.cols) * 100}%`,
                            top: `${(sit.minRow / gridDims.rows) * 100}%`,
                            transform: 'translate(-4px, calc(-100% - 6px))',
                          }}
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ backgroundColor: color }}
                          />
                          <span>{sit.name}</span>
                        </div>
                      )
                  )}
              </div>
            </div>

            <div
              className="absolute z-20 flex flex-col items-center pointer-events-none transition-all duration-300"
              style={{ left: '42%', top: '46%' }}
            >
              <div className="w-4 h-4 rounded-full border-2 border-[#fabc4d] bg-white flex items-center justify-center shadow-[0_0_8px_#fabc4d]">
                <div className="w-1 h-1 bg-[#111317] rounded-full" />
              </div>
              <span className="text-[9px] font-bold text-white tracking-tight mt-0.5 bg-[#111317]/80 px-1">
                Ball
              </span>
            </div>

            <div
              className="absolute z-20 flex items-center gap-1 pointer-events-none transition-all duration-300"
              style={{ left: '38%', top: '68%' }}
            >
              <div className="w-4 h-4 bg-[#fabc4d] text-[#111317] font-bold text-[9px] flex items-center justify-center rounded-full shadow-xs">
                1
              </div>
              <span className="text-[9px] font-bold text-[#fabc4d] bg-[#111317]/80 px-1">
                Robot #1
              </span>
            </div>
          </div>

          {/* Zone list */}
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-[#8E95A5] uppercase tracking-wider">
                ZONES ({strategy.situations.length})
              </span>
              <button
                onClick={handleAddZone}
                className="flex items-center gap-1 px-2.5 py-1 bg-[#1e2024] border border-[#2D3139] hover:border-[#fabc4d] text-[#fabc4d] text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                <span>NEW ZONE</span>
              </button>
            </div>
            <div className="space-y-1">
              {strategy.situations.map((sit) => {
                const isActive = sit.id === activeSituation.id;
                const color = colorFor(sit.id);
                const robots = strategy.routines.filter((r) => r.situationId === sit.id).length;
                return (
                  <div
                    key={sit.id}
                    onClick={() => handleSelectZone(sit.id)}
                    className={`flex items-center gap-2 px-2 py-1.5 border cursor-pointer transition-colors ${
                      isActive
                        ? 'bg-[#22252A]'
                        : 'bg-[#0F1115] border-[#2D3139] hover:bg-[#1e2024]'
                    }`}
                    style={isActive ? { borderColor: color } : undefined}
                  >
                    <span className="w-2.5 h-2.5 shrink-0" style={{ backgroundColor: color }} />
                    {isActive ? (
                      <input
                        type="text"
                        value={sit.name}
                        onChange={(e) => handleRenameZone(sit.id, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-1 min-w-0 bg-transparent text-xs font-bold font-mono focus:outline-hidden select-text"
                        style={{ color }}
                      />
                    ) : (
                      <span className="flex-1 min-w-0 truncate text-xs font-bold text-[#e2e2e8]">
                        {sit.name}
                      </span>
                    )}
                    <span className="text-[10px] font-mono text-[#8E95A5] shrink-0">
                      {sit.selectedDots.length} dots · {robots} bots
                    </span>
                    {strategy.situations.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteZone(sit.id);
                        }}
                        className="text-[#8E95A5] hover:text-red-400 p-0.5 shrink-0"
                        title="Delete zone and its robot stacks"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-4 space-y-3">
            <div>
              <div className="flex items-center justify-between text-xs font-bold mb-1">
                <span className="text-[#8E95A5] uppercase tracking-wider">RESOLUTION</span>
                <span className="text-[#fabc4d]">{strategy.resolution}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-[#8E95A5]">Coarse</span>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="1"
                  value={sliderVal}
                  onChange={(e) => handleResolutionSlider(parseInt(e.target.value, 10))}
                  className="w-full accent-[#fabc4d] h-1.5 bg-[#2D3139] cursor-pointer"
                />
                <span className="text-[10px] text-[#8E95A5]">Fine</span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-xs font-bold text-[#8E95A5] uppercase tracking-wider">
                PRIORITY
              </span>
              <div className="relative">
                <select
                  value={activeSituation.priority}
                  onChange={(e) =>
                    handleChangePriority(
                      e.target.value as
                        | 'Low Priority'
                        | 'Medium Priority'
                        | 'High Priority'
                        | 'Critical'
                    )
                  }
                  className="bg-[#0F1115] border border-[#2D3139] px-3 py-1.5 text-xs text-white font-mono focus:border-[#fabc4d] focus:outline-hidden pr-7 appearance-none cursor-pointer"
                >
                  <option value="Low Priority">Low Priority</option>
                  <option value="Medium Priority">Medium Priority</option>
                  <option value="High Priority">High Priority</option>
                  <option value="Critical">Critical</option>
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-[#8E95A5] absolute right-2 top-2.5 pointer-events-none" />
              </div>
            </div>
          </div>

          <div className="mt-auto pt-4">
            <div className="p-3 bg-[#1e2024] border border-[#2D3139] flex items-start gap-2 text-[11px] text-[#8E95A5] leading-relaxed">
              <Info className="w-4 h-4 text-[#fabc4d] shrink-0 mt-0.5" />
              <span>
                <strong className="text-white">How to use:</strong> Click dots to toggle them, or
                drag to trace the outline of{' '}
                <span className="text-[#fabc4d] font-bold">{activeSituation.name}</span> (hold
                Shift to add, Alt to erase). Drag blocks from the palette into a robot stack, drag
                them around to reorder, and drop them back on the palette to delete.
              </span>
            </div>
          </div>
        </div>

        {/* COLUMN 2: SCRIPT WORKSPACE */}
        <div
          ref={workspaceRef}
          className="lg:col-span-5 border-r border-[#2D3139] bg-[#0F1115] flex flex-col p-4 overflow-y-auto"
        >
          <div className="flex items-center justify-between pb-3 border-b border-[#2D3139]">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#fabc4d]" />
              <span className="text-xs font-bold uppercase tracking-wider text-white">
                SCRIPT WORKSPACE
              </span>
            </div>
            <button
              onClick={handleResetWorkspace}
              className="flex items-center gap-1 px-2.5 py-1 bg-[#1e2024] hover:bg-[#282a2e] border border-[#2D3139] hover:border-red-500/50 text-[#8E95A5] hover:text-red-400 text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>RESET</span>
            </button>
          </div>

          <div className="flex items-center justify-between py-2.5 text-xs border-b border-[#2D3139]/50">
            <div className="flex items-center gap-2">
              <span className="text-[#8E95A5] font-bold uppercase tracking-wider text-[11px]">
                ACTIVE CONTEXT:
              </span>
              <div className="px-2 py-0.5 bg-[#22252A] border border-[#fabc4d]/60 text-[#fabc4d] font-bold text-xs">
                {activeSituation.name}
              </div>
            </div>
            <div className="text-[11px] font-mono text-[#8E95A5]">
              ACTIVE ROBOTS:{' '}
              <span className="text-white font-bold">
                {activeRoutines.length} CONFIGURED ({totalBlocks} BLOCKS)
              </span>
            </div>
          </div>

          {/* Drop canvas */}
          <div data-canvas className="flex-1 mt-4 flex flex-col min-h-[16rem]">
            {routineNodes.length === 0 ? (
              <div className="h-64 border border-dashed border-[#2D3139] flex flex-col items-center justify-center text-center p-6 text-[#8E95A5]">
                <Bot className="w-8 h-8 text-[#8E95A5]/50 mb-2" />
                <p className="text-xs">No robot routine stacks configured yet.</p>
                <p className="text-[11px] text-[#8E95A5]/70 mt-1">
                  Drag a <strong className="text-[#fabc4d]">Robot Hat</strong> from the palette
                  onto this canvas to start programming!
                </p>
              </div>
            ) : (
              routineNodes
            )}

            <div className="flex-1 min-h-[3rem] text-center py-4 text-[11px] font-mono text-[#8E95A5]/60 border-t border-[#2D3139]/40">
              + Drag blocks from the palette and snap them under a robot hat.
            </div>
          </div>
        </div>

        {/* COLUMN 3: BLOCKS PALETTE (also the delete zone) */}
        <div
          data-palette
          className="relative lg:col-span-3 bg-[#181A1E] flex flex-col p-4 overflow-y-auto"
        >
          {draggingFromWorkspace && (
            <div
              className={`absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 pointer-events-none transition-colors ${
                hint?.kind === 'delete'
                  ? 'bg-red-950/70 border-2 border-red-500'
                  : 'bg-[#0F1115]/60 border-2 border-dashed border-red-500/40'
              }`}
            >
              <Trash2
                className={`w-8 h-8 ${hint?.kind === 'delete' ? 'text-red-400' : 'text-red-400/60'}`}
              />
              <span className="text-xs font-bold uppercase tracking-wider text-red-300">
                Drop here to delete
              </span>
            </div>
          )}

          <div className="flex items-center justify-between pb-3 border-b border-[#2D3139]">
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-[#fabc4d]" />
              <span className="text-xs font-bold uppercase tracking-wider text-white">
                BLOCKS PALETTE
              </span>
            </div>
            <span className="text-[10px] font-bold tracking-widest text-[#8E95A5] uppercase font-mono">
              SCRATCH STYLE
            </span>
          </div>

          <div className="mt-4 space-y-6">
            {/* ROBOT START BLOCKS (HAT) */}
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#fabc4d] uppercase tracking-wider">
                  ● ROBOT START BLOCKS
                </span>
                <span className="text-[10px] text-[#8E95A5] font-mono">HAT</span>
              </div>
              <p className="text-[10px] text-[#8E95A5] mt-0.5 mb-2 leading-tight">
                Drag onto the canvas (or click) to start a robot routine:
              </p>

              <div className="grid grid-cols-2 gap-2">
                {[1, 2, 3, 4, 5].map((id) => (
                  <div
                    key={id}
                    role="button"
                    tabIndex={0}
                    onPointerDown={(e) => startPaletteHatDrag(e, id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') handleAddRobotHat(id);
                    }}
                    className={`${
                      id === 5 ? 'col-span-2 px-3' : 'px-2.5'
                    } flex items-center justify-between py-1.5 bg-[#d97706] hover:bg-[#b45309] text-white text-xs font-bold tracking-wide transition-colors cursor-grab active:cursor-grabbing touch-none`}
                  >
                    <div className="flex items-center gap-1.5">
                      <Bot className="w-3.5 h-3.5" />
                      <span>Robot {id}</span>
                    </div>
                    {id === 5 ? <span>+ Add Hat</span> : <Plus className="w-3.5 h-3.5" />}
                  </div>
                ))}
              </div>
            </div>

            {/* ACTION BLOCKS */}
            {PALETTE_GROUPS.map((group) => (
              <div key={group.title}>
                <div className={`text-xs font-bold ${group.color} uppercase tracking-wider mb-2`}>
                  {group.title}
                </div>
                <div className="space-y-2">
                  {group.types.map((type) => {
                    const def = BLOCK_DEFS[type];
                    const Icon = def.icon;
                    return (
                      <div
                        key={type}
                        role="button"
                        tabIndex={0}
                        onPointerDown={(e) =>
                          beginPointer(e, { kind: 'new-block', blockType: type }, () =>
                            handleAddBlockToRobot(type)
                          )
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') handleAddBlockToRobot(type);
                        }}
                        className={`w-full flex items-center justify-between px-3 py-2 ${def.bg} ${def.hover} text-white text-xs font-bold transition-colors cursor-grab active:cursor-grabbing touch-none`}
                      >
                        <div className="flex items-center gap-2">
                          <Icon className={`w-3.5 h-3.5 ${def.iconClass ?? ''}`} />
                          <span>
                            {def.label}{' '}
                            <span className="font-normal text-[11px] opacity-80">
                              {def.fields.map((f) => f.label).join(', ')}
                            </span>
                          </span>
                        </div>
                        <Plus className="w-3.5 h-3.5" />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Floating drag ghost */}
      {renderGhost()}
    </div>
  );
};
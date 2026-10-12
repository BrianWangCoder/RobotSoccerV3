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
  ChevronDown,
  Layers,
  Bot,
  Hexagon,
  Trash2,
  Box,
  Eye,
  ChevronLeft,
  ChevronRight,
  Crosshair,
} from 'lucide-react';
import {
  StrategyConfig,
  ScriptBlock,
  RobotRoutine,
  BlockType,
} from '../types/strategy';
import { BlockPreview, PreviewSpec } from './BlockPreview';
import { parsePoint, parseNum, NAMED_SPOTS, FIELD } from '../sim/engine';
import { PitchLines, PITCH_VIEWBOX } from './PitchLines';
import {
  Pt,
  ZoneMode,
  ZONE_COLORS,
  keyOf,
  samePt,
  enclosedDots,
  gridDimsFor,
  RESOLUTIONS,
  ZoneShape,
  shapeFromPath,
  mergeShapes,
  shapeOfSituation,
  shapePath,
  dotsInShape,
  shapeCentroid,
  simplifyPath,
} from '../utils/zones';

/* ------------------------------------------------------------------ */
/* Block definitions (single source of truth for palette + workspace) */
/* ------------------------------------------------------------------ */

interface FieldDef {
  key: string;
  label: string;
  width: string;
  def: string;
  /** 'stepper' = ◀ value ▶ arrow buttons instead of a text box. */
  kind?: 'text' | 'stepper';
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  /** Older param name to read if this key is missing (keeps old saved strategies working). */
  alias?: string;
}

/** Current value of a field, falling back to its old name, then its default. */
const fieldValue = (params: Record<string, string | undefined>, f: FieldDef) =>
  params[f.key] ?? (f.alias ? params[f.alias] : undefined) ?? f.def;

/** Defender / GoalKeeper: guard a line, clear the ball if it gets within the kick-out range. */
const isRoleType = (t: string) => t === 'defender' || t === 'goalkeeper';

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
    bg: 'bg-[#3d64b0]',
    hover: 'hover:bg-[#35579a]',
    input: 'bg-[#2d4a85]',
    fields: [
      { key: 'start', label: 'Start', width: 'w-16', def: '[0, 0]' },
      { key: 'stop', label: 'Stop', width: 'w-20', def: '[40, -15]' },
      { key: 'speed', label: 'Speed', width: 'w-14', def: '80%' },
    ],
  },
  turn: {
    label: 'Turn',
    category: 'motion',
    icon: RotateCw,
    bg: 'bg-[#3d64b0]',
    hover: 'hover:bg-[#35579a]',
    input: 'bg-[#2d4a85]',
    fields: [
      { key: 'speed', label: 'Speed', width: 'w-16', def: '60°/s' },
      { key: 'angle', label: 'Angle', width: 'w-16', def: '180°' },
    ],
  },
  spin: {
    label: 'Spin',
    category: 'motion',
    icon: RefreshCw,
    bg: 'bg-[#3d64b0]',
    hover: 'hover:bg-[#35579a]',
    input: 'bg-[#2d4a85]',
    fields: [{ key: 'rpm', label: 'Speed [rpm]', width: 'w-16', def: '450' }],
  },
  defender: {
    label: 'Defender',
    category: 'tactical',
    icon: Shield,
    bg: 'bg-[#3f8f5c]',
    hover: 'hover:bg-[#357a4e]',
    input: 'bg-[#357a4e]',
    fields: [
      { key: 'left', label: 'Left', width: 'w-20', def: '[-79, 40]', alias: 'start' },
      { key: 'right', label: 'Right', width: 'w-20', def: '[-79, -40]', alias: 'stop' },
      { key: 'kickout', label: 'Kick-out', width: 'w-10', def: '25', kind: 'stepper', step: 5, min: 0, max: 100, unit: 'cm' },
    ],
  },
  goalkeeper: {
    label: 'GoalKeeper',
    category: 'tactical',
    icon: Activity,
    bg: 'bg-[#3f8f5c]',
    hover: 'hover:bg-[#357a4e]',
    input: 'bg-[#357a4e]',
    fields: [
      { key: 'left', label: 'Left', width: 'w-20', def: '[Post L]', alias: 'start' },
      { key: 'right', label: 'Right', width: 'w-20', def: '[Post R]', alias: 'stop' },
      { key: 'kickout', label: 'Kick-out', width: 'w-10', def: '15', kind: 'stepper', step: 5, min: 0, max: 100, unit: 'cm' },
    ],
  },
  kickA: {
    label: 'KickA',
    category: 'kick',
    icon: Zap,
    bg: 'bg-[#c46a35]',
    hover: 'hover:bg-[#a95b2e]',
    input: 'bg-[#a95b2e]',
    fields: [
      { key: 'threshold', label: 'Align', width: 'w-12', def: '0.85' },
      { key: 'speed', label: 'Speed', width: 'w-14', def: '95%' },
      { key: 'runup', label: 'Run-up', width: 'w-10', def: '25', kind: 'stepper', step: 5, min: 5, max: 60, unit: 'cm' },
    ],
  },
  kickB: {
    label: 'KickB',
    category: 'kick',
    icon: Flame,
    bg: 'bg-[#c46a35]',
    hover: 'hover:bg-[#a95b2e]',
    input: 'bg-[#a95b2e]',
    fields: [
      { key: 'threshold', label: 'Align', width: 'w-12', def: '0.65' },
      { key: 'speed', label: 'Speed', width: 'w-14', def: '75%' },
      { key: 'runup', label: 'Run-up', width: 'w-10', def: '20', kind: 'stepper', step: 5, min: 5, max: 60, unit: 'cm' },
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
  | { kind: 'zone'; zoneId: string } // dropped on a zone in the Zones list → copy into it
  | null;

/**
 * Copy/paste clipboard. Kept at module level so it survives switching screens
 * (e.g. copy here, check something in Simulation, come back and paste).
 */
type Clip =
  | { kind: 'blocks'; blocks: ScriptBlock[] }
  | { kind: 'routine'; robotId: number; blocks: ScriptBlock[] };
let clipboard: Clip | null = null;

/** Deep copy of blocks with fresh ids (so copies are independent of the originals). */
const cloneBlocks = (blocks: ScriptBlock[]): ScriptBlock[] =>
  blocks.map((b) => ({ ...b, id: newId('blk'), params: { ...(b.params as object) } } as ScriptBlock));

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

  const zoneEl = el.closest('[data-zone-drop]') as HTMLElement | null;
  if (zoneEl) {
    const copyable =
      payload.kind === 'stack' || (payload.kind === 'routine' && !payload.fromPalette);
    return copyable ? { kind: 'zone', zoneId: zoneEl.dataset.zoneDrop! } : null;
  }

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
  selected?: boolean;
  onParamChange?: (key: string, value: string) => void;
  onDelete?: () => void;
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
}

const BlockView: React.FC<BlockViewProps> = ({
  block,
  ghost,
  selected,
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
      } ${selected ? 'ring-2 ring-[#38bdf8] ring-offset-1 ring-offset-[#0F1115]' : ''}`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <Icon className={`w-3.5 h-3.5 shrink-0 ${def.iconClass ?? ''}`} />
        <span className="font-bold">{def.label}</span>
        {def.fields.map((f) => {
          const value = fieldValue(params, f);
          if (f.kind === 'stepper') {
            const num = parseFloat(value) || 0;
            const bump = (dir: number) =>
              onParamChange?.(
                f.key,
                String(Math.max(f.min ?? -Infinity, Math.min(f.max ?? Infinity, num + dir * (f.step ?? 1))))
              );
            return (
              <React.Fragment key={f.key}>
                <span className="text-white/80 text-[11px]">{f.label}:</span>
                <span data-no-drag className={`inline-flex items-center ${def.input} font-mono text-[11px]`}>
                  <button
                    data-no-drag
                    type="button"
                    disabled={ghost}
                    onClick={(e) => {
                      e.stopPropagation();
                      bump(-1);
                    }}
                    className="px-1 py-0.5 hover:bg-black/25 cursor-pointer"
                    title={`-${f.step ?? 1} ${f.unit ?? ''}`}
                  >
                    <ChevronLeft className="w-3 h-3" />
                  </button>
                  <span className="min-w-[3.25rem] text-center select-none">
                    {num}
                    {f.unit ? ` ${f.unit}` : ''}
                  </span>
                  <button
                    data-no-drag
                    type="button"
                    disabled={ghost}
                    onClick={(e) => {
                      e.stopPropagation();
                      bump(1);
                    }}
                    className="px-1 py-0.5 hover:bg-black/25 cursor-pointer"
                    title={`+${f.step ?? 1} ${f.unit ?? ''}`}
                  >
                    <ChevronRight className="w-3 h-3" />
                  </button>
                </span>
              </React.Fragment>
            );
          }
          return (
            <React.Fragment key={f.key}>
              <span className="text-white/80 text-[11px]">{f.label}:</span>
              <input
                data-no-drag
                type="text"
                readOnly={ghost}
                value={value}
                onChange={(e) => onParamChange?.(f.key, e.target.value)}
                className={`${f.width} ${def.input} text-center text-white text-[11px] px-1 py-0.5 font-mono focus:outline-hidden cursor-text select-text`}
              />
            </React.Fragment>
          );
        })}
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
  selected?: boolean;
  onDelete?: () => void;
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
}

const HatView: React.FC<HatViewProps> = ({
  robotId,
  situationName,
  ghost,
  selected,
  onDelete,
  onPointerDown,
}) => (
  <div
    onPointerDown={onPointerDown}
    className={`relative bg-[#c08533] hover:bg-[#a5722c] text-white px-3.5 py-2.5 flex items-center justify-between shadow-md ${
      ghost ? '' : 'cursor-grab active:cursor-grabbing touch-none'
    } ${selected ? 'ring-2 ring-[#38bdf8] ring-offset-1 ring-offset-[#0F1115]' : ''}`}
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

/** The pitch card shows the field plus run-off; the dot lattice sits exactly on the field lines. */
const FIELD_INSET_X = ((FIELD.outerX - FIELD.halfX) / (2 * FIELD.outerX)) * 100; // %
const FIELD_INSET_Y = ((FIELD.outerY - FIELD.halfY) / (2 * FIELD.outerY)) * 100; // %

/* ------------------------------------------------------------------ */
/* Main view                                                           */
/* ------------------------------------------------------------------ */

interface StrategyBuilderViewProps {
  strategy: StrategyConfig;
  onUpdateStrategy: (updated: StrategyConfig) => void;
  onSaveStrategy: () => void;
  onSaveAsStrategy: () => void;
  onImportStrategy: () => void;
  /** Jump to the simulator with the current strategy loaded. */
  onTestInSimulation?: () => void;
}

export const StrategyBuilderView: React.FC<StrategyBuilderViewProps> = ({
  strategy,
  onUpdateStrategy,
  onSaveStrategy,
  onSaveAsStrategy,
  onImportStrategy,
  onTestInSimulation,
}) => {
  const activeSituation =
    strategy.situations.find((s) => s.id === strategy.activeSituationId) ||
    strategy.situations[0];

  const situationNameFor = (situationId: string) =>
    strategy.situations.find((s) => s.id === situationId)?.name ?? activeSituation.name;

  type Situation = StrategyConfig['situations'][number];

  const shapeOf = (sit: Situation): ZoneShape =>
    shapeOfSituation(sit, gridDims.cols, gridDims.rows);

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
      selectedShape: [],
      selectedQuarters: undefined,
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
  const gridDims = gridDimsFor(strategy.resolution);
  const ptCols = gridDims.cols + 1;
  const ptRows = gridDims.rows + 1;

  const [selectedRobotForAdd, setSelectedRobotForAdd] = useState<number>(1);

  /* ---------------- live block preview ---------------- */
  // Which stack/block the field animation shows. 'block' = just that block, 'stack' = whole stack.
  const [preview, setPreview] = useState<{
    routineId: string;
    blockId: string | null;
    mode: 'block' | 'stack';
  } | null>(null);
  const [previewReplay, setPreviewReplay] = useState(0);
  const previewRef = useRef(preview);
  previewRef.current = preview;
  const selectedRobotRef = useRef(selectedRobotForAdd);
  selectedRobotRef.current = selectedRobotForAdd;
  // Defender / GoalKeeper block whose range is being edited on the field (left/right click)
  const [editingRangeFor, setEditingRangeFor] = useState<string | null>(null);
  const showBlock = (routineId: string, blockId: string, type?: string) => {
    setPreview({ routineId, blockId, mode: 'block' });
    setEditingRangeFor(type && isRoleType(type) ? blockId : null);
  };
  const showStack = (routineId: string) => {
    setPreview((p) => ({
      routineId,
      blockId: p?.routineId === routineId ? p.blockId : null,
      mode: 'stack',
    }));
    setEditingRangeFor(null);
  };
  const sliderVal = Math.max(
    0,
    RESOLUTIONS.findIndex((r) => r.label === strategy.resolution)
  );

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

  /* ---------------- copy / paste / duplicate ---------------- */

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const flash = (msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2000);
  };

  /**
   * Appends copies of `blocks` to `robotId`'s stack in `zoneId` (creating the stack if needed).
   * Returns the target routine id and the first pasted block id.
   */
  const copyIntoZone = (zoneId: string, robotId: number, blocks: ScriptBlock[]) => {
    const s = strategyRef.current;
    const clones = cloneBlocks(blocks);
    const existing = s.routines.find((r) => r.robotId === robotId && r.situationId === zoneId);
    const routineId = existing?.id ?? newId(`routine_r${robotId}`);
    const routines = existing
      ? s.routines.map((r) => (r.id === existing.id ? { ...r, blocks: [...r.blocks, ...clones] } : r))
      : [...s.routines, { id: routineId, robotId, situationId: zoneId, blocks: clones }];
    commit(routines);
    return { routineId, firstBlockId: clones[0]?.id ?? null };
  };

  /** Inserts copies of `blocks` into an existing routine at `index`. */
  const pasteBlocksAt = (routineId: string, index: number, blocks: ScriptBlock[]) => {
    const s = strategyRef.current;
    const clones = cloneBlocks(blocks);
    commit(
      s.routines.map((r) => {
        if (r.id !== routineId) return r;
        const next = [...r.blocks];
        next.splice(Math.min(index, next.length), 0, ...clones);
        return { ...r, blocks: next };
      })
    );
    return clones[0]?.id ?? null;
  };

  /** What Ctrl+C would copy right now: the selected block, or the whole stack if a hat is selected. */
  const currentSelection = (): Clip | null => {
    const s = strategyRef.current;
    const p = previewRef.current;
    if (!p) return null;
    const routine = s.routines.find((r) => r.id === p.routineId);
    if (!routine) return null;
    if (p.mode === 'stack' || !p.blockId)
      return { kind: 'routine', robotId: routine.robotId, blocks: routine.blocks };
    const blk = routine.blocks.find((b) => b.id === p.blockId);
    return blk ? { kind: 'blocks', blocks: [blk] } : null;
  };

  const doCopy = () => {
    const sel = currentSelection();
    if (!sel) {
      flash('Select a block or click a robot hat first');
      return false;
    }
    clipboard = sel;
    flash(
      sel.kind === 'routine'
        ? `Copied Robot ${sel.robotId} stack (${sel.blocks.length} blocks)`
        : `Copied ${BLOCK_DEFS[sel.blocks[0].type as BlockType]?.label ?? 'block'}`
    );
    return true;
  };

  const doPaste = () => {
    const clip = clipboard;
    if (!clip) {
      flash('Nothing copied yet');
      return;
    }
    const s = strategyRef.current;
    const zoneId = s.activeSituationId;
    const zoneName = s.situations.find((z) => z.id === zoneId)?.name ?? 'zone';

    if (clip.kind === 'routine') {
      // Whole stack → same robot in the zone you're looking at
      const { routineId } = copyIntoZone(zoneId, clip.robotId, clip.blocks);
      showStack(routineId);
      flash(`Pasted Robot ${clip.robotId} stack into ${zoneName}`);
      return;
    }

    // Single block → right after the selected block (or end of the selected stack) in this zone
    const p = previewRef.current;
    const target = p
      ? s.routines.find((r) => r.id === p.routineId && r.situationId === zoneId)
      : undefined;
    if (target) {
      const at =
        p!.mode === 'block' && p!.blockId
          ? target.blocks.findIndex((b) => b.id === p!.blockId) + 1
          : target.blocks.length;
      const id = pasteBlocksAt(target.id, at, clip.blocks);
      if (id) showBlock(target.id, id, clip.blocks[0].type);
      flash(`Pasted into Robot ${target.robotId}`);
      return;
    }
    const robotId = selectedRobotRef.current;
    const { routineId, firstBlockId } = copyIntoZone(zoneId, robotId, clip.blocks);
    if (firstBlockId) showBlock(routineId, firstBlockId, clip.blocks[0].type);
    flash(`Pasted into Robot ${robotId} (${zoneName})`);
  };

  const keyActionsRef = useRef({ doCopy, doPaste });
  keyActionsRef.current = { doCopy, doPaste };

  // Ctrl/Cmd + C / V / D — ignored while typing in a text box
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (window.getSelection()?.toString()) return; // let normal text copy work
      const k = e.key.toLowerCase();
      if (k === 'c') {
        if (keyActionsRef.current.doCopy()) e.preventDefault();
      } else if (k === 'v') {
        e.preventDefault();
        keyActionsRef.current.doPaste();
      } else if (k === 'd') {
        // duplicate in place
        e.preventDefault();
        if (keyActionsRef.current.doCopy()) keyActionsRef.current.doPaste();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** Applies a finished drag to the strategy. */
  const applyDrop = (payload: DragPayload, h: DropHint) => {
    const s = strategyRef.current;
    if (!h) return; // dropped nowhere useful → snaps back

    if (h.kind === 'zone') {
      // COPY (not move) the dragged stack / blocks into that zone
      const src = s.routines.find(
        (r) => r.id === (payload.kind === 'stack' || payload.kind === 'routine' ? payload.routineId : '')
      );
      if (!src) return;
      const blocks =
        payload.kind === 'stack'
          ? src.blocks.filter((b) => payload.blockIds.includes(b.id))
          : src.blocks;
      const zoneName = s.situations.find((z) => z.id === h.zoneId)?.name ?? 'zone';
      copyIntoZone(h.zoneId, src.robotId, blocks);
      flash(`Copied Robot ${src.robotId} ${payload.kind === 'stack' ? `blocks (${blocks.length})` : 'stack'} → ${zoneName}`);
      return;
    }

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
      if (moving.length) showBlock(h.routineId, moving[0].id, moving[0].type);
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
    showStack(moving.id);
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
    beginPointer(e, { kind: 'stack', routineId: routine.id, blockIds }, () =>
      showBlock(routine.id, blockId, routine.blocks.find((b) => b.id === blockId)?.type)
    );
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

  const commitDots = (dots: string[], shape?: ZoneShape) => {
    const cols = dots.map((d) => parseInt(d.split(',')[0], 10));
    const rows = dots.map((d) => parseInt(d.split(',')[1], 10));
    onUpdateStrategy({
      ...strategy,
      situations: strategy.situations.map((sit) =>
        sit.id === activeSituation.id
          ? {
              ...sit,
              selectedDots: dots,
              ...(shape ? { selectedShape: shape, selectedQuarters: undefined } : {}),
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

  const mergeZone = (
    drawn: Set<string>,
    mode: ZoneMode,
    current: Set<string> = new Set(activeSituation.selectedDots)
  ): Set<string> => {
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

  /*
   * One outline is built at a time, and you can mix both ways of making it:
   *  - DRAG: sketch freehand. A drag on its own commits when you let go.
   *  - CLICK: each click places a corner (straight edges between corners). The outline stays
   *    open until you click the first corner again, double-click, press Enter or hit FINISH.
   *  - Once corners are placed, dragging continues the same outline instead of starting a new one.
   * Ctrl/Cmd-click toggles a single dot; Backspace undoes the last point; Esc cancels.
   */
  const cornerModeRef = useRef(false); // outline contains clicked corners → stays open after release
  const keepRef = useRef<Set<number>>(new Set()); // path indices that were clicked (kept exact)
  const downRef = useRef<{ moved: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  const [hoverDot, setHoverDot] = useState<Pt | null>(null);

  const setPath = (p: Pt[] | null) => {
    pathRef.current = p;
    setDrawPath(p);
  };

  const cancelOutline = () => {
    pathRef.current = null;
    cornerModeRef.current = false;
    keepRef.current = new Set();
    downRef.current = null;
    closedRef.current = false;
    setDrawPath(null);
    setPending(false);
    setDrawClosed(false);
  };

  /**
   * Shape + dots the active zone would have after merging an outline. ≥3 points make a
   * polygon (dragged runs are straightened); fewer just add the dots they touch.
   */
  const outlineResult = (path: Pt[], mode: ZoneMode) => {
    if (path.length < 3) {
      return {
        shape: undefined,
        dots: mergeZone(enclosedDots(path, ptCols, ptRows, false), mode),
      };
    }
    const straight = simplifyPath(path, keepRef.current);
    const shape = mergeShapes(
      shapeFromPath(straight, gridDims.cols, gridDims.rows),
      mode,
      shapeOf(activeSituation)
    );
    const inShape = dotsInShape(shape, gridDims.cols, gridDims.rows);
    const current = new Set(activeSituation.selectedDots);
    const dots =
      mode === 'replace'
        ? inShape
        : mode === 'add'
        ? new Set([...current, ...inShape])
        : new Set([...current].filter((k) => inShape.has(k)));
    return { shape, dots };
  };

  /** Fills the outline into the active zone. */
  const finishOutline = (path: Pt[] | null = pathRef.current) => {
    if (!path || !path.length) return cancelOutline();
    const { shape, dots } = outlineResult(path, zoneModeRef.current);
    cancelOutline();
    commitDots([...dots], shape);
  };

  // Keyboard + zone/resolution changes go through refs so listeners never see stale state
  const finishRef = useRef(finishOutline);
  finishRef.current = finishOutline;
  const cancelRef = useRef(cancelOutline);
  cancelRef.current = cancelOutline;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const path = pathRef.current;
      if (!path) return;
      if ((e.target as HTMLElement)?.closest?.('input, select, textarea')) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        finishRef.current();
      } else if (e.key === 'Escape') {
        cancelRef.current();
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        if (path.length <= 1) cancelRef.current();
        else {
          keepRef.current.delete(path.length - 1);
          setPath(path.slice(0, -1));
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Switching zone or resolution abandons a half-drawn outline
  useEffect(() => {
    cancelRef.current();
  }, [activeSituation.id, strategy.resolution]);

  /** Extends the outline toward d; returns true if it looped back onto the start (shape closed). */
  const extendTo = (d: Pt): boolean => {
    const path = pathRef.current;
    if (!path) return false;
    const last = path[path.length - 1];
    if (samePt(d, last)) return false;
    if (samePt(d, path[0])) {
      if (path.length >= 3) {
        finishOutline(path);
        return true;
      }
      return false; // too short to be a shape, ignore touching start
    }
    setPath([...path, d]);
    return false;
  };

  const handleGridPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const d = dotAt(e);
    if (!d) return;

    // Ctrl/Cmd-click: toggle a single dot without touching the outline
    if ((e.ctrlKey || e.metaKey) && !pathRef.current) {
      toggleDot(d[0], d[1]);
      return;
    }

    e.currentTarget.setPointerCapture(e.pointerId);
    downRef.current = { moved: false };

    const path = pathRef.current;
    if (!path) {
      zoneModeRef.current = e.altKey ? 'erase' : e.shiftKey ? 'add' : 'replace';
      keepRef.current = new Set([0]);
      setPath([d]);
      return;
    }

    // Clicking the first corner closes the shape
    if (path.length >= 3 && samePt(d, path[0])) {
      downRef.current = null;
      finishOutline(path);
      return;
    }
    // Otherwise this press adds a corner (straight edge from the previous point)
    if (!samePt(d, path[path.length - 1])) {
      keepRef.current.add(path.length);
      setPath([...path, d]);
    }
  };

  const handleGridPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dotAt(e);
    if (!d) return;
    if (!hoverDot || !samePt(hoverDot, d)) setHoverDot(d);
    if (!downRef.current || !pathRef.current) return;
    const last = pathRef.current[pathRef.current.length - 1];
    if (samePt(d, last)) return;
    downRef.current.moved = true;
    if (extendTo(d)) downRef.current = null; // closed by looping back to the start
  };

  const handleGridPointerUp = () => {
    const down = downRef.current;
    downRef.current = null;
    if (!down || !pathRef.current) return;

    if (cornerModeRef.current) return; // corner outline stays open until closed explicitly

    if (down.moved) {
      finishOutline(); // plain freehand drag → commit on release
    } else {
      cornerModeRef.current = true; // first click → start placing corners
      setPending(true);
    }
  };

  const handleGridPointerCancel = () => {
    downRef.current = null;
    if (!cornerModeRef.current) cancelOutline();
  };

  const handleGridDoubleClick = () => {
    if (cornerModeRef.current && pathRef.current && pathRef.current.length >= 3) finishOutline();
  };

  // Live preview: while placing corners, include a rubber-band edge to the hovered dot
  const previewPath =
    drawPath &&
    pending &&
    hoverDot &&
    !downRef.current &&
    !samePt(hoverDot, drawPath[drawPath.length - 1])
      ? [...drawPath, hoverDot]
      : drawPath;
  const previewResult = previewPath ? outlineResult(previewPath, zoneModeRef.current) : null;
  const previewDots = previewResult?.dots ?? null;
  const previewShape = previewResult?.shape;
  const pathKeys = new Set(drawPath?.map(keyOf) ?? []);
  const canCloseOnStart =
    pending && !!drawPath && drawPath.length >= 3 && !!hoverDot && samePt(hoverDot, drawPath[0]);

  // Real zone outlines (traced shapes) for every zone; the active one uses the live preview
  const shownDots = previewDots ?? new Set(activeSituation.selectedDots);
  const zoneShapes = strategy.situations.map((sit) => {
    const isActive = sit.id === activeSituation.id;
    return {
      sit,
      isActive,
      color: colorFor(sit.id),
      path: shapePath(
        isActive && previewShape ? previewShape : shapeOf(sit),
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
    const target = updatedRoutines.find(
      (r) => r.robotId === targetRobotId && r.situationId === strategy.activeSituationId
    );
    if (target) showBlock(target.id, newBlock.id, type);
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
    // Shapes are resolution-independent; re-pick the dots that fall inside them on the new grid
    const { label, cols, rows } = RESOLUTIONS[val];
    onUpdateStrategy({
      ...strategy,
      resolution: label,
      situations: strategy.situations.map((sit) => {
        const shape = shapeOfSituation(sit, gridDims.cols, gridDims.rows);
        const dots = [...dotsInShape(shape, cols, rows)];
        const cs = dots.map((d) => parseInt(d.split(',')[0], 10));
        const rs = dots.map((d) => parseInt(d.split(',')[1], 10));
        return {
          ...sit,
          selectedShape: shape,
          selectedQuarters: undefined,
          selectedDots: dots,
          minCol: cs.length ? Math.min(...cs) : 0,
          maxCol: cs.length ? Math.max(...cs) : 0,
          minRow: rs.length ? Math.min(...rs) : 0,
          maxRow: rs.length ? Math.max(...rs) : 0,
        };
      }),
    });
  };

  const activeRoutines = strategy.routines.filter((r) => r.situationId === activeSituation.id);

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
      className="h-12 mb-5 w-72 max-w-full bg-[#c08533]/15 border border-dashed border-[#fabc4d]/60"
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
          selected={
            preview?.routineId === routine.id &&
            (preview.mode === 'stack' || preview.blockId === block.id)
          }
          onPointerDown={(e) => startStackDrag(e, routine, block.id)}
          onParamChange={(key, value) => {
            handleUpdateParam(routine.id, block.id, key, value);
            showBlock(routine.id, block.id, block.type);
          }}
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
          className={`w-fit max-w-full flex flex-col transition-all duration-150 ${
            isSelectedRobot ? 'ring-1 ring-[#fabc4d]/40' : ''
          }`}
        >
          <HatView
            robotId={routine.robotId}
            situationName={situationNameFor(routine.situationId)}
            selected={preview?.routineId === routine.id && preview.mode === 'stack'}
            onPointerDown={(e) =>
              beginPointer(e, { kind: 'routine', routineId: routine.id }, () => showStack(routine.id))
            }
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

  /* ---------------- defender / goalkeeper range editing ---------------- */

  const rangeRoutine = editingRangeFor
    ? strategy.routines.find((r) => r.blocks.some((b) => b.id === editingRangeFor))
    : undefined;
  const rangeBlock = rangeRoutine?.blocks.find((b) => b.id === editingRangeFor);
  const rangeEdit =
    rangeRoutine && rangeBlock && isRoleType(rangeBlock.type)
      ? (() => {
          const prm = rangeBlock.params as Record<string, string | undefined>;
          const fields = BLOCK_DEFS[rangeBlock.type as BlockType].fields;
          const val = (k: string) => fieldValue(prm, fields.find((f) => f.key === k)!);
          const isGK = rangeBlock.type === 'goalkeeper';
          return {
            routine: rangeRoutine,
            block: rangeBlock,
            label: isGK ? 'GoalKeeper' : 'Defender',
            left: parsePoint(val('left')) ?? (isGK ? NAMED_SPOTS['post l'] : [-790, -400]),
            right: parsePoint(val('right')) ?? (isGK ? NAMED_SPOTS['post r'] : [-790, 400]),
            kickoutCm: parseNum(val('kickout'), isGK ? 15 : 25),
          };
        })()
      : null;

  const rangeDragRef = useRef<'left' | 'right' | null>(null);

  // Starting a range edit abandons any half-drawn zone outline
  useEffect(() => {
    if (rangeEdit) cancelRef.current();
  }, [!!rangeEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  // Esc leaves range-edit mode
  useEffect(() => {
    if (!editingRangeFor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pathRef.current) setEditingRangeFor(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editingRangeFor]);

  /** Pointer → "[x, y]" in cm (block coordinates: +x towards opponent goal, +y = left). */
  const pointerToCm = (e: React.PointerEvent): string | null => {
    const el = fieldRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const u = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const v = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    const xmm = -FIELD.halfX + u * 2 * FIELD.halfX;
    const ymm = -FIELD.halfY + v * 2 * FIELD.halfY;
    const snap = (n: number) => Math.round(n / 5) * 5; // 5 cm steps
    return `[${snap(xmm / 10)}, ${snap(-ymm / 10)}]`;
  };

  const setRangeEnd = (end: 'left' | 'right', e: React.PointerEvent) => {
    if (!rangeEdit) return;
    const pt = pointerToCm(e);
    if (pt) handleUpdateParam(rangeEdit.routine.id, rangeEdit.block.id, end, pt);
  };

  const handleRangePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const end = e.button === 0 ? 'left' : e.button === 2 ? 'right' : null;
    if (!end) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    rangeDragRef.current = end;
    setRangeEnd(end, e);
  };
  const handleRangePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (rangeDragRef.current) setRangeEnd(rangeDragRef.current, e);
  };
  const handleRangePointerUp = () => {
    rangeDragRef.current = null;
  };

  const bumpKickout = (dir: number) => {
    if (!rangeEdit) return;
    const next = Math.max(0, Math.min(100, rangeEdit.kickoutCm + dir * 5));
    handleUpdateParam(rangeEdit.routine.id, rangeEdit.block.id, 'kickout', String(next));
  };

  // mm → % of the field-lines frame
  const fx = (x: number) => ((x + FIELD.halfX) / (2 * FIELD.halfX)) * 100;
  const fy = (y: number) => ((y + FIELD.halfY) / (2 * FIELD.halfY)) * 100;

  /* ---------------- preview spec ---------------- */

  /** Middle of a zone in simulator millimetres (where the preview ball starts). */
  const zoneCenterMm = (situationId: string): [number, number] => {
    const sit = strategy.situations.find((s) => s.id === situationId);
    const c = sit ? shapeCentroid(shapeOf(sit)) : null;
    if (!c) return [-1500, 300];
    return [-FIELD.halfX + c[0] * 2 * FIELD.halfX, -FIELD.halfY + c[1] * 2 * FIELD.halfY];
  };

  const previewRoutine = preview
    ? strategy.routines.find((r) => r.id === preview.routineId)
    : undefined;
  const previewBlocks = previewRoutine
    ? preview!.mode === 'block'
      ? previewRoutine.blocks.filter((b) => b.id === preview!.blockId)
      : previewRoutine.blocks
    : [];
  const previewSpec: PreviewSpec | null =
    previewRoutine && previewBlocks.length
      ? {
          robotId: previewRoutine.robotId,
          blocks: previewBlocks,
          ball: zoneCenterMm(previewRoutine.situationId),
          replay: previewReplay,
        }
      : null;

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

          {onTestInSimulation && (
            <button
              onClick={onTestInSimulation}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1e2024] border border-[#3b82f6]/60 hover:border-[#3b82f6] hover:bg-[#3b82f6]/10 text-[#93c5fd] text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer"
            >
              <Box className="w-3.5 h-3.5" />
              <span>TEST IN SIMULATION</span>
            </button>
          )}
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

          <div
            className="mt-3 relative bg-[#1a1c1f] border border-[#2D3139] w-full overflow-hidden"
            style={{ aspectRatio: `${FIELD.outerX} / ${FIELD.outerY}` }}
          >
            <svg
              viewBox={PITCH_VIEWBOX}
              className="absolute inset-0 w-full h-full pointer-events-none"
            >
              <PitchLines />
            </svg>

            {/* Interaction layer covers the whole card so edge dots are easy to hit */}
            <div
              onPointerDown={rangeEdit ? handleRangePointerDown : handleGridPointerDown}
              onPointerMove={rangeEdit ? handleRangePointerMove : handleGridPointerMove}
              onPointerUp={rangeEdit ? handleRangePointerUp : handleGridPointerUp}
              onPointerCancel={rangeEdit ? handleRangePointerUp : handleGridPointerCancel}
              onPointerLeave={() => setHoverDot(null)}
              onDoubleClick={rangeEdit ? undefined : handleGridDoubleClick}
              onContextMenu={(e) => rangeEdit && e.preventDefault()}
              className={`absolute inset-0 z-10 touch-none ${
                rangeEdit ? 'cursor-cell' : canCloseOnStart ? 'cursor-pointer' : 'cursor-crosshair'
              }`}
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
                          fillRule="evenodd"
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

                {/* Defender / GoalKeeper range: guard line + kick-out band + L/R handles */}
                {rangeEdit && (
                  <>
                    <svg
                      viewBox={`${-FIELD.halfX} ${-FIELD.halfY} ${2 * FIELD.halfX} ${2 * FIELD.halfY}`}
                      preserveAspectRatio="none"
                      className="absolute inset-0 w-full h-full overflow-visible pointer-events-none z-20"
                    >
                      {rangeEdit.kickoutCm > 0 && (
                        <line
                          x1={rangeEdit.left[0]}
                          y1={rangeEdit.left[1]}
                          x2={rangeEdit.right[0]}
                          y2={rangeEdit.right[1]}
                          stroke="#38bdf8"
                          strokeOpacity={0.18}
                          strokeWidth={rangeEdit.kickoutCm * 20}
                          strokeLinecap="round"
                        />
                      )}
                      <line
                        x1={rangeEdit.left[0]}
                        y1={rangeEdit.left[1]}
                        x2={rangeEdit.right[0]}
                        y2={rangeEdit.right[1]}
                        stroke="#ffffff"
                        strokeWidth={2}
                        strokeDasharray="6 4"
                        vectorEffect="non-scaling-stroke"
                      />
                    </svg>
                    {(
                      [
                        ['L', rangeEdit.left, '#38bdf8'],
                        ['R', rangeEdit.right, '#f472b6'],
                      ] as const
                    ).map(([tag, pt, col]) => (
                      <div
                        key={tag}
                        className="absolute z-30 w-4 h-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-[#0F1115] text-[8px] font-bold flex items-center justify-center pointer-events-none"
                        style={{ left: `${fx(pt[0])}%`, top: `${fy(pt[1])}%`, borderColor: col, color: col }}
                      >
                        {tag}
                      </div>
                    ))}
                  </>
                )}

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
                {drawPath && (
                  <svg
                    viewBox={`0 0 ${gridDims.cols} ${gridDims.rows}`}
                    preserveAspectRatio="none"
                    className="absolute inset-0 w-full h-full overflow-visible pointer-events-none"
                  >
                    {drawPath.length > 1 && (
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
                    )}
                    {/* Rubber-band edge from the last corner to the hovered dot */}
                    {previewPath !== drawPath && hoverDot && (
                      <line
                        x1={drawPath[drawPath.length - 1][0]}
                        y1={drawPath[drawPath.length - 1][1]}
                        x2={hoverDot[0]}
                        y2={hoverDot[1]}
                        stroke="#ffffff"
                        strokeOpacity={0.7}
                        strokeWidth={1.5}
                        strokeDasharray="5 3"
                        vectorEffect="non-scaling-stroke"
                      />
                    )}
                    {/* Dashed closing edge back to the start */}
                    {previewPath && previewPath.length >= 3 && !canCloseOnStart && (
                      <line
                        x1={previewPath[previewPath.length - 1][0]}
                        y1={previewPath[previewPath.length - 1][1]}
                        x2={drawPath[0][0]}
                        y2={drawPath[0][1]}
                        stroke="#ffffff"
                        strokeOpacity={0.3}
                        strokeWidth={1.5}
                        strokeDasharray="3 4"
                        vectorEffect="non-scaling-stroke"
                      />
                    )}
                  </svg>
                )}

                {/* Start-corner marker: click it to close the shape */}
                {pending && drawPath && (
                  <div
                    className={`absolute pointer-events-none rounded-full border-2 -translate-x-1/2 -translate-y-1/2 transition-all ${
                      canCloseOnStart
                        ? 'w-5 h-5 border-[#3DD68C] bg-[#3DD68C]/25'
                        : 'w-3.5 h-3.5 border-white/80'
                    }`}
                    style={{
                      left: `${(drawPath[0][0] / gridDims.cols) * 100}%`,
                      top: `${(drawPath[0][1] / gridDims.rows) * 100}%`,
                    }}
                  />
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

            {/* Live preview of the selected block / stack (real simulation engine) */}
            <BlockPreview
              spec={previewSpec}
              box={{
                left: FIELD_INSET_X,
                top: FIELD_INSET_Y,
                width: 100 - 2 * FIELD_INSET_X,
                height: 100 - 2 * FIELD_INSET_Y,
              }}
            />
          </div>

          {/* Range-edit banner (Defender / GoalKeeper selected) */}
          {rangeEdit && (
            <div className="mt-2 px-2.5 py-2 bg-[#0c1a24] border border-[#38bdf8]/60 text-[10px] font-mono text-[#bae6fd] space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[#38bdf8]">
                  <Crosshair className="w-3.5 h-3.5" />
                  {rangeEdit.label} range · Robot {rangeEdit.routine.robotId}
                </span>
                <button
                  onClick={() => setEditingRangeFor(null)}
                  className="px-2 py-0.5 bg-[#38bdf8] text-[#0F1115] font-bold uppercase cursor-pointer"
                >
                  Done
                </button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="text-[#38bdf8] font-bold">Left-click</span> = left end ·{' '}
                  <span className="text-[#f472b6] font-bold">Right-click</span> = right end (drag
                  to fine-tune)
                </span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {(
                    [
                      ['Kick-out', rangeEdit.kickoutCm, bumpKickout, 5],
                    ] as const
                  ).map(([name, value, bump, stepCm]) => (
                    <span key={name} className="flex items-center gap-1">
                      {name}
                      <button
                        onClick={() => bump(-1)}
                        className="px-1 py-0.5 border border-[#38bdf8]/50 hover:bg-[#38bdf8]/20 cursor-pointer"
                        title={`-${stepCm} cm`}
                      >
                        <ChevronLeft className="w-3 h-3" />
                      </button>
                      <span className="min-w-[3.25rem] text-center text-white font-bold">{value} cm</span>
                      <button
                        onClick={() => bump(1)}
                        className="px-1 py-0.5 border border-[#38bdf8]/50 hover:bg-[#38bdf8]/20 cursor-pointer"
                        title={`+${stepCm} cm`}
                      >
                        <ChevronRight className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </span>
              </div>
            </div>
          )}

          {/* Preview controls */}
          <div className="mt-2 flex items-center justify-between gap-2 px-2.5 py-1.5 bg-[#0F1115] border border-[#2D3139] text-[10px] font-mono text-[#8E95A5]">
            {previewSpec && previewRoutine ? (
              <>
                <span className="flex items-center gap-1.5 min-w-0">
                  <Eye className="w-3.5 h-3.5 text-[#38bdf8] shrink-0" />
                  <span className="truncate">
                    <span className="text-[#bae6fd] font-bold">Robot {previewRoutine.robotId}</span>
                    {' · '}
                    {preview?.mode === 'stack'
                      ? `whole stack (${previewRoutine.blocks.length})`
                      : BLOCK_DEFS[previewSpec.blocks[0].type as BlockType]?.label}
                  </span>
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() =>
                      preview?.blockId &&
                      setPreview({ ...preview, mode: 'block' })
                    }
                    disabled={!preview?.blockId}
                    className={`px-1.5 py-0.5 font-bold uppercase border cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                      preview?.mode === 'block'
                        ? 'border-[#38bdf8] text-[#38bdf8]'
                        : 'border-[#2D3139] hover:text-white'
                    }`}
                  >
                    Block
                  </button>
                  <button
                    onClick={() => preview && setPreview({ ...preview, mode: 'stack' })}
                    className={`px-1.5 py-0.5 font-bold uppercase border cursor-pointer ${
                      preview?.mode === 'stack'
                        ? 'border-[#38bdf8] text-[#38bdf8]'
                        : 'border-[#2D3139] hover:text-white'
                    }`}
                  >
                    Stack
                  </button>
                  <button
                    onClick={() => setPreviewReplay((n) => n + 1)}
                    title="Replay"
                    className="px-1.5 py-0.5 border border-[#2D3139] hover:text-white cursor-pointer"
                  >
                    <RotateCw className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => setPreview(null)}
                    title="Hide preview"
                    className="px-1.5 py-0.5 border border-[#2D3139] hover:text-red-400 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </>
            ) : (
              <span className="flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5" />
                Place or click a block to preview its motion here · click a robot hat for the whole
                stack
              </span>
            )}
          </div>

          {/* Outline-in-progress bar (corner mode) */}
          {pending && drawPath && (
            <div className="mt-2 flex items-center justify-between gap-2 px-2.5 py-1.5 bg-[#0F1115] border border-[#2D3139] text-[10px] font-mono text-[#8E95A5]">
              <span>
                <span className="text-white font-bold">{drawPath.length}</span> point
                {drawPath.length === 1 ? '' : 's'} · click start / double-click / Enter to close
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => finishOutline()}
                  disabled={drawPath.length < 3}
                  className="px-2 py-0.5 bg-[#3DD68C] text-[#111317] font-bold uppercase disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                >
                  Finish
                </button>
                <button
                  onClick={() => cancelOutline()}
                  className="px-2 py-0.5 border border-[#2D3139] hover:border-red-500/60 hover:text-red-400 font-bold uppercase cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Zone list */}
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-[#8E95A5] uppercase tracking-wider">
                ZONES ({strategy.situations.length})
                {draggingFromWorkspace && (
                  <span className="ml-2 normal-case tracking-normal font-normal text-[#38bdf8]">
                    ← drop a stack on a zone to copy it
                  </span>
                )}
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
                    data-zone-drop={sit.id}
                    onClick={() => handleSelectZone(sit.id)}
                    className={`relative flex items-center gap-2 px-2 py-1.5 border cursor-pointer transition-colors ${
                      hint?.kind === 'zone' && hint.zoneId === sit.id
                        ? 'bg-[#0c1a24] ring-2 ring-[#38bdf8]'
                        : isActive
                        ? 'bg-[#22252A]'
                        : 'bg-[#0F1115] border-[#2D3139] hover:bg-[#1e2024]'
                    } ${draggingFromWorkspace && !(hint?.kind === 'zone' && hint.zoneId === sit.id) ? 'border-dashed border-[#38bdf8]/50' : ''}`}
                    style={isActive ? { borderColor: color } : undefined}
                  >
                    {hint?.kind === 'zone' && hint.zoneId === sit.id && (
                      <span className="absolute right-1 -top-2.5 px-1 bg-[#38bdf8] text-[#0F1115] text-[9px] font-bold uppercase">
                        Drop to copy
                      </span>
                    )}
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
                  max={RESOLUTIONS.length - 1}
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
        </div>

        {/* COLUMN 2: WORKSPACE */}
        <div
          ref={workspaceRef}
          className="lg:col-span-5 border-r border-[#2D3139] bg-[#0F1115] flex flex-col p-4 overflow-y-auto"
        >
          <div className="flex items-center justify-between pb-3 border-b border-[#2D3139]">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#fabc4d]" />
              <span className="text-xs font-bold uppercase tracking-wider text-white">
                WORKSPACE
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
                ACTIVE ZONE:
              </span>
              <div className="px-2 py-0.5 bg-[#22252A] border border-[#fabc4d]/60 text-[#fabc4d] font-bold text-xs">
                {activeSituation.name}
              </div>
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
          </div>

          <div className="mt-4 space-y-6">
            {/* ROBOT START BLOCKS (HAT) */}
            <div>
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
                    } flex items-center justify-between py-1.5 bg-[#c08533] hover:bg-[#a5722c] text-white text-xs font-bold tracking-wide transition-colors cursor-grab active:cursor-grabbing touch-none`}
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

      {/* Copy / paste feedback */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[110] px-3 py-1.5 bg-[#0c1a24] border border-[#38bdf8] text-[#bae6fd] text-xs font-mono font-bold shadow-2xl pointer-events-none">
          {toast}
        </div>
      )}

      {/* Floating drag ghost */}
      {renderGhost()}
    </div>
  );
};
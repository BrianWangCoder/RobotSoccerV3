import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScriptBlock, StrategyConfig } from '../types/strategy';
import { FIELD, FRIENDLY_HOME, SimWorld, createWorld, step } from '../sim/engine';

/** What to preview: one robot running a list of blocks (a single block or its whole stack). */
export interface PreviewSpec {
  robotId: number;
  blocks: ScriptBlock[];
  /** Where the ball starts (mm, engine coordinates) — normally the middle of the zone. */
  ball: [number, number];
  /** Bump to force a restart. */
  replay: number;
}

interface BlockPreviewProps {
  spec: PreviewSpec | null;
  /** Rectangle (as % of the parent) that the field LINES occupy. */
  box: { left: number; top: number; width: number; height: number };
}

const DT = 1 / 120;
const PAUSE_AFTER_CYCLE = 0.9; // s to hold the final pose before replaying
const PAUSE_AFTER_KICK = 2.5; // s — long enough to watch the ball roll out
const MAX_CYCLE = 14; // s safety restart

/** Fake one-zone strategy covering the whole field, so the real engine runs the blocks as-is. */
const previewStrategy = (spec: PreviewSpec): StrategyConfig => {
  const quarters: string[] = [];
  for (let c = 0; c < 8; c++)
    for (let r = 0; r < 6; r++) for (let q = 0; q < 4; q++) quarters.push(`${c},${r},${q}`);
  return {
    id: '__preview',
    filename: '__preview.json',
    name: 'Preview',
    resolution: 'Coarse (8x6)',
    activeSituationId: '__zone',
    situations: [
      {
        id: '__zone',
        name: 'Preview',
        priority: 'Critical',
        selectedDots: [],
        selectedQuarters: quarters,
        minCol: 0,
        maxCol: 8,
        minRow: 0,
        maxRow: 6,
      },
    ],
    routines: [
      { id: '__routine', robotId: spec.robotId, situationId: '__zone', blocks: spec.blocks },
    ],
  } as unknown as StrategyConfig;
};

/** Same field, no blocks — used while the replay pause lets the ball finish rolling. */
const holdStrategy = {
  id: '__hold',
  filename: '__hold.json',
  name: 'Hold',
  resolution: 'Coarse (8x6)',
  activeSituationId: '',
  situations: [],
  routines: [],
} as unknown as StrategyConfig;

const makeWorld = (spec: PreviewSpec): SimWorld => {
  const w = createWorld();
  w.opponentsEnabled = false;
  const bot = w.friendly.find((r) => r.id === spec.robotId) ?? w.friendly[0];
  const home = FRIENDLY_HOME[(spec.robotId - 1) % FRIENDLY_HOME.length];
  bot.x = home[0];
  bot.y = home[1];
  bot.angle = home[2];
  bot.home = home;
  w.friendly = [bot]; // only the robot being previewed
  w.ball = { x: spec.ball[0], y: spec.ball[1], vx: 0, vy: 0 };
  return w;
};

/**
 * Animated robot on the Strategy Builder field, driven by the real simulation engine.
 * Owns its own animation loop so the (large) builder doesn't re-render every frame.
 */
export const BlockPreview: React.FC<BlockPreviewProps> = ({ spec, box }) => {
  const [, setFrame] = useState(0);
  const worldRef = useRef<SimWorld | null>(null);
  const strategyRef = useRef<StrategyConfig | null>(null);
  const trailRef = useRef<[number, number][]>([]);
  const cycleRef = useRef({ idx: 0, t: 0, pause: 0, sample: 0 });

  // Restart whenever what we're previewing actually changes
  const key = spec
    ? `${spec.robotId}|${spec.replay}|${spec.ball.join(',')}|${JSON.stringify(
        spec.blocks.map((b) => [b.id, b.type, b.params])
      )}`
    : '';
  const tacticalOnly = useMemo(
    () => !!spec && spec.blocks.every((b) => b.category === 'tactical'),
    [key] // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    if (!spec) {
      worldRef.current = null;
      return;
    }
    worldRef.current = makeWorld(spec);
    strategyRef.current = previewStrategy(spec);
    trailRef.current = [];
    cycleRef.current = { idx: 0, t: 0, pause: 0, sample: 0 };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const loop = (now: number) => {
      const elapsed = Math.min(0.1, (now - last) / 1000);
      last = now;
      const w = worldRef.current;
      const strat = strategyRef.current;
      if (w && strat && spec) {
        const cyc = cycleRef.current;
        if (cyc.pause > 0) {
          // Keep the physics running (ball keeps rolling) with the robot holding still
          acc += elapsed;
          while (acc >= DT) {
            acc -= DT;
            step(w, holdStrategy, DT);
          }
          cyc.pause -= elapsed;
          if (cyc.pause <= 0) {
            worldRef.current = makeWorld(spec);
            trailRef.current = [];
            cycleRef.current = { idx: 0, t: 0, pause: 0, sample: 0 };
          }
        } else {
          acc += elapsed;
          while (acc >= DT && cycleRef.current.pause <= 0) {
            acc -= DT;
            // Tactical roles react to the ball, so move it around the zone to show that
            if (tacticalOnly) {
              const t = w.time;
              w.ball.x = spec.ball[0] + Math.cos(t * 0.9) * 700;
              w.ball.y = spec.ball[1] + Math.sin(t * 1.3) * 550;
              w.ball.vx = 0;
              w.ball.vy = 0;
            }
            step(w, strat, DT);
            const bot = w.friendly[0];
            const st = w.exec[bot.id];

            cyc.sample += DT;
            if (cyc.sample >= 0.05) {
              cyc.sample = 0;
              trailRef.current = [...trailRef.current, [bot.x, bot.y] as [number, number]].slice(-160);
            }

            // One pass through the block list finished → hold, then replay
            const wrapped = st.blockIdx < cyc.idx || (st.blockIdx === cyc.idx && st.t < cyc.t - 1e-6);
            cyc.idx = st.blockIdx;
            cyc.t = st.t;
            if ((wrapped && !tacticalOnly) || w.time > MAX_CYCLE) {
              const kicked = spec.blocks.some((b) => b.type === 'kickA' || b.type === 'kickB');
              cyc.pause = kicked ? PAUSE_AFTER_KICK : PAUSE_AFTER_CYCLE;
            }
          }
        }
      }
      setFrame((f) => (f + 1) % 1_000_000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [key, tacticalOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  const w = worldRef.current;
  if (!spec || !w) return null;
  const bot = w.friendly[0];
  const st = w.exec[bot.id];
  const target = st?.target;

  // mm (field lines) → % of the parent
  const px = (x: number) => box.left + ((x + FIELD.halfX) / (2 * FIELD.halfX)) * box.width;
  const py = (y: number) => box.top + ((y + FIELD.halfY) / (2 * FIELD.halfY)) * box.height;
  const block = spec.blocks.length > 1 ? spec.blocks[st?.blockIdx ?? 0] : spec.blocks[0];
  const paused = cycleRef.current.pause > 0;

  return (
    <div className="absolute inset-0 pointer-events-none z-30">
      {/* Trail + current target, drawn in field millimetres */}
      <svg
        viewBox={`${-FIELD.halfX} ${-FIELD.halfY} ${2 * FIELD.halfX} ${2 * FIELD.halfY}`}
        preserveAspectRatio="none"
        className="absolute overflow-visible"
        style={{ left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%` }}
      >
        {trailRef.current.length > 1 && (
          <polyline
            points={trailRef.current.map(([x, y]) => `${x},${y}`).join(' ')}
            fill="none"
            stroke="#38bdf8"
            strokeOpacity={0.7}
            strokeWidth={2}
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {target && !paused && Math.hypot(target[0] - bot.x, target[1] - bot.y) > 40 && (
          <line
            x1={bot.x}
            y1={bot.y}
            x2={target[0]}
            y2={target[1]}
            stroke="#ffffff"
            strokeOpacity={0.35}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>

      {/* Ball */}
      <div
        className="absolute w-2 h-2 rounded-full bg-white shadow-[0_0_6px_#fabc4d] -translate-x-1/2 -translate-y-1/2"
        style={{ left: `${px(w.ball.x)}%`, top: `${py(w.ball.y)}%` }}
      />

      {/* Robot */}
      <div
        className="absolute -translate-x-1/2 -translate-y-1/2"
        style={{ left: `${px(bot.x)}%`, top: `${py(bot.y)}%` }}
      >
        <div className="relative w-4 h-4 rounded-full bg-[#0c4a6e] border-2 border-[#38bdf8] text-white text-[8px] font-bold flex items-center justify-center shadow-[0_0_8px_#38bdf8]">
          {spec.robotId}
          <div
            className="absolute w-1.5 h-[3px] bg-[#38bdf8]"
            style={{ transform: `rotate(${bot.angle}deg) translate(8px)` }}
          />
        </div>
      </div>

      {/* Status chip */}
      <div className="absolute left-1.5 bottom-1.5 max-w-[90%] px-1.5 py-0.5 bg-[#0F1115]/90 border border-[#38bdf8]/50 text-[9px] font-mono text-[#bae6fd] truncate">
        {paused ? '↻ replaying…' : `${block?.type ?? ''} — ${st?.status ?? ''}`}
      </div>
    </div>
  );
};

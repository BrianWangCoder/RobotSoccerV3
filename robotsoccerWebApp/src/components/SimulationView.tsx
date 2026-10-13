import React, { useEffect, useRef, useState } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Navigation,
  Shield,
  Zap,
  Bot,
  Cpu,
  PauseCircle,
  Trophy,
} from 'lucide-react';
import { StrategyConfig } from '../types/strategy';
import {
  FIELD,
  ROBOT_HALF,
  BALL_R,
  SimRobot,
  SimWorld,
  createWorld,
  resetPositions,
  step,
  routineFor,
} from '../sim/engine';
import {
  gridDimsFor,
  shapeOfSituation,
  shapePath,
  zoneColor,
} from '../utils/zones';
import { loopDepths } from '../utils/loops';
import { PitchLines, PITCH_VIEWBOX, TEAM_COLORS } from './PitchLines';

interface SimulationViewProps {
  strategy: StrategyConfig;
  /** Jump back to the Strategy Builder. */
  onEditStrategy?: () => void;
}

type Scenario = 'Free Match' | 'Corner Kick Defense' | 'Penalty Shootout' | 'Attack Build-up';

const SCENARIOS: Record<Scenario, { ball: [number, number]; vel?: [number, number] }> = {
  'Free Match': { ball: [0, 0] },
  'Corner Kick Defense': { ball: [-4000, -2600], vel: [600, 1500] },
  'Penalty Shootout': { ball: [-3200, 0], vel: [-1800, 300] },
  'Attack Build-up': { ball: [-1500, 600] },
};

const SIM_DT = 1 / 120; // fixed physics step (s)

/** mm → % of the drawing (viewBox spans ±outerX, ±outerY). */
const pctX = (x: number) => ((x + FIELD.outerX) / (2 * FIELD.outerX)) * 100;
const pctY = (y: number) => ((y + FIELD.outerY) / (2 * FIELD.outerY)) * 100;

/** True-to-scale sizes as % of the drawing width (robots are 8.5 cm squares, ball Ø4.3 cm). */
const ROBOT_W = ((2 * ROBOT_HALF) / (2 * FIELD.outerX)) * 100;
const BALL_W = ((2 * BALL_R) / (2 * FIELD.outerX)) * 100;

// The zone lattice spans the field lines (±halfX, ±halfY)
const ZONE_LEFT = pctX(-FIELD.halfX);
const ZONE_TOP = pctY(-FIELD.halfY);
const ZONE_W = pctX(FIELD.halfX) - ZONE_LEFT;
const ZONE_H = pctY(FIELD.halfY) - ZONE_TOP;

export const SimulationView: React.FC<SimulationViewProps> = ({ strategy, onEditStrategy }) => {
  const [isRunning, setIsRunning] = useState(true);
  const [simSpeed, setSimSpeed] = useState(1);
  const [scenario, setScenario] = useState<Scenario>('Free Match');
  const [showZones, setShowZones] = useState(true);
  const [showVectors, setShowVectors] = useState(true);
  const [opponentsOn, setOpponentsOn] = useState(true);
  const [, setFrame] = useState(0); // re-render trigger

  const worldRef = useRef<SimWorld>(createWorld());
  const strategyRef = useRef(strategy);
  strategyRef.current = strategy;
  const runningRef = useRef(isRunning);
  runningRef.current = isRunning;
  const speedRef = useRef(simSpeed);
  speedRef.current = simSpeed;

  const fieldRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; t: number; vx: number; vy: number } | null>(null);
  const robotDragRef = useRef<{ bot: SimRobot; dx: number; dy: number } | null>(null);
  const [heldRobot, setHeldRobot] = useState<SimRobot | null>(null);

  const w = worldRef.current;
  w.opponentsEnabled = opponentsOn;

  /* ---------------- main loop ---------------- */
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const loop = (now: number) => {
      const elapsed = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (runningRef.current) {
        acc += elapsed * speedRef.current;
        while (acc >= SIM_DT) {
          if (!dragRef.current && !robotDragRef.current)
            step(worldRef.current, strategyRef.current, SIM_DT);
          acc -= SIM_DT;
        }
      }
      setFrame((f) => (f + 1) % 1_000_000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  /* ---------------- controls ---------------- */
  const startScenario = (s: Scenario) => {
    setScenario(s);
    const sc = SCENARIOS[s];
    resetPositions(worldRef.current, sc.ball);
    if (sc.vel) {
      worldRef.current.ball.vx = sc.vel[0];
      worldRef.current.ball.vy = sc.vel[1];
    }
  };

  const handleRestart = () => {
    const fresh = createWorld();
    fresh.opponentsEnabled = opponentsOn;
    worldRef.current = fresh;
    const sc = SCENARIOS[scenario];
    resetPositions(fresh, sc.ball);
    if (sc.vel) {
      fresh.ball.vx = sc.vel[0];
      fresh.ball.vy = sc.vel[1];
    }
  };

  /* ---------------- ball drag / throw ---------------- */
  /** Pointer → field mm (unclamped). */
  const rawMm = (e: React.PointerEvent): [number, number] => {
    const r = fieldRef.current!.getBoundingClientRect();
    return [
      ((e.clientX - r.left) / r.width) * 2 * FIELD.outerX - FIELD.outerX,
      ((e.clientY - r.top) / r.height) * 2 * FIELD.outerY - FIELD.outerY,
    ];
  };
  const toMm = (e: React.PointerEvent) => {
    const [x, y] = rawMm(e);
    return [
      Math.max(-FIELD.halfX, Math.min(FIELD.halfX, x)),
      Math.max(-FIELD.halfY, Math.min(FIELD.halfY, y)),
    ] as [number, number];
  };

  /** Robot under the pointer (generous hit area so small markers are easy to grab). */
  const robotAt = (x: number, y: number): SimRobot | null => {
    const w = worldRef.current;
    const bots = [...w.friendly, ...(w.opponentsEnabled ? w.opponents : [])];
    let best: SimRobot | null = null;
    let bestD = Math.max(ROBOT_HALF * 2, 110); // generous: the markers are small
    bots.forEach((b) => {
      const d = Math.hypot(b.x - x, b.y - y);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    });
    return best;
  };

  const onFieldDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !fieldRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const [rx, ry] = rawMm(e);
    const bot = robotAt(rx, ry);
    if (bot) {
      // Pick up a robot: it follows the pointer (keeping the grab offset) until released
      robotDragRef.current = { bot, dx: bot.x - rx, dy: bot.y - ry };
      setHeldRobot(bot);
      return;
    }
    const [x, y] = toMm(e);
    worldRef.current.ball = { x, y, vx: 0, vy: 0 };
    dragRef.current = { x, y, t: performance.now(), vx: 0, vy: 0 };
  };

  const onFieldMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const held = robotDragRef.current;
    if (held) {
      const [rx, ry] = rawMm(e);
      const b = held.bot;
      b.x = Math.max(-FIELD.halfX + ROBOT_HALF, Math.min(FIELD.halfX - ROBOT_HALF, rx + held.dx));
      b.y = Math.max(-FIELD.halfY + ROBOT_HALF, Math.min(FIELD.halfY - ROBOT_HALF, ry + held.dy));
      b.vx = b.vy = b.wl = b.wr = 0;
      return;
    }
    const d = dragRef.current;
    if (!d) return;
    const [x, y] = toMm(e);
    const now = performance.now();
    const dtS = Math.max(0.001, (now - d.t) / 1000);
    dragRef.current = {
      x,
      y,
      t: now,
      vx: d.vx * 0.5 + ((x - d.x) / dtS) * 0.5,
      vy: d.vy * 0.5 + ((y - d.y) / dtS) * 0.5,
    };
    worldRef.current.ball = { x, y, vx: 0, vy: 0 };
  };

  const onFieldUp = () => {
    if (robotDragRef.current) {
      const b = robotDragRef.current.bot;
      b.vx = b.vy = b.wl = b.wr = 0; // dropped robots start from a standstill
      robotDragRef.current = null;
      setHeldRobot(null);
      return;
    }
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    // Release velocity = throw. A screen swipe is far faster than a real hand roll, so scale it
    // down and cap it at a firm roll along the carpet.
    const THROW_SCALE = 0.4;
    const MAX_THROW = 2500; // mm/s
    const vx = d.vx * THROW_SCALE;
    const vy = d.vy * THROW_SCALE;
    const sp = Math.hypot(vx, vy);
    const k = sp > MAX_THROW ? MAX_THROW / sp : 1;
    const fresh = performance.now() - d.t < 80; // pointer was still moving when released
    worldRef.current.ball.vx = fresh ? vx * k : 0;
    worldRef.current.ball.vy = fresh ? vy * k : 0;
  };

  /* ---------------- derived view data ---------------- */
  const { cols, rows } = gridDimsFor(strategy.resolution);
  const activeId = w.activeSituationId;
  const activeZone = strategy.situations.find((s) => s.id === activeId) ?? null;
  const activeIdx = strategy.situations.findIndex((s) => s.id === activeId);
  const zoneShapes = strategy.situations.map((s, i) => ({
    s,
    color: zoneColor(i),
    isActive: s.id === activeId,
    d: shapePath(shapeOfSituation(s, cols, rows), cols, rows),
  }));
  const fmtTime = `${String(Math.floor(w.time / 60)).padStart(2, '0')}:${String(
    Math.floor(w.time % 60)
  ).padStart(2, '0')}`;

  return (
    <div className="flex-1 min-h-0 flex flex-col w-full bg-[#0F1115] text-[#e2e2e8] overflow-hidden select-none">
      {/* Top control bar */}
      <div className="min-h-12 border-b border-[#2D3139] bg-[#181A1E] px-4 md:px-6 py-1.5 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsRunning(!isRunning)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer ${
              isRunning
                ? 'bg-[#fabc4d] text-[#111317]'
                : 'bg-[#22252A] text-white border border-[#2D3139]'
            }`}
          >
            {isRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{isRunning ? 'PAUSE' : 'PLAY'}</span>
          </button>

          <button
            onClick={handleRestart}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1e2024] border border-[#2D3139] hover:border-[#fabc4d] text-xs font-bold uppercase tracking-wider text-[#e2e2e8] transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>RESTART</span>
          </button>

          <div className="flex items-center gap-1 bg-[#0F1115] border border-[#2D3139] p-0.5 ml-1">
            {[0.5, 1, 2, 4].map((spd) => (
              <button
                key={spd}
                onClick={() => setSimSpeed(spd)}
                className={`px-2 py-0.5 text-[11px] font-mono font-bold transition-colors cursor-pointer ${
                  simSpeed === spd ? 'bg-[#fabc4d] text-[#111317]' : 'text-[#8E95A5] hover:text-white'
                }`}
              >
                {spd}x
              </button>
            ))}
          </div>

          {onEditStrategy && (
            <button
              onClick={onEditStrategy}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1e2024] border border-[#2D3139] hover:border-[#fabc4d] text-xs font-bold uppercase tracking-wider text-[#fabc4d] transition-colors cursor-pointer ml-1"
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>EDIT STRATEGY</span>
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-bold uppercase tracking-wider text-[#8E95A5] hidden md:inline">
            DRILL:
          </span>
          {(Object.keys(SCENARIOS) as Scenario[]).map((s) => (
            <button
              key={s}
              onClick={() => startScenario(s)}
              className={`px-2.5 py-1 text-xs font-bold uppercase transition-colors cursor-pointer ${
                scenario === s
                  ? 'bg-[#22252A] text-[#fabc4d] border border-[#fabc4d]'
                  : 'text-[#8E95A5] hover:text-white border border-transparent'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 lg:grid-rows-1 gap-0 overflow-hidden">
        {/* FIELD */}
        <div className="lg:col-span-8 xl:col-span-9 min-h-0 border-r border-[#2D3139] bg-[#111317] flex flex-col p-4 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 mb-2 border-b border-[#2D3139]/50">
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold uppercase tracking-wider text-[#fabc4d]">
                PHYSICS SIMULATOR 2D
              </span>
              <span className="text-[11px] text-[#8E95A5] font-mono">
                BALL: [{(w.ball.x / 1000).toFixed(2)}m, {(-w.ball.y / 1000).toFixed(2)}m]
              </span>
              <span
                className="text-[11px] font-mono font-bold px-1.5 py-0.5 border"
                style={
                  activeZone
                    ? { color: zoneColor(activeIdx), borderColor: zoneColor(activeIdx) }
                    : { color: '#8E95A5', borderColor: '#2D3139' }
                }
              >
                ZONE: {activeZone ? activeZone.name : 'NONE'}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs font-mono">
              {(
                [
                  ['ZONES', showZones, setShowZones],
                  ['VECTORS', showVectors, setShowVectors],
                  ['OPPONENTS', opponentsOn, setOpponentsOn],
                ] as const
              ).map(([label, val, set]) => (
                <label
                  key={label}
                  className="flex items-center gap-1 cursor-pointer text-[#8E95A5] hover:text-white"
                >
                  <input
                    type="checkbox"
                    checked={val}
                    onChange={(e) => set(e.target.checked)}
                    className="accent-[#fabc4d]"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Pitch: scales to the largest size that fits BOTH the width and height available */}
          <div className="h-[60vh] lg:h-auto lg:flex-1 min-h-0 flex items-center justify-center @container-[size]">
            <div
              ref={fieldRef}
              onPointerDown={onFieldDown}
              onPointerMove={onFieldMove}
              onPointerUp={onFieldUp}
              onPointerCancel={onFieldUp}
              className="relative bg-[#1a1c1f] border border-[#2D3139] overflow-hidden cursor-crosshair touch-none @container"
              style={{
                aspectRatio: `${FIELD.outerX} / ${FIELD.outerY}`,
                width: `min(100cqw, ${FIELD.outerX / FIELD.outerY} * 100cqh)`,
              }}
            >
              <svg
                viewBox={PITCH_VIEWBOX}
                className="absolute inset-0 w-full h-full pointer-events-none"
              >
                <PitchLines />
              </svg>

              {/* Strategy zones (same shapes as the builder) */}
              {showZones && (
                <svg
                  viewBox={`0 0 ${cols} ${rows}`}
                  preserveAspectRatio="none"
                  className="absolute pointer-events-none overflow-visible"
                  style={{
                    left: `${ZONE_LEFT}%`,
                    top: `${ZONE_TOP}%`,
                    width: `${ZONE_W}%`,
                    height: `${ZONE_H}%`,
                  }}
                >
                  {[...zoneShapes.filter((z) => !z.isActive), ...zoneShapes.filter((z) => z.isActive)].map(
                    (z) =>
                      z.d && (
                        <path
                          key={z.s.id}
                          d={z.d}
                          fillRule="evenodd"
                          fill={z.color}
                          fillOpacity={z.isActive ? 0.16 : 0.05}
                          stroke={z.color}
                          strokeOpacity={z.isActive ? 0.95 : 0.35}
                          strokeWidth={z.isActive ? 2 : 1}
                          strokeDasharray={z.isActive ? '6 4' : '3 4'}
                          vectorEffect="non-scaling-stroke"
                        />
                      )
                  )}
                </svg>
              )}

              {/* Target vectors */}
              {showVectors && (
                <svg
                  viewBox={PITCH_VIEWBOX}
                  className="absolute inset-0 w-full h-full pointer-events-none"
                >
                  {w.friendly.map((r) => {
                    const t = w.exec[r.id]?.target;
                    if (!t || Math.hypot(t[0] - r.x, t[1] - r.y) < 40) return null;
                    return (
                      <g key={r.id}>
                        <line
                          x1={r.x}
                          y1={r.y}
                          x2={t[0]}
                          y2={t[1]}
                          stroke="#fabc4d"
                          strokeOpacity={0.6}
                          strokeWidth={6}
                          strokeDasharray="20 16"
                        />
                        <circle cx={t[0]} cy={t[1]} r={14} fill="none" stroke="#fabc4d" strokeOpacity={0.6} strokeWidth={5} />
                      </g>
                    );
                  })}
                  <line
                    x1={w.ball.x}
                    y1={w.ball.y}
                    x2={w.ball.x + w.ball.vx * 0.25}
                    y2={w.ball.y + w.ball.vy * 0.25}
                    stroke="#ffffff"
                    strokeOpacity={0.5}
                    strokeWidth={5}
                  />
                </svg>
              )}

              {/* Ball */}
              <div
                className="absolute pointer-events-none z-30"
                style={{ left: `${pctX(w.ball.x)}%`, top: `${pctY(w.ball.y)}%`, transform: 'translate(-50%, -50%)' }}
              >
                <div
                  className="rounded-full bg-white border border-black/60 shadow-[0_0_6px_rgba(255,255,255,0.8)]"
                  style={{ width: `max(${BALL_W}cqw, 9px)`, height: `max(${BALL_W}cqw, 9px)` }}
                />
              </div>

              {/* Robots: 8.5 cm squares drawn to scale, turned to their heading. The bar marks the front. */}
              {[...w.friendly, ...(opponentsOn ? w.opponents : [])].map((r) => {
                const ours = r.team === 'friendly';
                const hasStack = ours && !!routineFor(strategy, activeId, r.id)?.blocks.length;
                const color = ours ? TEAM_COLORS.us : TEAM_COLORS.them;
                return (
                  <div
                    key={r.id}
                    className={`absolute pointer-events-none ${ours ? 'z-20' : 'z-10'}`}
                    style={{
                      left: `${pctX(r.x)}%`,
                      top: `${pctY(r.y)}%`,
                      width: `${ROBOT_W}%`,
                      aspectRatio: '1',
                      transform: `translate(-50%, -50%) rotate(${r.angle}deg) ${heldRobot === r ? 'scale(1.15)' : ''}`,
                    }}
                  >
                    <div
                      className={`relative w-full h-full flex items-center justify-center shadow-md ${
                        heldRobot === r ? 'ring-2 ring-[#38bdf8]' : ''
                      }`}
                      style={
                        ours && !hasStack
                          ? { background: '#22252A', border: `2px solid ${color}`, opacity: 0.8 }
                          : { background: color, border: '2px solid #111317' }
                      }
                    >
                      {/* front bumper */}
                      <div
                        className="absolute right-0 top-[12%] h-[76%] w-[18%]"
                        style={{ background: ours && !hasStack ? color : '#111317' }}
                      />
                      <span
                        className="font-bold text-[9px] leading-none"
                        style={{
                          transform: `rotate(${-r.angle}deg)`,
                          color: ours && !hasStack ? color : '#111317',
                        }}
                      >
                        {ours ? r.id : r.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[#8E95A5] font-mono">
            <span>
              Drag the ball to place it — flick and release to throw it. Drag a robot to move it
              (pause first to set up a position).
            </span>
            <span>
              <span className="font-bold" style={{ color: TEAM_COLORS.us }}>■ Us</span> attack{' '}
              <span className="font-bold" style={{ color: TEAM_COLORS.them }}>→ right goal</span> ·{' '}
              <span className="font-bold" style={{ color: TEAM_COLORS.them }}>■ Opponents</span> attack{' '}
              <span className="font-bold" style={{ color: TEAM_COLORS.us }}>← left goal</span>
            </span>
          </div>
        </div>

        {/* INSPECTOR */}
        <div className="lg:col-span-4 xl:col-span-3 min-h-0 bg-[#181A1E] flex flex-col p-4 overflow-y-auto">
          <div className="pb-3 border-b border-[#2D3139]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-white">
                STRATEGY EXECUTION
              </span>
              <span className="flex items-center gap-1.5 text-xs font-mono font-bold">
                <Trophy className="w-3.5 h-3.5 text-[#fabc4d]" />
                <span style={{ color: TEAM_COLORS.us }}>{w.score.us}</span>
                <span className="text-[#8E95A5]">:</span>
                <span style={{ color: TEAM_COLORS.them }}>{w.score.them}</span>
                <span className="text-[#8E95A5] ml-1">{fmtTime}</span>
              </span>
            </div>
            <div className="text-[10px] text-[#fabc4d] mt-1 font-mono truncate">
              EVALUATING: {strategy.filename}
            </div>
          </div>

          <div className="mt-3 space-y-2.5">
            {w.friendly.map((bot) => {
              const routine = routineFor(strategy, activeId, bot.id);
              const st = w.exec[bot.id];
              return (
                <div key={bot.id} className="p-2.5 bg-[#0F1115] border border-[#2D3139] space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className="flex items-center gap-1.5 text-[#fabc4d]">
                      <Bot className="w-3.5 h-3.5" /> ROBOT {bot.id}
                    </span>
                    <span className="text-[10px] font-mono text-[#8E95A5] truncate ml-2">{st?.status}</span>
                  </div>
                  {routine && routine.blocks.length > 0 ? (
                    <div className="space-y-1">
                      {routine.blocks.map((blk, idx, all) => {
                        const current = idx === st?.blockIdx;
                        const depth = loopDepths(all)[idx]; // indent blocks inside loops
                        const hex =
                          blk.category === 'motion'
                            ? '#2563eb'
                            : blk.category === 'tactical'
                            ? '#16a34a'
                            : blk.category === 'control'
                            ? '#7c6bc4'
                            : '#ea580c';
                        return (
                          <div
                            key={blk.id}
                            className={`px-2 py-1 text-[11px] flex items-center justify-between border transition-colors ${
                              current ? 'ring-1 ring-white/70 text-white' : 'text-[#c9ccd3]'
                            }`}
                            style={{
                              backgroundColor: `${hex}${current ? '66' : '1a'}`,
                              borderColor: `${hex}99`,
                              marginLeft: depth * 12,
                            }}
                          >
                            <span className="flex items-center gap-1.5 font-bold uppercase">
                              {blk.category === 'motion' ? (
                                <Navigation className="w-3 h-3" />
                              ) : blk.category === 'tactical' ? (
                                <Shield className="w-3 h-3" />
                              ) : blk.category === 'control' ? (
                                <PauseCircle className="w-3 h-3" />
                              ) : (
                                <Zap className="w-3 h-3" />
                              )}
                              {current ? '▶ ' : ''}
                              {blk.type === 'loopEnd' ? 'end loop' : blk.type}
                            </span>
                            <span className="text-[10px] font-mono opacity-80 truncate ml-2">
                              {Object.values(blk.params as Record<string, string>).join(' · ')}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-[11px] text-[#8E95A5] italic">
                      {activeZone ? `No stack for ${activeZone.name}.` : 'Ball is outside every zone.'}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-auto pt-4">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#8E95A5] block mb-1">
              MATCH LOG
            </span>
            <div className="h-32 bg-[#0F1115] border border-[#2D3139] p-2 font-mono text-[10px] text-[#8E95A5] overflow-y-auto space-y-1">
              {w.events.length === 0 ? (
                <div className="italic">Events will appear here.</div>
              ) : (
                w.events.map((ev, i) => (
                  <div key={i} className={ev.includes('GOAL') ? 'text-[#3DD68C] font-bold' : ''}>
                    {ev}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
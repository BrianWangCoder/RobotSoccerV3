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
  Trophy,
} from 'lucide-react';
import { StrategyConfig } from '../types/strategy';
import {
  FIELD,
  SimWorld,
  createWorld,
  resetPositions,
  step,
  routineFor,
} from '../sim/engine';
import {
  gridDimsFor,
  quartersOfSituation,
  quartersPath,
  zoneColor,
} from '../utils/zones';

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
          if (!dragRef.current) step(worldRef.current, strategyRef.current, SIM_DT);
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
  const toMm = (e: React.PointerEvent) => {
    const r = fieldRef.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 2 * FIELD.outerX - FIELD.outerX;
    const y = ((e.clientY - r.top) / r.height) * 2 * FIELD.outerY - FIELD.outerY;
    return [
      Math.max(-FIELD.halfX, Math.min(FIELD.halfX, x)),
      Math.max(-FIELD.halfY, Math.min(FIELD.halfY, y)),
    ] as [number, number];
  };

  const onFieldDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !fieldRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = toMm(e);
    worldRef.current.ball = { x, y, vx: 0, vy: 0 };
    dragRef.current = { x, y, t: performance.now(), vx: 0, vy: 0 };
  };

  const onFieldMove = (e: React.PointerEvent<HTMLDivElement>) => {
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
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    const sp = Math.hypot(d.vx, d.vy);
    const k = sp > 4000 ? 4000 / sp : 1; // release velocity = throw (capped to a hard hand roll)
    worldRef.current.ball.vx = performance.now() - d.t < 80 ? d.vx * k : 0;
    worldRef.current.ball.vy = performance.now() - d.t < 80 ? d.vy * k : 0;
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
    d: quartersPath(
      quartersOfSituation(s as typeof s & { selectedQuarters?: string[] }, cols, rows)
    ),
  }));
  const fmtTime = `${String(Math.floor(w.time / 60)).padStart(2, '0')}:${String(
    Math.floor(w.time % 60)
  ).padStart(2, '0')}`;

  return (
    <div className="flex-1 flex flex-col w-full bg-[#0F1115] text-[#e2e2e8] overflow-hidden select-none">
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

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-0 overflow-hidden">
        {/* FIELD */}
        <div className="lg:col-span-8 xl:col-span-9 border-r border-[#2D3139] bg-[#111317] flex flex-col p-4 overflow-hidden">
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

          {/* Pitch */}
          <div className="flex-1 flex items-center justify-center min-h-0">
            <div
              ref={fieldRef}
              onPointerDown={onFieldDown}
              onPointerMove={onFieldMove}
              onPointerUp={onFieldUp}
              onPointerCancel={onFieldUp}
              className="relative w-full max-h-full bg-[#131B18] border border-[#2D3139] overflow-hidden cursor-crosshair touch-none"
              style={{ aspectRatio: `${FIELD.outerX} / ${FIELD.outerY}` }}
            >
              <svg
                viewBox={`${-FIELD.outerX} ${-FIELD.outerY} ${2 * FIELD.outerX} ${2 * FIELD.outerY}`}
                className="absolute inset-0 w-full h-full stroke-[#1E3F30] stroke-[25] fill-none pointer-events-none"
              >
                <rect x={-FIELD.halfX} y={-FIELD.halfY} width={2 * FIELD.halfX} height={2 * FIELD.halfY} />
                <line x1="0" y1={-FIELD.halfY} x2="0" y2={FIELD.halfY} />
                <circle cx="0" cy="0" r="1000" />
                <circle cx="0" cy="0" r="30" fill="#1E3F30" />
                <rect x={-FIELD.halfX} y="-1200" width="1200" height="2400" />
                <path d="M -3000 -600 A 700 700 0 0 1 -3000 600" />
                <rect x={-FIELD.halfX - FIELD.goalDepth} y={-FIELD.goalHalfW} width={FIELD.goalDepth} height={2 * FIELD.goalHalfW} stroke="#3DD68C" strokeOpacity={0.5} />
                <rect x={FIELD.halfX - 1200} y="-1200" width="1200" height="2400" />
                <path d="M 3000 -600 A 700 700 0 0 0 3000 600" />
                <rect x={FIELD.halfX} y={-FIELD.goalHalfW} width={FIELD.goalDepth} height={2 * FIELD.goalHalfW} stroke="#e54d42" strokeOpacity={0.5} />
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
                  viewBox={`${-FIELD.outerX} ${-FIELD.outerY} ${2 * FIELD.outerX} ${2 * FIELD.outerY}`}
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
                          strokeWidth={18}
                          strokeDasharray="60 50"
                        />
                        <circle cx={t[0]} cy={t[1]} r={40} fill="none" stroke="#fabc4d" strokeOpacity={0.6} strokeWidth={14} />
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
                    strokeWidth={14}
                  />
                </svg>
              )}

              {/* Ball */}
              <div
                className="absolute pointer-events-none z-30"
                style={{ left: `${pctX(w.ball.x)}%`, top: `${pctY(w.ball.y)}%`, transform: 'translate(-50%, -50%)' }}
              >
                <div className="w-4 h-4 rounded-full border-2 border-[#fabc4d] bg-white shadow-[0_0_10px_#fabc4d]" />
              </div>

              {/* Friendly robots */}
              {w.friendly.map((r) => {
                const hasStack = !!routineFor(strategy, activeId, r.id)?.blocks.length;
                return (
                  <div
                    key={r.id}
                    className="absolute z-20 flex flex-col items-center pointer-events-none"
                    style={{ left: `${pctX(r.x)}%`, top: `${pctY(r.y)}%`, transform: 'translate(-50%, -50%)' }}
                  >
                    <div
                      className={`relative w-7 h-7 rounded-full border-2 text-white font-bold text-[11px] flex items-center justify-center shadow-md ${
                        hasStack ? 'border-[#fabc4d] bg-[#3b2d2d]' : 'border-[#8E95A5] bg-[#22252A] opacity-70'
                      }`}
                    >
                      {r.id}
                      <div
                        className="absolute w-2 h-1 bg-[#fabc4d]"
                        style={{ transform: `rotate(${r.angle}deg) translate(13px)` }}
                      />
                    </div>
                  </div>
                );
              })}

              {/* Opponents */}
              {opponentsOn &&
                w.opponents.map((o) => (
                  <div
                    key={o.id}
                    className="absolute z-10 pointer-events-none"
                    style={{ left: `${pctX(o.x)}%`, top: `${pctY(o.y)}%`, transform: 'translate(-50%, -50%)' }}
                  >
                    <div className="w-6 h-6 bg-[#22252A] border border-white text-white font-bold text-[10px] flex items-center justify-center rotate-45">
                      <span className="-rotate-45">{o.label}</span>
                    </div>
                  </div>
                ))}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[#8E95A5] font-mono">
            <span>Drag the ball to place it — flick and release to throw it.</span>
            <span>
              Attacking <span className="text-[#e54d42] font-bold">→ right goal</span>, defending{' '}
              <span className="text-[#3DD68C] font-bold">left goal</span>
            </span>
          </div>
        </div>

        {/* INSPECTOR */}
        <div className="lg:col-span-4 xl:col-span-3 bg-[#181A1E] flex flex-col p-4 overflow-y-auto">
          <div className="pb-3 border-b border-[#2D3139]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-white">
                STRATEGY EXECUTION
              </span>
              <span className="flex items-center gap-1.5 text-xs font-mono font-bold">
                <Trophy className="w-3.5 h-3.5 text-[#fabc4d]" />
                <span className="text-[#3DD68C]">{w.score.us}</span>
                <span className="text-[#8E95A5]">:</span>
                <span className="text-[#e54d42]">{w.score.them}</span>
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
                      {routine.blocks.map((blk, idx) => {
                        const current = idx === st?.blockIdx;
                        const hex =
                          blk.category === 'motion'
                            ? '#2563eb'
                            : blk.category === 'tactical'
                            ? '#16a34a'
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
                            }}
                          >
                            <span className="flex items-center gap-1.5 font-bold uppercase">
                              {blk.category === 'motion' ? (
                                <Navigation className="w-3 h-3" />
                              ) : blk.category === 'tactical' ? (
                                <Shield className="w-3 h-3" />
                              ) : (
                                <Zap className="w-3 h-3" />
                              )}
                              {current ? '▶ ' : ''}
                              {blk.type}
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
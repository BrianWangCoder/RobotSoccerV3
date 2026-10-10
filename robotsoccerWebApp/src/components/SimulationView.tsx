import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  FastForward,
  Activity,
  Layers,
  Bot,
  Zap,
  Target,
  ChevronRight,
  Shield,
  Navigation,
} from 'lucide-react';
import { StrategyConfig } from '../types/strategy';

interface SimulationViewProps {
  strategy: StrategyConfig;
}

interface SimBot {
  id: number;
  team: 'FRIENDLY' | 'OPPONENT';
  x: number; // field coords: -450 to 450
  y: number; // field coords: -300 to 300
  vx: number;
  vy: number;
  angle: number;
  targetX: number;
  targetY: number;
  activeBlockIndex: number;
  status: 'ACTIVE' | 'IDLE';
}

interface SimBall {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export const SimulationView: React.FC<SimulationViewProps> = ({ strategy }) => {
  const [isRunning, setIsRunning] = useState<boolean>(true);
  const [simSpeed, setSimSpeed] = useState<number>(1);
  const [activeScenario, setActiveScenario] = useState<string>('Free Match');
  const [showZones, setShowZones] = useState<boolean>(true);
  const [showVectors, setShowVectors] = useState<boolean>(true);

  // Ball state in mm (-4500 to 4500, -3000 to 3000)
  const [ball, setBall] = useState<SimBall>({
    x: 0,
    y: 0,
    vx: 120,
    vy: 80,
  });

  // Friendly Bots (1..5)
  const [bots, setBots] = useState<SimBot[]>([
    {
      id: 1,
      team: 'FRIENDLY',
      x: -1200,
      y: 0,
      vx: 0,
      vy: 0,
      angle: 0,
      targetX: 0,
      targetY: 0,
      activeBlockIndex: 0,
      status: 'ACTIVE',
    },
    {
      id: 2,
      team: 'FRIENDLY',
      x: -2400,
      y: -800,
      vx: 0,
      vy: 0,
      angle: 0,
      targetX: -2400,
      targetY: -800,
      activeBlockIndex: 0,
      status: 'ACTIVE',
    },
    {
      id: 3,
      team: 'FRIENDLY',
      x: -4100,
      y: 0,
      vx: 0,
      vy: 0,
      angle: 0,
      targetX: -4100,
      targetY: 0,
      activeBlockIndex: 0,
      status: 'ACTIVE',
    },
    {
      id: 4,
      team: 'FRIENDLY',
      x: -2000,
      y: 900,
      vx: 0,
      vy: 0,
      angle: 0,
      targetX: -2000,
      targetY: 900,
      activeBlockIndex: 0,
      status: 'ACTIVE',
    },
    {
      id: 5,
      team: 'FRIENDLY',
      x: -4200,
      y: -2200,
      vx: 0,
      vy: 0,
      angle: 0,
      targetX: -4200,
      targetY: -2200,
      activeBlockIndex: 0,
      status: 'IDLE',
    },
  ]);

  // Opponent Bots (B1..B5)
  const [opponents, setOpponents] = useState<SimBot[]>([
    {
      id: 101,
      team: 'OPPONENT',
      x: 1200,
      y: 400,
      vx: 0,
      vy: 0,
      angle: 180,
      targetX: 0,
      targetY: 0,
      activeBlockIndex: 0,
      status: 'ACTIVE',
    },
    {
      id: 102,
      team: 'OPPONENT',
      x: 2200,
      y: -700,
      vx: 0,
      vy: 0,
      angle: 180,
      targetX: 0,
      targetY: 0,
      activeBlockIndex: 0,
      status: 'ACTIVE',
    },
    {
      id: 103,
      team: 'OPPONENT',
      x: 4100,
      y: 0,
      vx: 0,
      vy: 0,
      angle: 180,
      targetX: 4100,
      targetY: 0,
      activeBlockIndex: 0,
      status: 'ACTIVE',
    },
    {
      id: 104,
      team: 'OPPONENT',
      x: 1800,
      y: 900,
      vx: 0,
      vy: 0,
      angle: 180,
      targetX: 0,
      targetY: 0,
      activeBlockIndex: 0,
      status: 'ACTIVE',
    },
  ]);

  const fieldRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef<boolean>(false);

  // Simulation physics step
  useEffect(() => {
    if (!isRunning) return;

    const dt = 0.03 * simSpeed;
    const timer = setInterval(() => {
      // 1. Update ball position with friction
      setBall((prev) => {
        let nx = prev.x + prev.vx * dt * 20;
        let ny = prev.y + prev.vy * dt * 20;
        let nvx = prev.vx * 0.99;
        let nvy = prev.vy * 0.99;

        // Bounce off field boundaries
        if (nx > 4200) {
          nx = 4200;
          nvx = -nvx * 0.7;
        }
        if (nx < -4200) {
          nx = -4200;
          nvx = -nvx * 0.7;
        }
        if (ny > 2800) {
          ny = 2800;
          nvy = -nvy * 0.7;
        }
        if (ny < -2800) {
          ny = -2800;
          nvy = -nvy * 0.7;
        }

        return { x: nx, y: ny, vx: nvx, vy: nvy };
      });

      // 2. Update friendly bots based on active strategy routines
      setBots((prevBots) =>
        prevBots.map((bot) => {
          if (bot.status === 'IDLE') return bot;

          let tx = bot.targetX;
          let ty = bot.targetY;

          // GoalKeeper: track ball Y on goal line
          if (bot.id === 3) {
            tx = -4100;
            ty = Math.max(-800, Math.min(800, ball.y * 0.8));
          } else if (bot.id === 1) {
            // Striker tracks ball and kicks
            const distToBall = Math.hypot(ball.x - bot.x, ball.y - bot.y);
            if (distToBall < 180) {
              // Kick ball towards opponent goal (4500, 0)
              setBall((b) => ({
                ...b,
                vx: 380 + Math.random() * 50,
                vy: (Math.random() - 0.5) * 120,
              }));
            }
            tx = ball.x - 120;
            ty = ball.y;
          } else if (bot.id === 2) {
            // Defender tracks mid-pitch shadow
            tx = Math.min(-1500, ball.x - 800);
            ty = ball.y * 0.5;
          } else if (bot.id === 4) {
            // Support flanker
            tx = ball.x - 500;
            ty = ball.y > 0 ? -1200 : 1200;
          }

          const dx = tx - bot.x;
          const dy = ty - bot.y;
          const speed = 1200; // mm/s
          const dist = Math.hypot(dx, dy);

          let vx = 0;
          let vy = 0;
          if (dist > 50) {
            vx = (dx / dist) * Math.min(dist * 3, speed);
            vy = (dy / dist) * Math.min(dist * 3, speed);
          }

          const nx = bot.x + vx * dt;
          const ny = bot.y + vy * dt;
          const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

          return {
            ...bot,
            x: nx,
            y: ny,
            vx,
            vy,
            angle: Math.round(angle),
            targetX: tx,
            targetY: ty,
          };
        })
      );

      // 3. Update opponent bots
      setOpponents((prevOpps) =>
        prevOpps.map((opp) => {
          let tx = opp.x;
          let ty = opp.y;
          if (opp.id === 101) {
            // Opponent striker
            tx = ball.x + 120;
            ty = ball.y;
            const dist = Math.hypot(ball.x - opp.x, ball.y - opp.y);
            if (dist < 180) {
              setBall((b) => ({
                ...b,
                vx: -350 - Math.random() * 50,
                vy: (Math.random() - 0.5) * 120,
              }));
            }
          } else if (opp.id === 103) {
            // Opponent keeper
            tx = 4100;
            ty = Math.max(-800, Math.min(800, ball.y * 0.8));
          } else {
            tx = 1500;
            ty = opp.id === 102 ? -800 : 800;
          }

          const dx = tx - opp.x;
          const dy = ty - opp.y;
          const dist = Math.hypot(dx, dy);
          let vx = 0;
          let vy = 0;
          if (dist > 50) {
            vx = (dx / dist) * Math.min(dist * 2.5, 1000);
            vy = (dy / dist) * Math.min(dist * 2.5, 1000);
          }

          return {
            ...opp,
            x: opp.x + vx * dt,
            y: opp.y + vy * dt,
            angle: Math.round((Math.atan2(dy, dx) * 180) / Math.PI),
          };
        })
      );
    }, 30);

    return () => clearInterval(timer);
  }, [isRunning, simSpeed, ball.x, ball.y]);

  const handleResetPositions = () => {
    setBall({ x: 0, y: 0, vx: 0, vy: 0 });
    setBots((b) =>
      b.map((bot) => ({
        ...bot,
        x: bot.id === 3 ? -4100 : bot.id === 1 ? -1200 : bot.id === 2 ? -2400 : -2000,
        y: bot.id === 3 ? 0 : bot.id === 1 ? 0 : bot.id === 2 ? -800 : 900,
      }))
    );
  };

  const handleScenarioChange = (scenario: string) => {
    setActiveScenario(scenario);
    if (scenario === 'Corner Kick Defense') {
      setBall({ x: -4000, y: 2600, vx: 0, vy: 0 });
    } else if (scenario === 'Penalty Shootout') {
      setBall({ x: -2800, y: 0, vx: 0, vy: 0 });
    } else {
      setBall({ x: 0, y: 0, vx: 100, vy: 50 });
    }
  };

  // Dragging ball on simulation field
  const handleSimFieldMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    isDragging.current = true;
    updateSimBallFromMouse(e);
  };

  const handleSimFieldMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging.current) return;
    updateSimBallFromMouse(e);
  };

  const handleSimFieldMouseUp = () => {
    isDragging.current = false;
  };

  const updateSimBallFromMouse = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!fieldRef.current) return;
    const rect = fieldRef.current.getBoundingClientRect();
    const xPct = (e.clientX - rect.left) / rect.width;
    const yPct = (e.clientY - rect.top) / rect.height;

    const mmX = (xPct - 0.5) * 9000;
    const mmY = (yPct - 0.5) * 6000;

    setBall({
      x: Math.max(-4200, Math.min(4200, mmX)),
      y: Math.max(-2800, Math.min(2800, mmY)),
      vx: 0,
      vy: 0,
    });
  };

  return (
    <div
      className="flex-1 flex flex-col w-full bg-[#0F1115] text-[#e2e2e8] overflow-hidden select-none"
      onMouseUp={handleSimFieldMouseUp}
    >
      {/* Simulation Top Control Bar */}
      <div className="h-12 border-b border-[#2D3139] bg-[#181A1E] px-4 md:px-6 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          {/* Play / Pause */}
          <button
            onClick={() => setIsRunning(!isRunning)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer ${
              isRunning
                ? 'bg-[#fabc4d] text-[#111317]'
                : 'bg-[#22252A] text-white border border-[#2D3139]'
            }`}
          >
            {isRunning ? (
              <>
                <Pause className="w-3.5 h-3.5" />
                <span>PAUSE</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                <span>PLAY</span>
              </>
            )}
          </button>

          {/* Reset */}
          <button
            onClick={handleResetPositions}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1e2024] border border-[#2D3139] hover:border-[#fabc4d] text-xs font-bold uppercase tracking-wider text-[#e2e2e8] transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>RESET DRILL</span>
          </button>

          {/* Speed selector */}
          <div className="flex items-center gap-1 bg-[#0F1115] border border-[#2D3139] p-0.5 ml-2">
            {[0.5, 1, 2].map((spd) => (
              <button
                key={spd}
                onClick={() => setSimSpeed(spd)}
                className={`px-2 py-0.5 text-[11px] font-mono font-bold transition-colors cursor-pointer ${
                  simSpeed === spd
                    ? 'bg-[#fabc4d] text-[#111317]'
                    : 'text-[#8E95A5] hover:text-white'
                }`}
              >
                {spd}x
              </button>
            ))}
          </div>
        </div>

        {/* Drill Scenario Selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-[#8E95A5] hidden md:inline">
            DRILL:
          </span>
          {['Free Match', 'Corner Kick Defense', 'Penalty Shootout'].map((scen) => (
            <button
              key={scen}
              onClick={() => handleScenarioChange(scen)}
              className={`px-2.5 py-1 text-xs font-bold uppercase transition-colors cursor-pointer ${
                activeScenario === scen
                  ? 'bg-[#22252A] text-[#fabc4d] border border-[#fabc4d]'
                  : 'text-[#8E95A5] hover:text-white border border-transparent'
              }`}
            >
              {scen}
            </button>
          ))}
        </div>
      </div>

      {/* Main Simulation Viewport (Canvas Left, Strategy Execution Monitor Right) */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-0 overflow-hidden">
        {/* SIMULATION FIELD (8 or 9 cols) */}
        <div className="lg:col-span-8 xl:col-span-9 border-r border-[#2D3139] bg-[#111317] flex flex-col p-4 overflow-hidden">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#2D3139]/50">
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold uppercase tracking-wider text-[#fabc4d]">
                PHYSICS SIMULATOR 2D
              </span>
              <span className="text-[11px] text-[#8E95A5] font-mono">
                BALL: [{(ball.x / 1000).toFixed(2)}m, {(ball.y / 1000).toFixed(2)}m]
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono">
              <label className="flex items-center gap-1 cursor-pointer text-[#8E95A5] hover:text-white">
                <input
                  type="checkbox"
                  checked={showZones}
                  onChange={(e) => setShowZones(e.target.checked)}
                  className="accent-[#fabc4d]"
                />
                <span>ZONES</span>
              </label>
              <label className="flex items-center gap-1 cursor-pointer text-[#8E95A5] hover:text-white ml-2">
                <input
                  type="checkbox"
                  checked={showVectors}
                  onChange={(e) => setShowVectors(e.target.checked)}
                  className="accent-[#fabc4d]"
                />
                <span>VECTORS</span>
              </label>
            </div>
          </div>

          {/* Interactive Simulation Pitch */}
          <div
            ref={fieldRef}
            onMouseDown={handleSimFieldMouseDown}
            onMouseMove={handleSimFieldMouseMove}
            className="relative flex-1 bg-[#131B18] border border-[#2D3139] overflow-hidden flex items-center justify-center cursor-crosshair shadow-inner"
            style={{ minHeight: '380px' }}
          >
            {/* Field Vector Markings */}
            <svg
              viewBox="-4500 -3000 9000 6000"
              className="absolute inset-0 w-full h-full stroke-[#1E3F30] stroke-[25] fill-none pointer-events-none"
            >
              {/* Outer boundary */}
              <rect x="-4200" y="-2800" width="8400" height="5600" />
              {/* Halfway line */}
              <line x1="0" y1="-2800" x2="0" y2="2800" />
              {/* Center Circle */}
              <circle cx="0" cy="0" r="1000" />
              <circle cx="0" cy="0" r="30" fill="#1E3F30" />

              {/* Friendly Penalty Area */}
              <rect x="-4200" y="-1200" width="1200" height="2400" />
              <path d="M -3000 -600 A 700 700 0 0 1 -3000 600" />
              <rect x="-4450" y="-800" width="250" height="1600" stroke="#2D3139" />

              {/* Opponent Penalty Area */}
              <rect x="3000" y="-1200" width="1200" height="2400" />
              <path d="M 3000 -600 A 700 700 0 0 0 3000 600" />
              <rect x="4200" y="-800" width="250" height="1600" stroke="#2D3139" />
            </svg>

            {/* Situation 1 Zone Overlay if enabled */}
            {showZones && (
              <div
                className="absolute border-2 border-dashed border-[#fabc4d]/60 bg-[#fabc4d]/5 pointer-events-none"
                style={{
                  left: '12%',
                  top: '15%',
                  width: '35%',
                  height: '70%',
                }}
              >
                <div className="p-1 text-[10px] font-bold text-[#fabc4d] font-mono">
                  Situation 1 (Active Strategy Bounds)
                </div>
              </div>
            )}

            {/* BALL */}
            <div
              className="absolute pointer-events-none z-30"
              style={{
                left: `${((ball.x + 4500) / 9000) * 100}%`,
                top: `${((ball.y + 3000) / 6000) * 100}%`,
                transform: 'translate(-50%, -50%)',
              }}
            >
              <div className="w-5 h-5 rounded-full border-2 border-[#fabc4d] bg-white flex items-center justify-center shadow-[0_0_12px_#fabc4d]">
                <div className="w-1.5 h-1.5 bg-[#111317] rounded-full" />
              </div>
            </div>

            {/* Friendly Robots */}
            {bots.map((bot) => (
              <div
                key={bot.id}
                className="absolute z-20 flex flex-col items-center pointer-events-none"
                style={{
                  left: `${((bot.x + 4500) / 9000) * 100}%`,
                  top: `${((bot.y + 3000) / 6000) * 100}%`,
                  transform: 'translate(-50%, -50%)',
                }}
              >
                <div className="relative">
                  <div className="w-8 h-8 rounded-full border-2 border-[#fabc4d] bg-[#3b2d2d] text-white font-bold text-xs flex items-center justify-center shadow-md">
                    {bot.id}
                    {/* Heading indicator */}
                    <div
                      className="absolute w-2 h-1 bg-[#fabc4d]"
                      style={{
                        transform: `rotate(${bot.angle}deg) translate(14px)`,
                      }}
                    />
                  </div>
                </div>
                <span className="text-[9px] font-bold text-[#fabc4d] font-mono mt-0.5">
                  BOT {bot.id}
                </span>
              </div>
            ))}

            {/* Opponent Robots */}
            {opponents.map((opp) => (
              <div
                key={opp.id}
                className="absolute z-10 flex flex-col items-center pointer-events-none"
                style={{
                  left: `${((opp.x + 4500) / 9000) * 100}%`,
                  top: `${((opp.y + 3000) / 6000) * 100}%`,
                  transform: 'translate(-50%, -50%)',
                }}
              >
                <div className="w-7 h-7 bg-[#22252A] border border-white text-white font-bold text-xs flex items-center justify-center rotate-45">
                  <span className="-rotate-45">B{opp.id - 100}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between text-xs text-[#8E95A5] font-mono">
            <span>Tip: Click and drag anywhere on the field to toss the ball!</span>
            <span className="text-[#3DD68C]">PHYSICS ENGINE: ACTIVE (60 TPS)</span>
          </div>
        </div>

        {/* RIGHT PANE: ACTIVE STRATEGY EXECUTION INSPECTOR */}
        <div className="lg:col-span-4 xl:col-span-3 bg-[#181A1E] flex flex-col p-4 overflow-y-auto">
          <div className="pb-3 border-b border-[#2D3139]">
            <span className="text-xs font-bold uppercase tracking-wider text-white">
              STRATEGY EXECUTION INSPECTOR
            </span>
            <div className="text-[10px] text-[#fabc4d] mt-1 font-mono">
              EVALUATING: {strategy.filename}
            </div>
          </div>

          <div className="mt-4 space-y-4">
            {bots.slice(0, 3).map((bot) => {
              const routine = strategy.routines.find((r) => r.robotId === bot.id);
              return (
                <div
                  key={bot.id}
                  className="p-3 bg-[#0F1115] border border-[#2D3139] space-y-2"
                >
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className="text-[#fabc4d]">ROBOT {bot.id} ROUTINE</span>
                    <span className="text-[#3DD68C] text-[10px] font-mono">
                      ACTIVE TRIGGER
                    </span>
                  </div>

                  {routine ? (
                    <div className="space-y-1">
                      {routine.blocks.map((blk, idx) => (
                        <div
                          key={blk.id}
                          className={`p-2 text-xs flex items-center justify-between ${
                            blk.category === 'motion'
                              ? 'bg-[#2563eb]/20 border border-[#2563eb]/50 text-blue-200'
                              : blk.category === 'tactical'
                              ? 'bg-[#16a34a]/20 border border-[#16a34a]/50 text-green-200'
                              : 'bg-[#ea580c]/20 border border-[#ea580c]/50 text-orange-200'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 font-bold uppercase text-[11px]">
                            {blk.category === 'motion' ? (
                              <Navigation className="w-3 h-3" />
                            ) : blk.category === 'tactical' ? (
                              <Shield className="w-3 h-3" />
                            ) : (
                              <Zap className="w-3 h-3" />
                            )}
                            <span>{blk.type}</span>
                          </div>
                          <span className="text-[10px] font-mono opacity-80">
                            {JSON.stringify(blk.params)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11px] text-[#8E95A5] italic">
                      No blocks assigned in active situation.
                    </div>
                  )}

                  <div className="pt-1 text-[10px] font-mono text-[#8E95A5] flex justify-between border-t border-[#2D3139]/40">
                    <span>COORDS:</span>
                    <span className="text-white">
                      [{Math.round(bot.x)}, {Math.round(bot.y)}]
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

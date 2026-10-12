import React, { useState, useEffect, useRef } from 'react';
import {
  Upload,
  Play,
  Square,
  RotateCw,
  Wrench,
  Bot,
  AlertTriangle,
  HelpCircle,
  Activity,
  Check,
  Radio,
  Sliders,
} from 'lucide-react';
import { StrategyConfig } from '../types/strategy';
import { FIELD, ROBOT_HALF, BALL_R } from '../sim/engine';
import { PitchLines, PITCH_VIEWBOX, PITCH_SURROUND, TEAM_COLORS } from './PitchLines';

/*
 * Positions here are % of the PLAYING FIELD (wall to wall, 265 × 185 cm), drawn on the same pitch
 * as the Simulation and Strategy screens. These helpers place them on the drawing (field + margin).
 */
const INSET_X = ((FIELD.outerX - FIELD.halfX) / (2 * FIELD.outerX)) * 100;
const INSET_Y = ((FIELD.outerY - FIELD.halfY) / (2 * FIELD.outerY)) * 100;
const drawX = (fieldPct: number) => INSET_X + (fieldPct / 100) * (100 - 2 * INSET_X);
const drawY = (fieldPct: number) => INSET_Y + (fieldPct / 100) * (100 - 2 * INSET_Y);
/** True-to-scale sizes as % of the drawing width (8.5 cm robots, Ø4.3 cm ball). */
const ROBOT_W = ((2 * ROBOT_HALF) / (2 * FIELD.outerX)) * 100;
const BALL_W = ((2 * BALL_R) / (2 * FIELD.outerX)) * 100;
const toMetres = (pct: number, half: number) => Number((((pct / 100) * 2 - 1) * (half / 1000)).toFixed(2));

interface LivePlayViewProps {
  strategy: StrategyConfig;
  onImportStrategy: () => void;
}

interface RobotTelemetry {
  id: number;
  label: string;
  x: number; // % of the playing field (wall to wall) 0..100
  y: number; // % of the playing field (wall to wall) 0..100
  angle: number; // degrees
  status: 'ACTIVE' | 'OCCLUDED' | 'OFFLINE';
  battery: number;
  rssi: number;
  role: string;
}

interface OpponentBot {
  id: string;
  x: number;
  y: number;
}

export const LivePlayView: React.FC<LivePlayViewProps> = ({
  strategy,
  onImportStrategy,
}) => {
  const [matchState, setMatchState] = useState<'IDLE' | 'PREPARING' | 'RUNNING' | 'STOPPED'>('STOPPED');
  const [selectedTeam, setSelectedTeam] = useState<'RED' | 'BLUE'>('RED');
  const [selectedBotId, setSelectedBotId] = useState<number | null>(null);
  const [testModeActive, setTestModeActive] = useState<boolean>(false);
  const [eventLogs, setEventLogs] = useState<string[]>([
    '[SSL-VISION] Connected to 192.168.1.104:10006 - 60.0 FPS',
    '[RADIO] Transceiver linked on 2.4GHz CH 11 (5/5 nodes)',
    '[STRATEGY] Loaded strategy_defensive_01.json (Active)',
    '[SYSTEM] Ready for match start.',
  ]);

  // Ball position on field (normalized coordinates in meters and percentage)
  const [ballPos, setBallPos] = useState<{ x: number; y: number; pctX: number; pctY: number }>({
    x: toMetres(37, FIELD.halfX),
    y: toMetres(52, FIELD.halfY),
    pctX: 37,
    pctY: 52,
  });

  const isDraggingBall = useRef<boolean>(false);
  const fieldRef = useRef<HTMLDivElement>(null);

  // Friendly robot positions matching Screenshot 2
  const [robots, setRobots] = useState<RobotTelemetry[]>([
    { id: 1, label: 'BOT 1', x: 16, y: 35, angle: 45, status: 'OCCLUDED', battery: 94, rssi: -45, role: 'Press Striker' },
    { id: 2, label: 'BOT 2', x: 24, y: 54, angle: 15, status: 'ACTIVE', battery: 89, rssi: -38, role: 'Midfield Anchor' },
    { id: 3, label: 'BOT 3', x: 10, y: 65, angle: 90, status: 'ACTIVE', battery: 98, rssi: -40, role: 'Goalkeeper' },
    { id: 4, label: 'BOT 4', x: 39, y: 63, angle: -30, status: 'OCCLUDED', battery: 82, rssi: -52, role: 'Defender' },
    { id: 5, label: 'BOT 5', x: 8, y: 31, angle: 0, status: 'OFFLINE', battery: 0, rssi: -99, role: 'Reserve / Bench' },
  ]);

  // Opponent robots B1-B5 matching Screenshot 2
  const [opponents, setOpponents] = useState<OpponentBot[]>([
    { id: 'B1', x: 28, y: 34 },
    { id: 'B2', x: 42, y: 44 },
    { id: 'B3', x: 52, y: 57 },
    { id: 'B4', x: 57, y: 36 },
    { id: 'B5', x: 58, y: 43 },
  ]);

  // Real-time animation loop when match is RUNNING
  useEffect(() => {
    if (matchState !== 'RUNNING') return;

    const interval = setInterval(() => {
      // Simulate subtle tactical movement tracking the ball
      setRobots((prev) =>
        prev.map((bot) => {
          if (bot.status === 'OFFLINE') return bot;
          // Calculate subtle drift toward ball or tactical position
          const targetX = bot.id === 2 ? ballPos.pctX - 8 : bot.id === 1 ? ballPos.pctX - 15 : bot.x;
          const targetY = bot.id === 2 ? ballPos.pctY : bot.id === 1 ? ballPos.pctY - 12 : bot.y;
          const dx = (targetX - bot.x) * 0.05;
          const dy = (targetY - bot.y) * 0.05;
          const angle = Math.atan2(ballPos.pctY - bot.y, ballPos.pctX - bot.x) * (180 / Math.PI);

          return {
            ...bot,
            x: Math.max(5, Math.min(95, bot.x + dx)),
            y: Math.max(10, Math.min(90, bot.y + dy)),
            angle: Math.round(angle),
          };
        })
      );
    }, 50);

    return () => clearInterval(interval);
  }, [matchState, ballPos]);

  // Handle dragging the ball on the field
  const handleFieldMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    isDraggingBall.current = true;
    updateBallFromMouse(e);
  };

  const handleFieldMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDraggingBall.current) return;
    updateBallFromMouse(e);
  };

  const handleFieldMouseUp = () => {
    isDraggingBall.current = false;
  };

  const updateBallFromMouse = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!fieldRef.current) return;
    const rect = fieldRef.current.getBoundingClientRect();
    // pointer → % of the drawing → % of the playing field (kept inside the walls)
    const dx = ((e.clientX - rect.left) / rect.width) * 100;
    const dy = ((e.clientY - rect.top) / rect.height) * 100;
    const xPct = Math.max(1, Math.min(99, ((dx - INSET_X) / (100 - 2 * INSET_X)) * 100));
    const yPct = Math.max(1, Math.min(99, ((dy - INSET_Y) / (100 - 2 * INSET_Y)) * 100));

    // Field metres from the centre spot (265 × 185 cm field)
    const meterX = toMetres(xPct, FIELD.halfX);
    const meterY = toMetres(yPct, FIELD.halfY);

    setBallPos({
      x: meterX,
      y: meterY,
      pctX: xPct,
      pctY: yPct,
    });
  };

  // Match control handlers
  const handlePrepare = () => {
    setMatchState('PREPARING');
    addLog('[MATCH] Prepare signal sent. Aligning bots to kickoff slots.');
    setTimeout(() => {
      setMatchState('IDLE');
      addLog('[MATCH] Robots in position. Awaiting START.');
    }, 1200);
  };

  const handleStart = () => {
    setMatchState('RUNNING');
    addLog('[REFEREE] NORMAL_START - Match actively running.');
  };

  const handleStop = () => {
    setMatchState('STOPPED');
    addLog('[REFEREE] STOP / HALT - Zero velocity issued to all actuators.');
  };

  const handleTestActuators = () => {
    setTestModeActive(true);
    addLog('[DIAGNOSTICS] Motor pulse sequence test initiated on active bots.');
    setTimeout(() => {
      setTestModeActive(false);
      addLog('[DIAGNOSTICS] Actuator pulse test complete. Both drive motors nominal.');
    }, 1500);
  };

  const handleRefereeCommand = (cmd: string) => {
    addLog(`[REFEREE CMD] ${cmd}`);
  };

  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    setEventLogs((prev) => [`${time} ${msg}`, ...prev.slice(0, 15)]);
  };

  return (
    <div
      className="flex-1 min-h-0 flex flex-col w-full bg-[#0F1115] text-[#e2e2e8] overflow-hidden select-none"
      onMouseUp={handleFieldMouseUp}
    >
      {/* Subheader Bar matching Screenshot 2 */}
      <div className="h-12 border-b border-[#2D3139] bg-[#181A1E] px-4 md:px-6 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          {/* SYSTEM READY Beacon */}
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-[#3DD68C] rounded-full shadow-[0_0_8px_#3DD68C]" />
            <span className="text-xs font-bold uppercase tracking-wider text-white">
              SYSTEM READY
            </span>
          </div>

          {/* ACTIVE STRATEGY */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-[#8E95A5] uppercase tracking-wider hidden sm:inline">
              ACTIVE STRATEGY:
            </span>
            <div className="px-3 py-1 bg-[#0F1115] border border-[#2D3139] text-[#fabc4d] text-xs font-mono font-bold tracking-wide">
              {strategy.filename}
            </div>
          </div>
        </div>

        {/* IMPORT STRATEGY BUTTON */}
        <button
          onClick={onImportStrategy}
          className="flex items-center gap-1.5 px-3 py-1 bg-[#1e2024] hover:bg-[#282a2e] border border-[#2D3139] hover:border-[#fabc4d] text-xs font-bold uppercase tracking-wider text-[#fabc4d] transition-colors cursor-pointer"
        >
          <Upload className="w-3.5 h-3.5" />
          <span>IMPORT STRATEGY</span>
        </button>
      </div>

      {/* Main Cockpit Layout: Live Field View (Left) and Match Controls (Right) */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 lg:grid-rows-1 gap-0 overflow-hidden">
        {/* LEFT PANE: LIVE FIELD VIEW (8 or 9 columns) */}
        <div className="lg:col-span-8 xl:col-span-9 min-h-0 border-r border-[#2D3139] bg-[#111317] flex flex-col p-4 overflow-hidden">
          {/* Header row inside Field Card */}
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#2D3139]/50">
            <div className="text-xs font-bold uppercase tracking-wider text-[#fabc4d]">
              LIVE FIELD VIEW
            </div>
            <div className="flex items-center gap-3 text-xs font-mono">
              <span className="text-white">
                BALL:{' '}
                <span className="text-[#fabc4d] font-bold">
                  [{ballPos.x >= 0 ? `+${ballPos.x}` : ballPos.x},{' '}
                  {ballPos.y >= 0 ? `+${ballPos.y}` : ballPos.y}]
                </span>
              </span>
              <span className="text-[#3DD68C] font-bold uppercase">
                VISION: OVERHEAD CAM ACTIVE
              </span>
            </div>
          </div>

          {/* Pitch: the same field drawing as Simulation / Strategy, scaled to fit width AND height */}
          <div className="h-[60vh] lg:h-auto lg:flex-1 min-h-0 flex items-center justify-center @container-[size]">
            <div
              ref={fieldRef}
              onMouseDown={handleFieldMouseDown}
              onMouseMove={handleFieldMouseMove}
              className="relative border border-[#2D3139] overflow-hidden cursor-crosshair @container"
              style={{
                background: PITCH_SURROUND,
                aspectRatio: `${FIELD.outerX} / ${FIELD.outerY}`,
                width: `min(100cqw, ${FIELD.outerX / FIELD.outerY} * 100cqh)`,
              }}
            >
              <svg viewBox={PITCH_VIEWBOX} className="absolute inset-0 w-full h-full pointer-events-none">
                <PitchLines />
              </svg>

              {/* BALL (drag to reposition) — to scale */}
              <div
                className="absolute pointer-events-none select-none z-30"
                style={{ left: `${drawX(ballPos.pctX)}%`, top: `${drawY(ballPos.pctY)}%`, transform: 'translate(-50%, -50%)' }}
              >
                <div
                  className="rounded-full bg-white border border-black/60 shadow-[0_0_6px_rgba(255,255,255,0.8)]"
                  style={{ width: `max(${BALL_W}cqw, 9px)`, height: `max(${BALL_W}cqw, 9px)` }}
                />
              </div>

              {/* OUR ROBOTS: 8.5 cm squares to scale, turned to their heading (bar = front) */}
              {robots.map((bot) => {
                const isSelected = selectedBotId === bot.id;
                const isOffline = bot.status === 'OFFLINE';
                const isOccluded = bot.status === 'OCCLUDED';
                return (
                  <div
                    key={bot.id}
                    onClick={() => setSelectedBotId(bot.id)}
                    className="absolute z-20 cursor-pointer select-none"
                    style={{
                      left: `${drawX(bot.x)}%`,
                      top: `${drawY(bot.y)}%`,
                      width: `${ROBOT_W}%`,
                      aspectRatio: '1',
                      transform: `translate(-50%, -50%) ${isSelected ? 'scale(1.2)' : ''}`,
                    }}
                  >
                    <div
                      className="relative w-full h-full flex items-center justify-center shadow-md"
                      style={{
                        transform: `rotate(${bot.angle}deg)`,
                        ...(isOffline
                          ? { background: '#22252A', border: '2px dashed #8E95A5', opacity: 0.6 }
                          : { background: TEAM_COLORS.us, border: '2px solid #111317' }),
                        boxShadow: testModeActive && !isOffline ? '0 0 10px #ffc665' : undefined,
                        outline: isSelected ? '2px solid #38bdf8' : undefined,
                      }}
                    >
                      {!isOffline && <div className="absolute right-0 top-[12%] h-[76%] w-[18%] bg-[#111317]" />}
                      <span
                        className="font-bold text-[9px] leading-none"
                        style={{ transform: `rotate(${-bot.angle}deg)`, color: isOffline ? '#8E95A5' : '#111317' }}
                      >
                        {bot.id}
                      </span>
                    </div>

                    {/* vision lost: "?" badge */}
                    {isOccluded && (
                      <div
                        className="absolute -top-2 -right-2 w-3.5 h-3.5 bg-[#fabc4d] text-[#111317] font-bold text-[8px] flex items-center justify-center shadow-xs"
                        title="Vision Occluded / Lost Track"
                      >
                        ?
                      </div>
                    )}

                    <span className="absolute left-1/2 top-full -translate-x-1/2 mt-0.5 text-[9px] font-bold text-white tracking-wider whitespace-nowrap drop-shadow-xs font-mono">
                      {isOffline ? 'OFF' : bot.label}
                    </span>
                  </div>
                );
              })}

              {/* OPPONENTS: white squares to scale */}
              {opponents.map((opp) => (
                <div
                  key={opp.id}
                  className="absolute z-10 select-none pointer-events-none"
                  style={{
                    left: `${drawX(opp.x)}%`,
                    top: `${drawY(opp.y)}%`,
                    width: `${ROBOT_W}%`,
                    aspectRatio: '1',
                    transform: 'translate(-50%, -50%)',
                  }}
                >
                  <div
                    className="w-full h-full flex items-center justify-center text-[8px] font-bold leading-none"
                    style={{ background: TEAM_COLORS.them, border: '2px solid #111317', color: '#111317' }}
                  >
                    {opp.id}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom Telemetry Strip of Field Card matching Screenshot 2 */}
          <div className="mt-3 pt-3 border-t border-[#2D3139] flex flex-wrap items-center justify-between gap-3 text-xs">
            {/* Team Selector: [✓ RED] [BLUE] */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-white uppercase tracking-wider">
                TEAM:
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setSelectedTeam('RED')}
                  className={`flex items-center gap-1 px-2.5 py-1 text-xs font-bold uppercase transition-colors cursor-pointer ${
                    selectedTeam === 'RED'
                      ? 'bg-[#e54d42] text-white'
                      : 'bg-[#1e2024] text-[#8E95A5] border border-[#2D3139]'
                  }`}
                >
                  {selectedTeam === 'RED' && <Check className="w-3 h-3" />}
                  <span>RED</span>
                </button>
                <button
                  onClick={() => setSelectedTeam('BLUE')}
                  className={`flex items-center gap-1 px-2.5 py-1 text-xs font-bold uppercase transition-colors cursor-pointer ${
                    selectedTeam === 'BLUE'
                      ? 'bg-[#2563eb] text-white'
                      : 'bg-[#1e2024] text-[#8E95A5] border border-[#2D3139]'
                  }`}
                >
                  {selectedTeam === 'BLUE' && <Check className="w-3 h-3" />}
                  <span>BLUE</span>
                </button>
              </div>
            </div>

            {/* Robot Status Badges: #1 OCCLUDED, #2 ACTIVE, #3 ACTIVE, #4 OCCLUDED, #5 OFFLINE */}
            <div className="flex items-center gap-3 font-mono text-[11px]">
              {robots.map((r) => {
                const isOcc = r.status === 'OCCLUDED';
                const isOff = r.status === 'OFFLINE';
                const isAct = r.status === 'ACTIVE';

                return (
                  <div
                    key={r.id}
                    onClick={() => setSelectedBotId(r.id)}
                    className="flex flex-col items-center cursor-pointer group"
                  >
                    <div className="flex items-center gap-1">
                      <span className="font-bold text-white">#{r.id}</span>
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          isAct
                            ? 'bg-[#3DD68C]'
                            : isOcc
                            ? 'bg-[#fabc4d]'
                            : 'bg-[#8E95A5]'
                        }`}
                      />
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      {isOcc ? (
                        <span className="text-[#fabc4d] font-bold text-[10px]">
                          ?
                        </span>
                      ) : isOff ? (
                        <Bot className="w-3 h-3 text-[#8E95A5]" />
                      ) : (
                        <Bot className="w-3 h-3 text-[#3DD68C]" />
                      )}
                    </div>
                    <span
                      className={`text-[9px] font-bold uppercase tracking-tight mt-0.5 ${
                        isAct
                          ? 'text-[#3DD68C]'
                          : isOcc
                          ? 'text-[#fabc4d]'
                          : 'text-[#8E95A5]'
                      }`}
                    >
                      {r.status}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* TEST Button with Wrench icon */}
            <button
              onClick={handleTestActuators}
              disabled={testModeActive}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[#1e2024] hover:bg-[#282a2e] border border-[#2D3139] hover:border-[#fabc4d] text-[#fabc4d] text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer"
            >
              <Wrench className="w-3.5 h-3.5" />
              <span>{testModeActive ? 'TESTING...' : 'TEST'}</span>
            </button>
          </div>
        </div>

        {/* RIGHT PANE: MATCH CONTROLS (3 or 4 columns) */}
        <div className="lg:col-span-4 xl:col-span-3 min-h-0 bg-[#181A1E] flex flex-col p-4 overflow-y-auto">
          {/* Header */}
          <div className="pb-3 border-b border-[#2D3139]">
            <span className="text-xs font-bold uppercase tracking-wider text-white">
              MATCH CONTROLS
            </span>
          </div>

          {/* Action Buttons: PREPARE, START, STOP matching Screenshot 2 */}
          <div className="mt-4 space-y-3">
            {/* PREPARE BUTTON */}
            <button
              onClick={handlePrepare}
              disabled={matchState === 'PREPARING'}
              className="w-full h-11 flex items-center justify-center gap-2 bg-[#22252A] hover:bg-[#2a2e35] border border-[#2D3139] hover:border-[#fabc4d] text-[#fabc4d] font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer"
            >
              <RotateCw
                className={`w-4 h-4 ${
                  matchState === 'PREPARING' ? 'animate-spin' : ''
                }`}
              />
              <span>{matchState === 'PREPARING' ? 'PREPARING...' : 'PREPARE'}</span>
            </button>

            {/* START BUTTON (Large Yellow/Amber button from Screenshot 2) */}
            <button
              onClick={handleStart}
              className="w-full h-14 flex items-center justify-center gap-2 bg-[#ffc665] hover:bg-[#fabc4d] active:bg-[#e5a93c] text-[#111317] font-bold text-sm tracking-wider uppercase transition-colors shadow-md cursor-pointer border border-[#ffdead]/30"
            >
              <Play className="w-4 h-4 fill-[#111317] text-[#111317]" />
              <span>START</span>
            </button>

            {/* STOP BUTTON (Large Critical Red button from Screenshot 2) */}
            <button
              onClick={handleStop}
              className="w-full h-14 flex items-center justify-center gap-2 bg-[#99000a] hover:bg-[#b71c1c] active:bg-[#7f0007] text-white font-bold text-sm tracking-wider uppercase transition-colors shadow-md cursor-pointer border border-red-500/30"
            >
              <Square className="w-4 h-4 fill-white text-white" />
              <span>STOP</span>
            </button>
          </div>

          {/* PENALTY & REFEREE SECTION */}
          <div className="mt-6">
            <span className="text-xs font-bold uppercase tracking-wider text-[#8E95A5] block mb-2">
              PENALTY & REFEREE
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleRefereeCommand('PENALTY_SHOOTOUT')}
                className="px-2.5 py-2 bg-[#22252A] hover:bg-[#2c3038] border border-[#2D3139] text-[11px] font-bold text-white uppercase tracking-wide transition-colors cursor-pointer"
              >
                PENALTY
              </button>
              <button
                onClick={() => handleRefereeCommand('DIRECT_FREE_KICK')}
                className="px-2.5 py-2 bg-[#22252A] hover:bg-[#2c3038] border border-[#2D3139] text-[11px] font-bold text-white uppercase tracking-wide transition-colors cursor-pointer"
              >
                FREE KICK
              </button>
              <button
                onClick={() => handleRefereeCommand('TIMEOUT_30S')}
                className="px-2.5 py-2 bg-[#22252A] hover:bg-[#2c3038] border border-[#2D3139] text-[11px] font-bold text-white uppercase tracking-wide transition-colors cursor-pointer"
              >
                TIMEOUT 30s
              </button>
              <button
                onClick={() => handleRefereeCommand('HALT_ALL')}
                className="px-2.5 py-2 bg-[#22252A] hover:bg-[#2c3038] border border-[#2D3139] text-[11px] font-bold text-white uppercase tracking-wide transition-colors cursor-pointer"
              >
                HALT
              </button>
            </div>
          </div>

          {/* Selected Robot Telemetry Inspector */}
          {selectedBotId !== null && (
            <div className="mt-5 p-3 bg-[#0F1115] border border-[#2D3139]">
              {(() => {
                const b = robots.find((r) => r.id === selectedBotId)!;
                return (
                  <div>
                    <div className="flex items-center justify-between text-xs font-bold pb-2 border-b border-[#2D3139]">
                      <span className="text-[#fabc4d]">{b.label} TELEMETRY</span>
                      <span className="text-white text-[11px]">{b.role}</span>
                    </div>
                    <div className="mt-2 space-y-1.5 text-[11px] font-mono text-[#8E95A5]">
                      <div className="flex justify-between">
                        <span>BATTERY:</span>
                        <span className="text-white font-bold">{b.battery}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span>HEADING ANGLE:</span>
                        <span className="text-white font-bold">{b.angle}°</span>
                      </div>
                      <div className="flex justify-between">
                        <span>RADIO RSSI:</span>
                        <span className="text-white font-bold">{b.rssi} dBm</span>
                      </div>
                      <div className="flex justify-between">
                        <span>STATUS:</span>
                        <span
                          className={`font-bold ${
                            b.status === 'ACTIVE'
                              ? 'text-[#3DD68C]'
                              : b.status === 'OCCLUDED'
                              ? 'text-[#fabc4d]'
                              : 'text-red-400'
                          }`}
                        >
                          {b.status}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Live Referee & Vision Event Terminal */}
          <div className="mt-auto pt-4">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#8E95A5] block mb-1">
              LIVE SYSTEM AUDIT
            </span>
            <div className="h-32 bg-[#0F1115] border border-[#2D3139] p-2 font-mono text-[10px] text-[#8E95A5] overflow-y-auto space-y-1">
              {eventLogs.map((log, idx) => (
                <div key={idx} className="leading-tight">
                  {log}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

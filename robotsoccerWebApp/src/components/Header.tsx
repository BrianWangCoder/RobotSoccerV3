import React from 'react';
import {
  Home,
  Cpu,
  Play,
  Box,
  LogOut,
  HelpCircle,
  Settings,
  Hexagon,
} from 'lucide-react';

export type ActiveScreen = 'home' | 'strategy' | 'play' | 'simulation';

interface HeaderProps {
  currentScreen: ActiveScreen;
  onNavigate: (screen: ActiveScreen) => void;
  hostIp: string;
  onOpenSetup: () => void;
  onOpenHelp: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentScreen,
  onNavigate,
  hostIp,
  onOpenSetup,
  onOpenHelp,
}) => {
  if (currentScreen === 'home') {
    return (
      <header className="h-14 border-b border-[#2D3139] bg-[#111317] px-4 md:px-6 flex items-center justify-between select-none">
        {/* Left Side: System status & help */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1 bg-[#1a1c20] border border-[#504535] text-[#fabc4d] text-xs font-bold uppercase tracking-wider">
            <Hexagon className="w-3.5 h-3.5 fill-[#fabc4d]/20" />
            <span>SYS: CONNECTED</span>
          </div>

          <button
            onClick={onOpenHelp}
            aria-label="Help"
            className="w-7 h-7 flex items-center justify-center bg-[#1e2024] border border-[#2D3139] text-[#e2e2e8] hover:text-[#fabc4d] hover:border-[#fabc4d] transition-colors"
          >
            <HelpCircle className="w-3.5 h-3.5" />
          </button>

          <div
            className="w-3 h-3 bg-[#3DD68C] shadow-[0_0_8px_#3DD68C]"
            title="System Active Beacon"
          />
        </div>

        {/* Right Side: Host IP & Setup */}
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-xs font-bold text-[#3DD68C] tracking-wider font-mono">
              HOST: {hostIp}
            </div>
            <div className="text-[10px] text-[#3DD68C]/80 tracking-widest uppercase font-mono">
              SSL-VISION ACTIVE
            </div>
          </div>

          <button
            onClick={onOpenSetup}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1e2024] border border-[#2D3139] hover:border-[#fabc4d] text-[#fabc4d] text-xs font-bold uppercase tracking-wider transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
            <span>SETUP</span>
          </button>
        </div>
      </header>
    );
  }

  // Header for Strategy Builder, Live Play, and Simulation
  const subTitle =
    currentScreen === 'strategy'
      ? 'STRATEGY BUILDER'
      : currentScreen === 'play'
      ? 'LIVE PLAY'
      : 'SIMULATION';

  return (
    <header className="h-14 border-b border-[#2D3139] bg-[#111317] px-4 md:px-6 flex items-center justify-between select-none">
      {/* Brand logo & screen title */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => onNavigate('home')}
          className="flex items-center gap-2 hover:opacity-90 transition-opacity"
        >
          <div className="w-6 h-6 flex items-center justify-center bg-[#fabc4d] text-[#111317] font-bold">
            <Hexagon className="w-4 h-4" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm md:text-base font-bold tracking-wider text-[#fabc4d]">
              ROBOT SOCCER
            </span>
            <span className="text-[#8E95A5] text-sm">|</span>
            <span className="text-xs md:text-sm font-bold tracking-wider text-[#e2e2e8] uppercase">
              {subTitle}
            </span>
          </div>
        </button>
      </div>

      {/* Navigation tabs */}
      <nav className="flex items-center gap-1.5 md:gap-2">
        <button
          onClick={() => onNavigate('home')}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-[#8E95A5] hover:text-[#e2e2e8] transition-colors"
        >
          <Home className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">HOME</span>
        </button>

        <button
          onClick={() => onNavigate('strategy')}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors ${
            currentScreen === 'strategy'
              ? 'bg-[#fabc4d] text-[#111317]'
              : 'text-[#8E95A5] hover:text-[#e2e2e8]'
          }`}
        >
          <Cpu className="w-3.5 h-3.5" />
          <span>STRATEGY</span>
        </button>

        <button
          onClick={() => onNavigate('play')}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors ${
            currentScreen === 'play'
              ? 'bg-[#fabc4d] text-[#111317]'
              : 'text-[#8E95A5] hover:text-[#e2e2e8]'
          }`}
        >
          <Play className="w-3.5 h-3.5" />
          <span>PLAY</span>
        </button>

        <button
          onClick={() => onNavigate('simulation')}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors ${
            currentScreen === 'simulation'
              ? 'bg-[#fabc4d] text-[#111317]'
              : 'text-[#8E95A5] hover:text-[#e2e2e8]'
          }`}
        >
          <Box className="w-3.5 h-3.5" />
          <span>SIMULATION</span>
        </button>

        <div className="h-4 w-px bg-[#2D3139] mx-1" />

        <button
          onClick={() => onNavigate('home')}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-[#e2e2e8] border border-[#2D3139] hover:border-[#fabc4d] hover:text-[#fabc4d] transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">EXIT TO HOME</span>
        </button>
      </nav>
    </header>
  );
};

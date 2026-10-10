import React from 'react';
import { Cpu, Play, Box, ArrowRight } from 'lucide-react';
import { ActiveScreen } from './Header';

interface HomeViewProps {
  onNavigate: (screen: ActiveScreen) => void;
}

export const HomeView: React.FC<HomeViewProps> = ({ onNavigate }) => {
  return (
    <div className="relative flex-1 w-full flex flex-col items-center justify-center overflow-hidden bg-[#0F1115] select-none min-h-[calc(100vh-3.5rem)]">
      {/* Background Tactical Soccer Pitch Markings (Faint Vector lines matching screenshot) */}
      <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-30">
        <svg
          viewBox="0 0 1000 650"
          className="w-[95%] max-w-[1200px] h-auto stroke-[#28352b] stroke-[1.5] fill-none"
        >
          {/* Outer Boundary */}
          <rect x="50" y="40" width="900" height="570" />
          {/* Halfway Line */}
          <line x1="500" y1="40" x2="500" y2="610" />
          {/* Center Circle */}
          <circle cx="500" cy="325" r="100" />
          {/* Center Spot */}
          <circle cx="500" cy="325" r="3" fill="#28352b" />
          
          {/* Left Penalty Box */}
          <rect x="50" y="175" width="160" height="300" />
          {/* Left Goal Area */}
          <rect x="50" y="235" width="60" height="180" />
          {/* Left Penalty Spot */}
          <circle cx="160" cy="325" r="3" fill="#28352b" />
          {/* Left Penalty Arc */}
          <path d="M 210 270 A 90 90 0 0 1 210 380" />

          {/* Right Penalty Box */}
          <rect x="790" y="175" width="160" height="300" />
          {/* Right Goal Area */}
          <rect x="890" y="235" width="60" height="180" />
          {/* Right Penalty Spot */}
          <circle cx="840" cy="325" r="3" fill="#28352b" />
          {/* Right Penalty Arc */}
          <path d="M 790 270 A 90 90 0 0 0 790 380" />

          {/* Corner Arcs */}
          <path d="M 50 65 A 25 25 0 0 0 75 40" />
          <path d="M 50 585 A 25 25 0 0 1 75 610" />
          <path d="M 950 65 A 25 25 0 0 1 925 40" />
          <path d="M 950 585 A 25 25 0 0 0 925 610" />
        </svg>
      </div>

      {/* Hero Title & Primary Action Buttons */}
      <div className="relative z-10 w-full max-w-[520px] px-6 flex flex-col items-center">
        {/* Large Tactical Logo */}
        <div className="mb-12 text-center">
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight uppercase flex items-center justify-center gap-3">
            <span className="text-[#fabc4d] drop-shadow-[0_0_12px_rgba(250,188,77,0.35)]">
              ROBOT
            </span>
            <span
              className="text-white relative"
              style={{
                textShadow:
                  '-1.5px 0px rgba(56,189,248,0.7), 1.5px 0px rgba(244,63,94,0.7)',
              }}
            >
              SOCCER
            </span>
          </h1>
          <div className="text-[11px] font-mono tracking-widest text-[#8E95A5] mt-2 uppercase">
            AUTONOMOUS SSL TACTICAL WORKBENCH
          </div>
        </div>

        {/* 3 Large Action Cards (Stacked Amber Buttons from Screenshot) */}
        <div className="w-full space-y-4">
          {/* 1. STRATEGY */}
          <button
            onClick={() => onNavigate('strategy')}
            className="w-full h-15 px-6 flex items-center justify-between bg-[#fabc4d] hover:bg-[#ffc665] active:bg-[#e5a93c] text-[#111317] font-bold text-base md:text-lg tracking-wider transition-all duration-150 shadow-md group cursor-pointer border border-[#ffdead]/30"
          >
            <div className="flex items-center gap-4">
              <Cpu className="w-5 h-5 text-[#111317] stroke-[2.2]" />
              <span className="uppercase">STRATEGY</span>
            </div>
            <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
          </button>

          {/* 2. PLAY */}
          <button
            onClick={() => onNavigate('play')}
            className="w-full h-15 px-6 flex items-center justify-between bg-[#fabc4d] hover:bg-[#ffc665] active:bg-[#e5a93c] text-[#111317] font-bold text-base md:text-lg tracking-wider transition-all duration-150 shadow-md group cursor-pointer border border-[#ffdead]/30"
          >
            <div className="flex items-center gap-4">
              <Play className="w-5 h-5 fill-[#111317] text-[#111317]" />
              <span className="uppercase">PLAY</span>
            </div>
            <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
          </button>

          {/* 3. SIMULATION */}
          <button
            onClick={() => onNavigate('simulation')}
            className="w-full h-15 px-6 flex items-center justify-between bg-[#fabc4d] hover:bg-[#ffc665] active:bg-[#e5a93c] text-[#111317] font-bold text-base md:text-lg tracking-wider transition-all duration-150 shadow-md group cursor-pointer border border-[#ffdead]/30"
          >
            <div className="flex items-center gap-4">
              <Box className="w-5 h-5 text-[#111317] stroke-[2.2]" />
              <span className="uppercase">SIMULATION</span>
            </div>
            <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
          </button>
        </div>

        {/* Tactical Sub-Telemetry Footer */}
        <div className="mt-12 flex items-center justify-between w-full text-[11px] font-mono text-[#8E95A5] border-t border-[#2D3139]/50 pt-3">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 bg-[#3DD68C]" />
            <span>5 BOT TRANSCEIVERS LINKED</span>
          </div>
          <div>PROTOCOL: SSL-2026.4</div>
        </div>
      </div>
    </div>
  );
};

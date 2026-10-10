import React from 'react';
import { X, HelpCircle, Bot, Cpu, Play, Box } from 'lucide-react';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4">
      <div className="w-full max-w-lg bg-[#181A1E] border border-[#2D3139] text-[#e2e2e8] shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2D3139] bg-[#22252A]">
          <div className="flex items-center gap-2">
            <HelpCircle className="w-4 h-4 text-[#fabc4d]" />
            <span className="text-xs font-bold uppercase tracking-wider text-[#ffc665]">
              ROBOT SOCCER USER GUIDE
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-[#8E95A5] hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 text-xs text-[#8E95A5] leading-relaxed">
          <div className="flex items-start gap-3 p-2.5 bg-[#0F1115] border border-[#2D3139]">
            <Cpu className="w-5 h-5 text-[#fabc4d] shrink-0 mt-0.5" />
            <div>
              <strong className="text-white block uppercase mb-1">
                Strategy Builder
              </strong>
              Define situational pitch zones by clicking grid points or dragging boundaries. Stack Scratch-style motion, tactical, and kicking blocks onto robot hats to program autonomous routines.
            </div>
          </div>

          <div className="flex items-start gap-3 p-2.5 bg-[#0F1115] border border-[#2D3139]">
            <Play className="w-5 h-5 text-[#3DD68C] shrink-0 mt-0.5" />
            <div>
              <strong className="text-white block uppercase mb-1">
                Live Play View
              </strong>
              Connect to optical SSL-Vision overhead cameras and radio transceivers. Monitor active robot telemetry, occluded beacons, and issue referee commands (Prepare, Start, Stop, Penalties).
            </div>
          </div>

          <div className="flex items-start gap-3 p-2.5 bg-[#0F1115] border border-[#2D3139]">
            <Box className="w-5 h-5 text-[#3b82f6] shrink-0 mt-0.5" />
            <div>
              <strong className="text-white block uppercase mb-1">
                Physics Simulation
              </strong>
              Run full 2D kinematics drills against automated opponent formations to validate your strategy before putting real hardware on the field.
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-[#2D3139] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-[#fabc4d] hover:bg-[#ffc665] text-[#111317] font-bold text-xs uppercase"
          >
            GOT IT
          </button>
        </div>
      </div>
    </div>
  );
};

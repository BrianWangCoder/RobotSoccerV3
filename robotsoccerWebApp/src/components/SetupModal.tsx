import React, { useState } from 'react';
import { X, Wifi, Radio, Server, Check } from 'lucide-react';

interface SetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  hostIp: string;
  onSaveHostIp: (ip: string) => void;
}

export const SetupModal: React.FC<SetupModalProps> = ({
  isOpen,
  onClose,
  hostIp,
  onSaveHostIp,
}) => {
  const [ip, setIp] = useState(hostIp);
  const [visionPort, setVisionPort] = useState('10006');
  const [refPort, setRefPort] = useState('10003');
  const [channel, setChannel] = useState('2.4 GHz (CH 11)');
  const [saved, setSaved] = useState(false);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveHostIp(ip);
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4">
      <div className="w-full max-w-md bg-[#181A1E] border border-[#2D3139] text-[#e2e2e8] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2D3139] bg-[#22252A]">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-[#fabc4d]" />
            <span className="text-xs font-bold uppercase tracking-wider text-[#ffc665]">
              SSL-VISION & RADIO SETUP
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-[#8E95A5] hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSave} className="p-4 space-y-4">
          <div>
            <label className="block text-[11px] font-bold uppercase text-[#8E95A5] mb-1">
              SSL-VISION MULTICAST HOST IP
            </label>
            <div className="flex items-center bg-[#0F1115] border border-[#2D3139] focus-within:border-[#fabc4d] px-3 py-2">
              <Wifi className="w-4 h-4 text-[#fabc4d] mr-2 shrink-0" />
              <input
                type="text"
                value={ip}
                onChange={(e) => setIp(e.target.value)}
                className="w-full bg-transparent text-sm text-white font-mono focus:outline-hidden"
                placeholder="192.168.1.104"
              />
            </div>
            <span className="text-[10px] text-[#8E95A5] mt-1 block">
              Default SSL-Vision optical tracking broadcast endpoint
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold uppercase text-[#8E95A5] mb-1">
                VISION PORT
              </label>
              <input
                type="text"
                value={visionPort}
                onChange={(e) => setVisionPort(e.target.value)}
                className="w-full bg-[#0F1115] border border-[#2D3139] px-3 py-2 text-sm text-white font-mono focus:border-[#fabc4d] focus:outline-hidden"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase text-[#8E95A5] mb-1">
                REFEREE PORT
              </label>
              <input
                type="text"
                value={refPort}
                onChange={(e) => setRefPort(e.target.value)}
                className="w-full bg-[#0F1115] border border-[#2D3139] px-3 py-2 text-sm text-white font-mono focus:border-[#fabc4d] focus:outline-hidden"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase text-[#8E95A5] mb-1">
              ROBOT RADIO TRANSCEIVER BAND
            </label>
            <div className="flex items-center bg-[#0F1115] border border-[#2D3139] px-3 py-2">
              <Radio className="w-4 h-4 text-[#3DD68C] mr-2 shrink-0" />
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                className="w-full bg-transparent text-sm text-white font-mono focus:outline-hidden"
              >
                <option value="2.4 GHz (CH 11)" className="bg-[#181A1E]">2.4 GHz (CH 11 - Primary)</option>
                <option value="2.4 GHz (CH 18)" className="bg-[#181A1E]">2.4 GHz (CH 18 - Backup)</option>
                <option value="868 MHz ISM" className="bg-[#181A1E]">868 MHz ISM (Sub-GHz)</option>
              </select>
            </div>
          </div>

          <div className="p-2.5 bg-[#0F1115] border border-[#2D3139] text-[11px] text-[#8E95A5] flex items-center justify-between">
            <span>PACKET STATUS:</span>
            <span className="text-[#3DD68C] font-bold">100% RECEIVED (60 FPS)</span>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#2D3139]">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-[#8E95A5] hover:text-white border border-[#2D3139] hover:border-white transition-colors"
            >
              CANCEL
            </button>
            <button
              type="submit"
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold uppercase tracking-wider bg-[#fabc4d] hover:bg-[#ffc665] text-[#111317] transition-colors"
            >
              {saved ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  APPLIED
                </>
              ) : (
                'SAVE SETTINGS'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

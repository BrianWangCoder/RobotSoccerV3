import React, { useEffect, useState } from 'react';
import { X, Wifi, Server, Check, Activity } from 'lucide-react';
import { mainUrl, pingMain } from '../utils/sendToMain';

interface SetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  hostIp: string;
  onSaveHostIp: (ip: string) => void;
}

type TestState = { kind: 'idle' } | { kind: 'busy' } | { kind: 'ok' | 'err'; msg: string };

export const SetupModal: React.FC<SetupModalProps> = ({ isOpen, onClose, hostIp, onSaveHostIp }) => {
  const [ip, setIp] = useState(hostIp);
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: 'idle' });

  // Show the current value every time the dialog opens (drops unsaved edits from last time)
  useEffect(() => {
    if (isOpen) {
      setIp(hostIp);
      setTest({ kind: 'idle' });
    }
  }, [isOpen, hostIp]);

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

  const handleTest = async () => {
    setTest({ kind: 'busy' });
    try {
      const r = await pingMain(ip);
      setTest({
        kind: 'ok',
        msg: `Connected · ${r.strategy ? `has ${r.strategy}` : 'no strategy yet'}${r.running ? ' · MATCH RUNNING' : ''}`,
      });
    } catch (err) {
      setTest({ kind: 'err', msg: (err as Error).message });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4">
      <div className="w-full max-w-md bg-[#181A1E] border border-[#2D3139] text-[#e2e2e8] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2D3139] bg-[#22252A]">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-[#fabc4d]" />
            <span className="text-xs font-bold uppercase tracking-wider text-[#ffc665]">
              MAIN MACHINE SETUP
            </span>
          </div>
          <button onClick={onClose} className="text-[#8E95A5] hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSave} className="p-4 space-y-4">
          <div>
            <label className="block text-[11px] font-bold uppercase text-[#8E95A5] mb-1">
              MAIN MACHINE IP
            </label>
            <div className="flex items-center bg-[#0F1115] border border-[#2D3139] focus-within:border-[#fabc4d] px-3 py-2">
              <Wifi className="w-4 h-4 text-[#fabc4d] mr-2 shrink-0" />
              <input
                type="text"
                value={ip}
                onChange={(e) => {
                  setIp(e.target.value);
                  setTest({ kind: 'idle' });
                }}
                className="w-full bg-transparent text-sm text-white font-mono focus:outline-hidden"
                placeholder="192.168.1.104"
              />
            </div>
            <span className="text-[10px] text-[#8E95A5] mt-1 block">
              The computer running <span className="font-mono text-white">npm run server</span> — strategies go to{' '}
              <span className="font-mono text-white">{mainUrl(ip || '…')}</span>. On the main machine itself use{' '}
              <span className="font-mono text-white">127.0.0.1</span>.
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleTest}
              disabled={test.kind === 'busy' || !ip.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-[#3DD68C] border border-[#3DD68C]/60 hover:border-[#3DD68C] transition-colors disabled:opacity-60"
            >
              <Activity className={`w-3.5 h-3.5 ${test.kind === 'busy' ? 'animate-pulse' : ''}`} />
              {test.kind === 'busy' ? 'TESTING…' : 'TEST CONNECTION'}
            </button>
          </div>
          {(test.kind === 'ok' || test.kind === 'err') && (
            <div
              className={`p-2.5 border text-[11px] font-mono ${
                test.kind === 'ok'
                  ? 'bg-[#0F1115] border-[#3DD68C]/50 text-[#3DD68C]'
                  : 'bg-red-950/30 border-red-800 text-red-400'
              }`}
            >
              {test.msg}
            </div>
          )}

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

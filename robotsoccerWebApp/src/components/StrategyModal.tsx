import React, { useState } from 'react';
import { X, Upload, Download, Check, FileCode, Plus } from 'lucide-react';
import { StrategyConfig } from '../types/strategy';

interface StrategyModalProps {
  isOpen: boolean;
  mode: 'saveAs' | 'import' | null;
  onClose: () => void;
  currentStrategy: StrategyConfig;
  onSelectStrategy: (strat: StrategyConfig) => void;
  onSaveAs: (filename: string, name: string) => void;
}

export const StrategyModal: React.FC<StrategyModalProps> = ({
  isOpen,
  mode,
  onClose,
  currentStrategy,
  onSelectStrategy,
  onSaveAs,
}) => {
  const [newFilename, setNewFilename] = useState<string>(
    `custom_strategy_${Date.now().toString().slice(-4)}.json`
  );
  const [newName, setNewName] = useState<string>('Custom Strategy');
  const [importJsonText, setImportJsonText] = useState<string>('');
  const [importError, setImportError] = useState<string | null>(null);

  if (!isOpen || !mode) return null;

  const handleSaveAsSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFilename.endsWith('.json')) {
      onSaveAs(`${newFilename}.json`, newName);
    } else {
      onSaveAs(newFilename, newName);
    }
    onClose();
  };

  const handleJsonTextImport = () => {
    try {
      setImportError(null);
      const parsed = JSON.parse(importJsonText);
      if (!parsed.routines || !parsed.filename) {
        throw new Error('Invalid strategy structure: missing routines or filename.');
      }
      onSelectStrategy(parsed);
      onClose();
    } catch (err: any) {
      setImportError(err.message || 'Invalid JSON format.');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const parsed = JSON.parse(content);
        onSelectStrategy(parsed);
        onClose();
      } catch (err) {
        setImportError('Failed to parse uploaded JSON file.');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4">
      <div className="w-full max-w-lg bg-[#181A1E] border border-[#2D3139] text-[#e2e2e8] shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2D3139] bg-[#22252A]">
          <div className="flex items-center gap-2">
            <FileCode className="w-4 h-4 text-[#fabc4d]" />
            <span className="text-xs font-bold uppercase tracking-wider text-[#ffc665]">
              {mode === 'saveAs'
                ? 'SAVE STRATEGY AS NEW FILE'
                : 'IMPORT / LOAD STRATEGY'}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-[#8E95A5] hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        {mode === 'saveAs' ? (
          <form onSubmit={handleSaveAsSubmit} className="p-4 space-y-4">
            <div>
              <label className="block text-[11px] font-bold uppercase text-[#8E95A5] mb-1">
                STRATEGY FILENAME (.JSON)
              </label>
              <input
                type="text"
                value={newFilename}
                onChange={(e) => setNewFilename(e.target.value)}
                className="w-full bg-[#0F1115] border border-[#2D3139] px-3 py-2 text-sm text-white font-mono focus:border-[#fabc4d] focus:outline-hidden"
                placeholder="strategy_custom_01.json"
                required
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase text-[#8E95A5] mb-1">
                DISPLAY NAME
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full bg-[#0F1115] border border-[#2D3139] px-3 py-2 text-sm text-white font-mono focus:border-[#fabc4d] focus:outline-hidden"
                placeholder="Custom Press Formation"
                required
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#2D3139]">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-[#8E95A5] hover:text-white border border-[#2D3139]"
              >
                CANCEL
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-bold uppercase tracking-wider bg-[#fabc4d] hover:bg-[#ffc665] text-[#111317]"
              >
                SAVE AS
              </button>
            </div>
          </form>
        ) : (
          <div className="p-4 space-y-4">
            {/* File Upload */}
            <div>
              <span className="block text-[11px] font-bold uppercase text-[#8E95A5] mb-2">
                UPLOAD FROM COMPUTER:
              </span>
              <label className="flex items-center justify-center gap-2 p-3 bg-[#0F1115] border border-dashed border-[#2D3139] hover:border-[#fabc4d] text-[#8E95A5] hover:text-white text-xs font-bold uppercase cursor-pointer transition-colors">
                <Upload className="w-4 h-4 text-[#fabc4d]" />
                <span>CHOOSE JSON FILE</span>
                <input
                  type="file"
                  accept=".json"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>

            {importError && (
              <div className="text-red-400 text-xs font-mono p-2 bg-red-950/30 border border-red-800">
                {importError}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

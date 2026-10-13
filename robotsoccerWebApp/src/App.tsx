import React, { useEffect, useRef, useState } from 'react';
import { Header, ActiveScreen } from './components/Header';
import { HomeView } from './components/HomeView';
import { StrategyBuilderView } from './components/StrategyBuilderView';
import { LivePlayView } from './components/LivePlayView';
import { SimulationView } from './components/SimulationView';
import { SetupModal } from './components/SetupModal';
import { HelpModal } from './components/HelpModal';
import { StrategyModal } from './components/StrategyModal';
import { createBlankStrategy } from './data/defaultStrategies';
import { StrategyConfig } from './types/strategy';
import { Check } from 'lucide-react';
import {
  StrategyFileHandle,
  canSaveInPlace,
  downloadFile,
  isCancel,
  pickOpenFile,
  pickSaveFile,
  writeToFile,
} from './utils/fileAccess';

/** Blocks that no longer exist (e.g. KickB) are dropped from strategies loaded from a file. */
const REMOVED_BLOCKS = new Set(['kickB']);
const withoutRemovedBlocks = (s: StrategyConfig): StrategyConfig => ({
  ...s,
  routines: (s.routines ?? []).map((r) => ({
    ...r,
    blocks: (r.blocks ?? []).filter((b) => !REMOVED_BLOCKS.has(b.type as string)),
  })),
});

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<ActiveScreen>('home');
  const [hostIp, setHostIp] = useState<string>('192.168.1.104');
  const [strategy, setStrategy] = useState<StrategyConfig>(createBlankStrategy);

  // Modals state
  const [isSetupOpen, setIsSetupOpen] = useState<boolean>(false);
  const [isHelpOpen, setIsHelpOpen] = useState<boolean>(false);
  const [strategyModalMode, setStrategyModalMode] = useState<
    'saveAs' | 'import' | null
  >(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, msg.length > 60 ? 7000 : 2500); // longer messages stay up longer
  };

  // The file on the computer this strategy is linked to (Chrome / Edge). Save writes straight
  // back into it; it's set by the first Save, by Save As, or by opening a file.
  const fileRef = useRef<StrategyFileHandle | null>(null);

  /** Writes `strat` into the linked file, asking where to save first if there isn't one yet. */
  const saveTo = async (strat: StrategyConfig, askWhere: boolean) => {
    const text = JSON.stringify(strat, null, 2);
    if (!canSaveInPlace()) {
      downloadFile(strat.filename, text); // can't write into files here: download a copy
      showToast(
        window.isSecureContext
          ? `Downloaded ${strat.filename} — this browser can't save into the same file (use Chrome or Edge)`
          : `Downloaded ${strat.filename} — to save into the same file, open the app at http://localhost:3000 or with npm run dev:https`
      );
      return;
    }
    try {
      if (askWhere || !fileRef.current) fileRef.current = await pickSaveFile(strat.filename);
      const handle = fileRef.current;
      const saved = handle.name !== strat.filename ? { ...strat, filename: handle.name } : strat;
      await writeToFile(handle, JSON.stringify(saved, null, 2));
      if (saved !== strat) setStrategy(saved);
      showToast(`Saved to ${handle.name}`);
    } catch (err) {
      if (isCancel(err)) return; // closed the dialog — nothing to do
      showToast(`Couldn't save: ${(err as Error).message}`);
    }
  };

  const handleSaveStrategy = () => saveTo(strategy, false);

  // Ctrl/Cmd+S = Save (instead of the browser saving the web page)
  const saveRef = useRef(handleSaveStrategy);
  saveRef.current = handleSaveStrategy;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleSaveAsStrategy = (filename: string, name: string) => {
    const updated: StrategyConfig = {
      ...strategy,
      id: `strat_${Date.now()}`,
      filename,
      name,
    };
    setStrategy(updated);
    // a new file: ask where, then that becomes the file Save writes to
    saveTo(updated, true);
  };

  /** Import through the browser's Open dialog so the file stays linked for Save (Chrome / Edge). */
  const handleOpenFromComputer = async () => {
    try {
      const { handle, text } = await pickOpenFile();
      const parsed = JSON.parse(text) as StrategyConfig;
      if (!parsed.routines) throw new Error('That file is not a strategy (no routines).');
      fileRef.current = handle;
      setStrategy(withoutRemovedBlocks({ ...parsed, filename: handle.name }));
      showToast(`Opened ${handle.name} — Save now writes back into it`);
      return true;
    } catch (err) {
      if (isCancel(err)) return false;
      showToast(`Couldn't open: ${(err as Error).message}`);
      return false;
    }
  };

  return (
    <div
      className={`min-h-screen w-full flex flex-col bg-[#0F1115] text-[#e2e2e8] font-['Space_Mono',monospace] ${
        // Simulation and Play fit the window exactly on desktop (no page scroll)
        currentScreen === 'simulation' || currentScreen === 'play' ? 'lg:h-dvh lg:min-h-0' : ''
      }`}
    >
      {/* Top Header Bar */}
      <Header
        currentScreen={currentScreen}
        onNavigate={setCurrentScreen}
        hostIp={hostIp}
        onOpenSetup={() => setIsSetupOpen(true)}
        onOpenHelp={() => setIsHelpOpen(true)}
      />

      {/* Main Screen Views */}
      <main className="flex-1 min-h-0 flex flex-col w-full overflow-hidden">
        {currentScreen === 'home' && (
          <HomeView onNavigate={setCurrentScreen} />
        )}

        {currentScreen === 'strategy' && (
          <StrategyBuilderView
            strategy={strategy}
            onUpdateStrategy={setStrategy}
            onSaveStrategy={handleSaveStrategy}
            onSaveAsStrategy={() => setStrategyModalMode('saveAs')}
            onImportStrategy={() => setStrategyModalMode('import')}
            onTestInSimulation={() => setCurrentScreen('simulation')}
          />
        )}

        {currentScreen === 'play' && (
          <LivePlayView
            strategy={strategy}
            onImportStrategy={() => setStrategyModalMode('import')}
          />
        )}

        {currentScreen === 'simulation' && (
          <SimulationView
            strategy={strategy}
            onEditStrategy={() => setCurrentScreen('strategy')}
          />
        )}
      </main>

      {/* Global Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 bg-[#181A1E] border border-[#fabc4d] text-[#fabc4d] text-xs font-bold shadow-2xl animate-fade-in font-mono">
          <Check className="w-4 h-4 text-[#3DD68C]" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Modals */}
      <SetupModal
        isOpen={isSetupOpen}
        onClose={() => setIsSetupOpen(false)}
        hostIp={hostIp}
        onSaveHostIp={setHostIp}
      />

      <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />

      <StrategyModal
        isOpen={strategyModalMode !== null}
        mode={strategyModalMode}
        onClose={() => setStrategyModalMode(null)}
        currentStrategy={strategy}
        onSelectStrategy={(newStrat) => {
          fileRef.current = null; // loaded without a file link (pasted JSON / plain upload)
          setStrategy(withoutRemovedBlocks(newStrat));
          showToast(`Loaded ${newStrat.filename}`);
        }}
        onSaveAs={handleSaveAsStrategy}
        onOpenFromComputer={canSaveInPlace() ? handleOpenFromComputer : undefined}
      />
    </div>
  );
}
import React, { useState } from 'react';
import { Header, ActiveScreen } from './components/Header';
import { HomeView } from './components/HomeView';
import { StrategyBuilderView } from './components/StrategyBuilderView';
import { LivePlayView } from './components/LivePlayView';
import { SimulationView } from './components/SimulationView';
import { SetupModal } from './components/SetupModal';
import { HelpModal } from './components/HelpModal';
import { StrategyModal } from './components/StrategyModal';
import { defaultDefensiveStrategy } from './data/defaultStrategies';
import { StrategyConfig } from './types/strategy';
import { Check } from 'lucide-react';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<ActiveScreen>('home');
  const [hostIp, setHostIp] = useState<string>('192.168.1.104');
  const [strategy, setStrategy] = useState<StrategyConfig>(
    defaultDefensiveStrategy
  );

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
    }, 2500);
  };

  const handleSaveStrategy = () => {
    // Generate JSON and trigger browser download
    const dataStr =
      'data:text/json;charset=utf-8,' +
      encodeURIComponent(JSON.stringify(strategy, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', strategy.filename);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();

    showToast(`Saved to ${strategy.filename}`);
  };

  const handleSaveAsStrategy = (filename: string, name: string) => {
    const updated: StrategyConfig = {
      ...strategy,
      id: `strat_${Date.now()}`,
      filename,
      name,
    };
    setStrategy(updated);
    showToast(`Saved new file: ${filename}`);
  };

  return (
    <div className="min-h-screen w-full flex flex-col bg-[#0F1115] text-[#e2e2e8] font-['Space_Mono',monospace]">
      {/* Top Header Bar */}
      <Header
        currentScreen={currentScreen}
        onNavigate={setCurrentScreen}
        hostIp={hostIp}
        onOpenSetup={() => setIsSetupOpen(true)}
        onOpenHelp={() => setIsHelpOpen(true)}
      />

      {/* Main Screen Views */}
      <main className="flex-1 flex flex-col w-full overflow-hidden">
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
          setStrategy(newStrat);
          showToast(`Loaded ${newStrat.filename}`);
        }}
        onSaveAs={handleSaveAsStrategy}
      />
    </div>
  );
}
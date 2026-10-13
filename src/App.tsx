import React, { useEffect, useState } from 'react';
import { registerLanguageSafety } from './i18n/safety';
import { readLanguage, t } from './i18n';
import { Header } from './components/Header';
import { LocationInspectionPage, hasUnsavedInspectionDrafts } from './pages/LocationInspectionPage';
import { DeviceTestPage } from './pages/DeviceTestPage';
import { ArchitecturePage } from './pages/ArchitecturePage';
import { WMSImportPage } from './pages/WMSImportPage';
import { InspectionExportPage } from './pages/InspectionExportPage';
import { HallId } from './types';

export const App: React.FC = () => {
  useEffect(() => {
    document.documentElement.lang = readLanguage();
    document.title = t('siteTitle');
    document.documentElement.dir = 'ltr'; // Never mirror PDA controls.
    return registerLanguageSafety('cached-inspection-drafts', {
      dirty: hasUnsavedInspectionDrafts,
      busy: () => false,
    });
  }, []);
  const [currentHall, setCurrentHall] = useState<HallId>('H1');
  const [activeView, setActiveView] = useState<'inspect' | 'test' | 'import' | 'export' | 'arch'>('inspect');

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans">
      <Header
        currentHall={currentHall}
        onSelectHall={setCurrentHall}
        activeView={activeView}
        onSelectView={setActiveView}
      />

      <main className="flex-1 pb-4">
        {activeView === 'inspect' && (
          <LocationInspectionPage
            currentHall={currentHall}
            onOpenImport={() => setActiveView('import')}
            onOpenTest={() => setActiveView('test')}
          />
        )}
        {activeView === 'import' && <WMSImportPage currentHall={currentHall} />}
        {activeView === 'export' && <InspectionExportPage currentHall={currentHall} />}
        {activeView === 'test' && <DeviceTestPage />}
        {activeView === 'arch' && <ArchitecturePage />}
      </main>

      <footer className="text-center py-2.5 text-[11px] text-slate-400 border-t border-slate-200 bg-white">
        {t('footerTitle')} &copy; {new Date().getFullYear()} &middot; {t('currentHallLabel')} {currentHall}
      </footer>
    </div>
  );
};

export default App;

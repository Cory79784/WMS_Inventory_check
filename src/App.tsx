import {hasSkuCountDrafts,flushSkuCountDrafts} from './skuCount/session';
import React, { useEffect, useState, useRef, lazy, Suspense } from 'react';
import { registerLanguageSafety, languageSafety } from './i18n/safety';
import { confirmPdaExit } from './utils/exitPrompt';
import { consumeApprovedLanguageReload } from './i18n/switch';
import { readLanguage, t } from './i18n';
import { Header } from './components/Header';
import { LocationInspectionPage, hasUnsavedInspectionDrafts, flushInspectionDrafts } from './pages/LocationInspectionPage';
import { DeviceTestPage } from './pages/DeviceTestPage';
import { ArchitecturePage } from './pages/ArchitecturePage';
import { WMSImportPage } from './pages/WMSImportPage';
import { InspectionExportPage } from './pages/InspectionExportPage';
import { HallId } from './types';
import { readSessionHall, rememberSessionHall } from './utils/sessionHall';
import { hasChangeAuditDrafts, flushChangeAuditDrafts } from './changeAudit/session';
import { isHandheldDevice } from './utils/device';

const SkuCountPage=lazy(()=>import('./pages/SkuCountPage').then(module=>({default:module.SkuCountPage})));
const ChangeAuditPage = lazy(() => import('./pages/ChangeAuditPage').then(module => ({default: module.ChangeAuditPage})));

type View = 'inspect' | 'test' | 'import' | 'export' | 'arch' | 'changes' | 'sku';
function readView(hall:HallId,files:boolean):View {
  try { const value=window.localStorage.getItem(`wms-view:${hall}`); if(['inspect','changes','sku','test','arch',...(files?['import','export']:[])].includes(value || '')) return value as View; }catch{} return 'inspect';
}
export const App: React.FC = () => {
  const [storageProblem,setStorageProblem]=useState(()=>{try{window.localStorage.setItem('wms-storage-probe','1');window.localStorage.removeItem('wms-storage-probe');return false;}catch{return true;}});
  const storageProblemRef=useRef(storageProblem);storageProblemRef.current=storageProblem;
  useEffect(()=>{const failed=()=>setStorageProblem(true);window.addEventListener('wms-draft-storage-error',failed);return ()=>window.removeEventListener('wms-draft-storage-error',failed);},[]);
  useEffect(() => {
    document.documentElement.lang = readLanguage();
    document.title = t('siteTitle');
    document.documentElement.dir = 'ltr'; // Never mirror PDA controls.
    return registerLanguageSafety('cached-inspection-drafts', {
      dirty: () => hasUnsavedInspectionDrafts() || hasChangeAuditDrafts() || hasSkuCountDrafts() || storageProblemRef.current,
      busy: () => false,
    });
  }, []);
  // One history sentinel lets the Android PDA/browser Back key request exit
  // without trapping the user or changing the app's navigation model.
  useEffect(() => {
    const marker = '__wms_pda_exit_guard';
    let exiting = false;
    if (!window.history.state?.[marker]) {
      window.history.pushState({ ...(window.history.state || {}), [marker]: true }, '', window.location.href);
    }
    const onPopState = () => {
      if (exiting) return;
      if (!confirmPdaExit()) {
        window.history.pushState({ [marker]: true }, '', window.location.href);
        return;
      }
      exiting = true;
      flushInspectionDrafts();void flushChangeAuditDrafts();void flushSkuCountDrafts();
      window.history.back();
    };
    const flush=()=>{flushInspectionDrafts();void flushChangeAuditDrafts();void flushSkuCountDrafts();};
    const visibility=()=>{if(document.visibilityState==='hidden') flush();};
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      flush();
      if (exiting || consumeApprovedLanguageReload() || (!languageSafety().dirty && !storageProblemRef.current)) return;
      event.preventDefault();
      event.returnValue = '';
    };
    document.addEventListener('visibilitychange',visibility);
    window.addEventListener('pagehide',flush);
    window.addEventListener('popstate', onPopState);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange',visibility);
      window.removeEventListener('pagehide',flush);
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);

  const [currentHall, setCurrentHall] = useState<HallId>(readSessionHall);
  const allowFileTransfer = !isHandheldDevice();
  const selectHall = (hall: HallId) => {
    flushInspectionDrafts();void flushChangeAuditDrafts();void flushSkuCountDrafts();
    rememberSessionHall(hall);
    setCurrentHall(hall);
  };
  const [activeView, setActiveView] = useState<'inspect' | 'test' | 'import' | 'export' | 'arch' | 'changes' | 'sku'> (() => readView(currentHall,allowFileTransfer));
  useEffect(()=>{setActiveView(readView(currentHall,allowFileTransfer));},[currentHall]);
  useEffect(()=>{try {window.localStorage.setItem(`wms-view:${currentHall}`,activeView);}catch{setStorageProblem(true);} if(activeView==='changes') setAuditOpened(true);if(activeView==='sku') setSkuOpened(true);},[activeView]);

  const [skuOpened,setSkuOpened]=useState(activeView==='sku');
  const [auditOpened, setAuditOpened] = useState(activeView==='changes');
  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans">
      <Header
        currentHall={currentHall}
        onSelectHall={selectHall}
        activeView={activeView}
        allowFileTransfer={allowFileTransfer}
        onSelectView={view => {
          flushInspectionDrafts();void flushChangeAuditDrafts();void flushSkuCountDrafts();
          if (allowFileTransfer || (view !== 'import' && view !== 'export')) {
            if(view==='changes') setAuditOpened(true);if(view==='sku')setSkuOpened(true);
            try { window.localStorage.setItem(`wms-view:${currentHall}`,view); } catch { setStorageProblem(true); }
            setActiveView(view);
          }
        }}
      />

      {storageProblem && <p role="alert" className="bg-red-50 text-red-700 p-3 text-sm">{t('resumeStorageError')}</p>}
      <main className="flex-1 pb-4">
        {activeView === 'inspect' && (
          <LocationInspectionPage key={currentHall}
            currentHall={currentHall}
            allowFileTransfer={allowFileTransfer}
            onOpenImport={() => { if (allowFileTransfer) setActiveView('import'); }}
            onOpenTest={() => setActiveView('test')}
          />
        )}
        {allowFileTransfer && activeView === 'import' && <WMSImportPage currentHall={currentHall} />}
        {allowFileTransfer && activeView === 'export' && <InspectionExportPage currentHall={currentHall} />}
        {auditOpened && <div hidden={activeView!=='changes'}><Suspense fallback={<p className="p-4">{t('compareLoading')}</p>}><ChangeAuditPage key={currentHall} currentHall={currentHall} active={activeView==='changes'}/></Suspense></div>}
        {skuOpened && <div hidden={activeView!=='sku'}><Suspense fallback={<p className="p-4">{t('compareLoading')}</p>}><SkuCountPage key={currentHall} currentHall={currentHall} onSelectHall={hall=>{try{localStorage.setItem(`wms-view:${hall}`,'sku');}catch{setStorageProblem(true);}selectHall(hall);}} active={activeView==='sku'}/></Suspense></div>}
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

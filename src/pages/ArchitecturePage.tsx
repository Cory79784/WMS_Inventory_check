import React from 'react';
import { t } from '../i18n';
import {
  ShieldAlert,
  FileSpreadsheet,
  Layers,
  Camera,
  Server,
  Smartphone,
  CheckCircle,
  HelpCircle,
  Lock,
} from 'lucide-react';

export const ArchitecturePage: React.FC = () => {
  return (
    <div className="max-w-3xl mx-auto px-3 py-4 space-y-4">
      {/* Overview Card */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200 space-y-2">
        <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
          <Server className="w-5 h-5 text-brand-600" />
          {t('archTitle')}
        </h2>
        <p className="text-xs text-slate-600 leading-relaxed">
          {t('archIntroStart')} <strong>{t('archIntroBold')}</strong> {t('archIntroEnd')}
        </p>
      </div>

      {/* Grid of Key Technical & Business Understandings */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        {/* 1 & 2: Frontend & Cloudflare Workers */}
        <div className="p-3.5 bg-white rounded-xl border border-slate-200 shadow-sm space-y-1.5">
          <div className="flex items-center gap-1.5 font-bold text-slate-800">
            <Smartphone className="w-4 h-4 text-brand-600" />
            <span>{t('arch12')}</span>
          </div>
          <p className="text-slate-600 leading-relaxed">
            {t('arch12Before')} <code>/api/*</code> {t('arch12After')}
          </p>
        </div>

        {/* 3 & 4: D1 & R2 */}
        <div className="p-3.5 bg-white rounded-xl border border-slate-200 shadow-sm space-y-1.5">
          <div className="flex items-center gap-1.5 font-bold text-slate-800">
            <Camera className="w-4 h-4 text-brand-600" />
            <span>{t('arch34')}</span>
          </div>
          <p className="text-slate-600 leading-relaxed">
            {t('arch34Text')}
          </p>
        </div>

        {/* 5: Access Auth */}
        <div className="p-3.5 bg-white rounded-xl border border-slate-200 shadow-sm space-y-1.5">
          <div className="flex items-center gap-1.5 font-bold text-slate-800">
            <Lock className="w-4 h-4 text-emerald-600" />
            <span>{t('arch5')}</span>
          </div>
          <p className="text-slate-600 leading-relaxed">
            {t('arch5Text')}
          </p>
        </div>

        {/* 6: Sparse Inventory */}
        <div className="p-3.5 bg-white rounded-xl border border-slate-200 shadow-sm space-y-1.5">
          <div className="flex items-center gap-1.5 font-bold text-slate-800">
            <Layers className="w-4 h-4 text-amber-600" />
            <span>{t('arch6')}</span>
          </div>
          <p className="text-slate-600 leading-relaxed">
            <strong>{t('archCore')}</strong>{t('archSparse')}
          </p>
        </div>

        {/* 7 & 8: Version Management & Version Locking */}
        <div className="p-3.5 bg-white rounded-xl border border-slate-200 shadow-sm space-y-1.5">
          <div className="flex items-center gap-1.5 font-bold text-slate-800">
            <CheckCircle className="w-4 h-4 text-blue-600" />
            <span>{t('arch78')}</span>
          </div>
          <p className="text-slate-600 leading-relaxed">
            {t('archVersionBefore')}<strong>{t('archVersionBold')}</strong>{t('archVersionMiddle')} <code>reference_import_id</code>{t('archVersionAfter')}
          </p>
        </div>

        {/* 9 & 10: Location Registry & Navigation */}
        <div className="p-3.5 bg-white rounded-xl border border-slate-200 shadow-sm space-y-1.5">
          <div className="flex items-center gap-1.5 font-bold text-slate-800">
            <Layers className="w-4 h-4 text-purple-600" />
            <span>{t('arch910')}</span>
          </div>
          <p className="text-slate-600 leading-relaxed">
            {t('archPhysicalBefore')} <code>{t('archPhysicalExample')}</code> {t('archPhysicalAfter')}
          </p>
        </div>

        {/* 11 & 12: PDA Workflow & Excel Export Plan B */}
        <div className="p-3.5 bg-white rounded-xl border border-slate-200 md:col-span-2 shadow-sm space-y-1.5">
          <div className="flex items-center gap-1.5 font-bold text-slate-800">
            <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
            <span>{t('arch1112')}</span>
          </div>
          <p className="text-slate-600 leading-relaxed">
            <strong>{t('archExportBold')}</strong>{t('archExportPart1')}<code>库存核查记录</code>{t('archExportPart2')}<code>现场照片1, 现场照片2...</code>{t('archExportPart3')}
          </p>
        </div>

        {/* 13 & 14: Cloudflare Free Tier Risks & Unconfirmed Items */}
        <div className="p-3.5 bg-amber-50 rounded-xl border border-amber-200 md:col-span-2 space-y-2">
          <div className="flex items-center gap-1.5 font-bold text-amber-900">
            <ShieldAlert className="w-4 h-4 text-amber-700" />
            <span>{t('arch1314')}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-700 text-[11px]">
            <div>
              <span className="font-semibold text-amber-900 block">{t('archFreeTitle')}</span>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>{t('archQuota1')}</li>
                <li>{t('archQuota2')}</li>
                <li>{t('archQuota3')}</li>
                <li>{t('archQuota4')}</li>
              </ul>
            </div>
            <div>
              <span className="font-semibold text-amber-900 block flex items-center gap-1">
                <HelpCircle className="w-3.5 h-3.5" />
                {t('archPending')}
              </span>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>{t('archPending1')}</li>
                <li>{t('archPending2')}</li>
                <li>{t('archPending3')}</li>
                <li>{t('archPending4')}</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

import { Check, AlertTriangle } from 'lucide-react';
import { t } from '../i18n';
import type { LocationSkuItem } from '../types';
export function InspectionSkuCard({ item, idx, handleSetSkuNormal, handleOpenShortage, bookLabel, emphasizeBook = false, unknownAllocation = false }: {
    item: LocationSkuItem;
    idx: number;
    handleSetSkuNormal: (index: number) => void;
    handleOpenShortage: (item: LocationSkuItem) => void;
    bookLabel?: string;
    emphasizeBook?: boolean;
    unknownAllocation?: boolean;
}) {
    const isNormal = item.discrepancyType === 'NORMAL';
    const isShortage = item.discrepancyType === 'SHORTAGE';
    const isSurplus = item.discrepancyType === 'SURPLUS' || item.discrepancyType === 'NO_SKU_SURPLUS';
    const hasDiff = item.differenceQty !== null && item.differenceQty !== 0;
    return (<div key={item.lineId || `${item.sku}_${idx}`} className={`bg-white rounded-xl border p-3 shadow-sm transition ${isShortage
            ? 'border-red-300 bg-red-50/20'
            : isSurplus
                ? 'border-amber-300 bg-amber-50/20'
                : isNormal
                    ? 'border-emerald-300 bg-emerald-50/10'
                    : 'border-slate-200'}`}>
                  {/* Top Bar: SKU & Identification */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono font-bold text-base text-slate-900 break-all">
                          {item.sku}
                        </span>
                        {item.customerCode && (<span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded border border-slate-200">
                            {t('customer')}{item.customerCode}
                          </span>)}
                        {item.barcode && (<span dir="ltr" className="text-sm break-all max-w-full bg-blue-50 text-blue-700 px-1.5 py-0.2 rounded border border-blue-200 font-mono">
                            {t('barcodeLabel')}{item.barcode}
                          </span>)}
                      </div>
                      <p className="text-xs text-slate-600 mt-0.5 line-clamp-1">
                        {item.nameZh || t('noChineseName')}
                      </p>
                    </div>

                    {/* Discrepancy Status Tag */}
                    <div>
                      {isNormal && (<span className="inline-flex items-center gap-0.5 bg-emerald-100 text-emerald-800 text-[11px] font-bold px-2 py-0.5 rounded-full">
                          <Check className="w-3 h-3"/> {t('match')}
                        </span>)}
                      {isShortage && (<span className="inline-flex items-center gap-0.5 bg-red-100 text-red-800 text-[11px] font-bold px-2 py-0.5 rounded-full">
                          {t('shortage')} {Math.abs(item.differenceQty || 0)}
                        </span>)}
                      {isSurplus && (<span className="inline-flex items-center gap-0.5 bg-amber-100 text-amber-800 text-[11px] font-bold px-2 py-0.5 rounded-full">
                          {t('surplus')} +{item.differenceQty || 0}
                        </span>)}
                      {!item.discrepancyType && (<span className="bg-slate-100 text-slate-500 text-[11px] px-2 py-0.5 rounded-full font-medium">
                          {t('unchecked')}
                        </span>)}
                    </div>
                  </div>

                  {item.isReturn && (<p className="mt-2 text-xs text-slate-600 break-all">
                      {t('returnShort')}{item.returnCode ? ` · ${t('returnedCodeLabel')} ${item.returnCode}` : ''}
                    </p>)}

                  {/* Stock Quantities Grid (6 Pillars) */}
                  <div dir="ltr" className="grid grid-cols-6 gap-1 mt-2.5 pt-2 border-t border-slate-100 text-center">
                    <div className="bg-slate-50 rounded p-1">
                      <div className="text-[10px] text-slate-400">{bookLabel || t('book')}</div>
                      <div className={`${emphasizeBook ? 'text-2xl' : 'text-sm'} font-bold text-slate-800 font-mono`}>{item.systemQty}</div>
                    </div>
                    <div className="bg-slate-50 rounded p-1">
                      <div className="text-[10px] font-semibold text-blue-700">{t('available')}</div>
                      <div className="text-sm font-bold text-blue-700 font-mono">{unknownAllocation ? '—' : item.availableQty}</div>
                    </div>
                    <div className="bg-slate-50 rounded p-1">
                      <div className="text-[10px] text-slate-400">{t('allocated')}</div>
                      <div className="text-xs font-semibold text-slate-700 font-mono">{unknownAllocation ? '—' : item.allocatedQty}</div>
                    </div>
                    <div className="bg-slate-50 rounded p-1">
                      <div className="text-[10px] text-slate-400">{t('frozen')}</div>
                      <div className="text-xs font-semibold text-slate-700 font-mono">{unknownAllocation ? '—' : item.frozenQty}</div>
                    </div>
                    <div className={`rounded p-1 ${item.actualQty !== null ? 'bg-blue-50 text-blue-900' : 'bg-slate-50 text-slate-400'}`}>
                      <div className="text-[10px] font-medium">{t('actual')}</div>
                      <div className="text-sm font-bold font-mono">
                        {item.actualQty !== null ? item.actualQty : '-'}
                      </div>
                    </div>
                    <div className={`rounded p-1 ${hasDiff
            ? isShortage
                ? 'bg-red-100 text-red-900 font-bold'
                : 'bg-amber-100 text-amber-900 font-bold'
            : isNormal
                ? 'bg-emerald-50 text-emerald-800'
                : 'bg-slate-50 text-slate-400'}`}>
                      <div className="text-[10px]">{t('difference')}</div>
                      <div className="text-sm font-mono font-bold">
                        {item.differenceQty !== null ? (item.differenceQty > 0 ? `+${item.differenceQty}` : item.differenceQty) : '-'}
                      </div>
                    </div>
                  </div>

                  {/* SKU Action Buttons */}
                  <div className="flex items-center justify-end gap-2 mt-2 pt-2 border-t border-slate-100">
                    <button type="button" onClick={() => handleSetSkuNormal(idx)} className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1 active:scale-95 transition">
                      <Check className="w-3.5 h-3.5"/>
                      {t('normal')}
                    </button>

                    <button type="button" onClick={() => handleOpenShortage(item)} className="bg-slate-100 hover:bg-red-50 hover:text-red-700 text-slate-700 text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1 border border-slate-200 active:scale-95 transition">
                      <AlertTriangle className="w-3.5 h-3.5 text-red-500"/>
                      {t('shortage')}
                    </button>
                  </div>
                </div>);
}

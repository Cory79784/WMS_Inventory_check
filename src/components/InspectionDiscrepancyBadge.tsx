import { Check } from 'lucide-react';
import { t } from '../i18n';
import type { LocationSkuItem } from '../types';

export function InspectionDiscrepancyBadge({ item }: {
    item: Pick<LocationSkuItem, 'discrepancyType' | 'differenceQty'>;
}) {
    const isNormal = item.discrepancyType === 'NORMAL';
    const isShortage = item.discrepancyType === 'SHORTAGE';
    const isSurplus = item.discrepancyType === 'SURPLUS' || item.discrepancyType === 'NO_SKU_SURPLUS';
    return <>
        {isNormal && <span className="inline-flex items-center gap-0.5 bg-emerald-100 text-emerald-800 text-[11px] font-bold px-2 py-0.5 rounded-full"><Check className="w-3 h-3"/> {t('match')}</span>}
        {isShortage && <span className="inline-flex items-center gap-0.5 bg-red-100 text-red-800 text-[11px] font-bold px-2 py-0.5 rounded-full">{t('shortage')} {Math.abs(item.differenceQty || 0)}</span>}
        {isSurplus && <span className="inline-flex items-center gap-0.5 bg-amber-100 text-amber-800 text-[11px] font-bold px-2 py-0.5 rounded-full">{t('surplus')} +{item.differenceQty || 0}</span>}
        {!item.discrepancyType && <span className="bg-slate-100 text-slate-500 text-[11px] px-2 py-0.5 rounded-full font-medium">{t('unchecked')}</span>}
    </>;
}

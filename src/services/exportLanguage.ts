export type ExportLanguage = 'zh' | 'en' | 'de';

// Local static labels only. Never translate source product names or free-form notes.
export const exportText = {
  zh: {
    sheet: '库存核查记录', headers: ['库厅','库位','SKU','Barcode','商品名称','账面数量','实盘数量','差异','差异类型','核查状态','核查时间','WMS 版本','WMS 导入时间','备注','照片标记','是否退货','退货码或跟踪号（如有）'],
    photo:'照片',yes:'是',empty:'确认空库位',location:'库位存证',noSku:'无sku',normalPhoto:'正常·有照片',attached:'有照片',
    all:'全部核查结果',differences:'仅差异',scope:{history:'所有已保存版本',latest:'当前WMS版本'},
    status:{VERIFIED:'已核查',PENDING_REVIEW:'待复核',CLOSED:'已关闭',IN_PROGRESS:'核查中'},
    discrepancy:{NORMAL:'正常',SHORTAGE:'少货',SURPLUS:'多货',UNEXPECTED_SKU:'账外SKU',NO_SKU_SURPLUS:'无SKU多货'},
    normalNote:'盘点正常相符',shortageNote:'现场少货',surplusNote:'现场多货',units:'件',
  },
  en: {
    sheet:'Inventory Audit',headers:['Hall','Location','SKU','Barcode','Product name','Book quantity','Counted quantity','Difference','Discrepancy type','Audit status','Audit time','WMS version','WMS import time','Notes','Photo indicator','Return goods','Return code or tracking number (if any)'],
    photo:'Photo',yes:'Yes',empty:'Confirmed empty',location:'Location evidence',noSku:'No SKU',normalPhoto:'Matched · photo attached',attached:'Photo attached',
    all:'All audit results',differences:'Differences only',scope:{history:'All saved versions',latest:'Current WMS version'},
    status:{VERIFIED:'Verified',PENDING_REVIEW:'Pending review',CLOSED:'Closed',IN_PROGRESS:'In progress'},
    discrepancy:{NORMAL:'Matched',SHORTAGE:'Shortage',SURPLUS:'Surplus',UNEXPECTED_SKU:'Unlisted SKU',NO_SKU_SURPLUS:'Surplus without SKU'},
    normalNote:'Count matches book stock',shortageNote:'On-site shortage',surplusNote:'On-site surplus',units:'units',
  },
  de: {
    sheet:'Bestandsprüfung',headers:['Halle','Lagerplatz','SKU','Barcode','Artikelbezeichnung','Sollbestand','Istbestand','Differenz','Abweichungsart','Prüfstatus','Prüfzeitpunkt','WMS-Version','WMS-Importzeitpunkt','Bemerkungen','Fotohinweis','Retourenware','Retourencode oder Sendungsnummer (falls vorhanden)'],
    photo:'Foto',yes:'Ja',empty:'Leer bestätigt',location:'Lagerplatznachweis',noSku:'Ohne SKU',normalPhoto:'Übereinstimmung · mit Foto',attached:'Foto vorhanden',
    all:'Alle Prüfergebnisse',differences:'Nur Abweichungen',scope:{history:'Alle gespeicherten Versionen',latest:'Aktuelle WMS-Version'},
    status:{VERIFIED:'Geprüft',PENDING_REVIEW:'Nachprüfung ausstehend',CLOSED:'Abgeschlossen',IN_PROGRESS:'In Bearbeitung'},
    discrepancy:{NORMAL:'Übereinstimmung',SHORTAGE:'Fehlbestand',SURPLUS:'Mehrbestand',UNEXPECTED_SKU:'Nicht verbuchte SKU',NO_SKU_SURPLUS:'Mehrbestand ohne SKU'},
    normalNote:'Istbestand entspricht Sollbestand',shortageNote:'Fehlbestand vor Ort',surplusNote:'Mehrbestand vor Ort',units:'Stück',
  },
};

// Only exact known generated templates are mapped; arbitrary operator text is untouched.
export function exportNote(notes: string, language: ExportLanguage): string {
  if(language==='zh') return notes;
  const text=exportText[language];
  if(notes==='盘点正常相符') return text.normalNote;
  const shortage=/^现场少货 (\d+) 件$/.exec(notes);
  if(shortage) return `${text.shortageNote} ${shortage[1]} ${text.units}`;
  const surplus=/^现场多货 (\d+) 件 \((SKU|BARCODE|NO_SKU)\)$/.exec(notes);
  if(surplus) return `${text.surplusNote} ${surplus[1]} ${text.units} (${surplus[2]})`;
  return notes;
}

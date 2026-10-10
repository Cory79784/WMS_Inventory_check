import { describe, it, expect } from 'vitest';

export interface WMSRow {
  sku: string;
  barcode: string;
  eBarcode: string;
  customerCode: string;
  nameZh: string;
  nameEn: string;
  hallId: string;
  locationCode: string;
  systemQty: number;
  volumeM3: number;
  availableQty: number;
  allocatedQty: number;
  frozenQty: number;
  dimensionsCm: string;
  weightKg: number;
  cargoType: string;
  isNewProduct: boolean;
  isElectric: boolean;
}

export function parseWmsRawRow(row: string[]): WMSRow {
  const stockQty = parseInt(row[8] || '0', 10);
  const availQty = parseInt(row[10] || '0', 10);
  const allocQty = parseInt(row[11] || '0', 10);
  const frozenQty = parseInt(row[12] || '0', 10);

  return {
    sku: (row[0] || '').trim(),
    barcode: (row[1] || '').trim(),
    eBarcode: (row[2] || '').trim(),
    customerCode: (row[3] || '').trim(),
    nameZh: (row[4] || '').trim(),
    nameEn: (row[5] || '').trim(),
    hallId: (row[6] || '').trim().toUpperCase(),
    locationCode: (row[7] || '').trim(),
    systemQty: stockQty,
    volumeM3: parseFloat(row[9] || '0'),
    availableQty: availQty,
    allocatedQty: allocQty,
    frozenQty: frozenQty,
    dimensionsCm: (row[13] || '').trim(),
    weightKg: parseFloat(row[14] || '0'),
    cargoType: (row[15] || '').trim(),
    isNewProduct: (row[16] || '').trim().toUpperCase() === 'Y',
    isElectric: (row[17] || '').trim().toUpperCase() === 'Y',
  };
}

export function splitEBarcodes(eBarcodeStr: string): string[] {
  if (!eBarcodeStr) return [];
  return eBarcodeStr
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

describe('Phase 1 - Real WMS Data Mapping & Validation', () => {
  it('correctly maps 18 fields and verifies quantity equation', () => {
    const sampleRow = [
      'AP01-24S-FBM-DE', 'F11103774538', '30038016', 'F1110',
      'Venusarm 24色丙烯画颜料套装', 'Venusarm 24-Color Acrylic Paint Set',
      'H1', '112-074-1', '320', '1.29024', '320', '0', '0',
      '36*28*4', '1.52', 'T50', 'N', 'N'
    ];

    const parsed = parseWmsRawRow(sampleRow);
    expect(parsed.sku).toBe('AP01-24S-FBM-DE');
    expect(parsed.locationCode).toBe('112-074-1');
    expect(parsed.systemQty).toBe(320);
    expect(parsed.systemQty).toBe(parsed.availableQty + parsed.allocatedQty + parsed.frozenQty);
    expect(parsed.isElectric).toBe(false);
  });

  it('correctly handles allocated inventory where available differs from system stock', () => {
    // Row 55: G0HBL-35CMQXWT-E1, 40 stock, 35 avail, 5 allocated
    const sampleRow = [
      'G0HBL-35CMQXWT-E1', 'B32571446948', '', 'B3257',
      '3pcs球形LED灯35cm款(欧规）', 'Lights', 'H1', '116-009-1',
      '40', '0.54756', '35', '5', '0',
      '39*39*9', '1.77', 'T50', 'N', 'N'
    ];

    const parsed = parseWmsRawRow(sampleRow);
    expect(parsed.systemQty).toBe(40);
    expect(parsed.availableQty).toBe(35);
    expect(parsed.allocatedQty).toBe(5);
    expect(parsed.systemQty).toBe(parsed.availableQty + parsed.allocatedQty + parsed.frozenQty);
  });

  it('correctly splits multi-valued eBarcode strings', () => {
    const rawEBarcode = 'G658-S7122309488,G975-X4635323284,XBDYDW096HEA0X';
    const split = splitEBarcodes(rawEBarcode);
    expect(split).toHaveLength(3);
    expect(split).toContain('G658-S7122309488');
    expect(split).toContain('G975-X4635323284');
    expect(split).toContain('XBDYDW096HEA0X');
  });

  it('handles empty eBarcode safely', () => {
    const split = splitEBarcodes('');
    expect(split).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { handleInventoryRoutes } from '../worker/routes/inventory';
import { parseWmsRawRow } from './excelMapping.test';
import { Env } from '../worker/types';

describe('Phase 2 - Real Sample Data Staging & Barcode Inversion', () => {
  it('correctly stages, splits multi-eBarcodes, and indexes real sample lines', async () => {
    // 3 real rows from sample
    const rawRows = [
      [
        'AP01-24S-FBM-DE', 'F11103774538', '30038016', 'F1110',
        'Venusarm 24色丙烯画颜料套装', 'Venusarm 24-Color Acrylic Paint Set',
        'H1', '112-074-1', '320', '1.29024', '320', '0', '0',
        '36*28*4', '1.52', 'T50', 'N', 'N'
      ],
      [
        'YDW096HEA0X', 'W08659468834',
        'G658-S7122309488,G975-X4635323284,XBDYDW096HEA0X',
        'W0865', '调节哑铃塑料包钢款 黑色2.5kg*2', 'steel dumbbell set',
        'H1', '123-073-1', '100', '0.9408', '100', '0', '0',
        '28*24*14', '5.5', 'T50', 'N', 'N'
      ],
    ];

    const parsedRows = rawRows.map(parseWmsRawRow);
    expect(parsedRows).toHaveLength(2);

    const executedBatchStmts: any[] = [];
    const mockDb = {
      prepare: (query: string) => ({
        bind: (...args: any[]) => ({ query, args }),
      }),
      batch: async (stmts: any[]) => {
        executedBatchStmts.push(...stmts);
        return [];
      },
    } as unknown as D1Database;

    // Verify chunk insertion logic calls batch with stock rows and inverted barcode index
    // Row 1: SKU + Barcode + 1 eBarcode = 3 barcode entries + 1 stock row = 4 stmts
    // Row 2: SKU + Barcode + 3 split eBarcodes = 5 barcode entries + 1 stock row = 6 stmts
    // Total stmts should be 10!
    const env: Env = {
      DB: {
        prepare: (query: string) => {
          if (query.includes('FROM inventory_imports')) {
            return {
              bind: () => ({
                first: async () => ({ status: 'STAGING' }),
              }),
            };
          }
          return {
            bind: (...args: any[]) => ({ query, args }),
          };
        },
        batch: async (stmts: any[]) => {
          executedBatchStmts.push(...stmts);
          return [];
        },
      } as unknown as D1Database,
      PHOTO_BUCKET: {} as unknown as R2Bucket,
      ENVIRONMENT: 'test',
      AUTH_MODE: 'development',
    };

    const req = new Request('https://audit.test/api/inventory/imports/chunk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        importId: 'imp_H1_v1_test',
        hallId: 'H1',
        rows: parsedRows,
      }),
    });

    const res = await handleInventoryRoutes(req, env);
    expect(res.status).toBe(200);

    const json = await res.json() as { success: boolean; insertedCount: number };
    expect(json.success).toBe(true);
    expect(json.insertedCount).toBe(2);

    // Verify statements in batch
    expect(executedBatchStmts).toHaveLength(10);

    // Verify sub-barcode was indexed separately
    const indexedValues = executedBatchStmts
      .filter((s) => s.query.includes('inventory_barcode_index'))
      .map((s) => s.args[3]);

    expect(indexedValues).toContain('AP01-24S-FBM-DE');
    expect(indexedValues).toContain('F11103774538');
    expect(indexedValues).toContain('30038016');
    expect(indexedValues).toContain('YDW096HEA0X');
    expect(indexedValues).toContain('W08659468834');
    expect(indexedValues).toContain('G658-S7122309488');
    expect(indexedValues).toContain('G975-X4635323284');
    expect(indexedValues).toContain('XBDYDW096HEA0X');
  });
});

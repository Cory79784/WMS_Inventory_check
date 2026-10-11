import { describe, it, expect } from 'vitest';
import { handleInventoryRoutes } from '../worker/routes/inventory';
import { Env } from '../worker/types';

describe('Location Inspection & Multi-SKU Aggregation API', () => {
  it('aggregates multiple SKUs for a scanned location', async () => {
    const mockDb = {
      prepare: (query: string) => ({
        bind: (...args: any[]) => ({
          first: async () => {
            if (query.includes('FROM active_hall_imports')) {
              return { active_import_id: 'imp_H1_v1' };
            }
            if (query.includes('FROM inventory_imports')) {
              return { version_number: 1, source_exported_at: '2026-10-10T00:00:00Z', original_filename: 'H1_20261010.xlsx' };
            }
            if (query.includes('FROM location_inspections')) {
              return null; // Not inspected yet
            }
            return null;
          },
          all: async () => {
            if (query.includes('FROM inventory_stock_rows') && query.includes('GROUP BY sku')) {
              return {
                results: [
                  {
                    sku: 'SKU-001',
                    barcode: '6901111111',
                    e_barcode: 'EB001',
                    customer_code: 'CUST-A',
                    name_zh: '测试商品A',
                    name_en: 'Test Product A',
                    system_qty: 10,
                    available_qty: 8,
                    allocated_qty: 2,
                    frozen_qty: 0,
                  },
                  {
                    sku: 'SKU-002',
                    barcode: '6902222222',
                    e_barcode: 'EB002',
                    customer_code: 'CUST-B',
                    name_zh: '测试商品B',
                    name_en: 'Test Product B',
                    system_qty: 5,
                    available_qty: 5,
                    allocated_qty: 0,
                    frozen_qty: 0,
                  },
                ],
              };
            }
            if (query.includes('SELECT DISTINCT location_code FROM inventory_stock_rows')) {
              return {
                results: [{ location_code: '109-047-1' }, { location_code: '109-047-2' }],
              };
            }
            return { results: [] };
          },
        }),
      }),
    } as unknown as D1Database;

    const env: Env = {
      DB: mockDb,
      PHOTO_BUCKET: {} as unknown as R2Bucket,
      ENVIRONMENT: 'test',
    };

    const req = new Request('https://audit.test/api/inventory/location?hallId=H1&locationCode=109-047-1');
    const res = await handleInventoryRoutes(req, env);
    expect(res.status).toBe(200);

    const json = await res.json() as any;
    expect(json.success).toBe(true);
    expect(json.data.locationCode).toBe('109-047-1');
    expect(json.data.hasBookStock).toBe(true);
    expect(json.data.skus).toHaveLength(2);
    expect(json.data.skus[0].sku).toBe('SKU-001');
    expect(json.data.skus[0].systemQty).toBe(10);
    expect(json.data.skus[0].availableQty).toBe(8);
    expect(json.data.skus[0].allocatedQty).toBe(2);
    expect(json.data.skus[1].sku).toBe('SKU-002');
    expect(json.data.skus[1].systemQty).toBe(5);
  });

  it('saves inspection with shortage and surplus records', async () => {
    const executedStmts: any[] = [];
    const mockDb = {
      prepare: (query: string) => ({
        bind: (...args: any[]) => ({
          query,
          args,
          first: async () => {
            if (query.includes('FROM active_hall_imports')) {
              return { active_import_id: 'imp_H1_v1' };
            }
            if (query.includes('FROM location_inspections')) {
              return null;
            }
            return null;
          },
        }),
      }),
      batch: async (stmts: any[]) => {
        executedStmts.push(...stmts);
        return [];
      },
    } as unknown as D1Database;

    const env: Env = {
      DB: mockDb,
      PHOTO_BUCKET: {} as unknown as R2Bucket,
      ENVIRONMENT: 'test',
    };

    const payload = {
      hallId: 'H1',
      locationCode: '109-047-1',
      status: 'VERIFIED',
      skus: [
        {
          sku: 'SKU-001',
          systemQty: 10,
          actualQty: 8,
          differenceQty: -2,
          discrepancyType: 'SHORTAGE',
          notes: '少货2件',
        },
        {
          sku: 'UNEXPECTED-SKU-999',
          systemQty: 0,
          actualQty: 3,
          differenceQty: 3,
          discrepancyType: 'SURPLUS',
          notes: '现场多货3件',
        },
      ],
      photos: [
        {
          photoId: 'p_123',
          objectKey: 'inspections/H1/109-047-1/p_123.jpg',
        },
      ],
    };

    const req = new Request('https://audit.test/api/inventory/inspection/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const res = await handleInventoryRoutes(req, env);
    expect(res.status).toBe(200);

    const json = await res.json() as any;
    expect(json.success).toBe(true);
    expect(json.status).toBe('VERIFIED');
    expect(executedStmts.length).toBeGreaterThanOrEqual(4); // upsert loc + delete old + 2 skus + photo + audit
  });
});

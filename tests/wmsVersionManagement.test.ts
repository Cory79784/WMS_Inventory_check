import { describe, it, expect, vi } from 'vitest';
import { handleInventoryRoutes } from '../worker/routes/inventory';
import { Env } from '../worker/types';

describe('Phase 2 - Cloud WMS Version Management & Inverted Barcode Registry', () => {
  it('GET /api/inventory/imports retrieves active pointer and historical snapshots', async () => {
    const mockImports = [
      { import_id: 'imp_H1_v2', version_number: 2, status: 'PUBLISHED' },
      { import_id: 'imp_H1_v1', version_number: 1, status: 'PUBLISHED' },
    ];

    const mockDb = {
      prepare: vi.fn().mockImplementation((query: string) => {
        if (query.includes('FROM active_hall_imports')) {
          return {
            bind: vi.fn().mockReturnValue({
              first: vi.fn().mockResolvedValue({ active_import_id: 'imp_H1_v2', updated_at: '2026-10-10T00:00:00Z' }),
            }),
          };
        }
        return {
          bind: vi.fn().mockReturnValue({
            all: vi.fn().mockResolvedValue({ results: mockImports }),
          }),
        };
      }),
    } as unknown as D1Database;

    const env: Env = {
      DB: mockDb,
      PHOTO_BUCKET: {} as unknown as R2Bucket,
      ENVIRONMENT: 'test',
      AUTH_MODE: 'development',
    };

    const req = new Request('https://audit.test/api/inventory/imports?hallId=H1');
    const res = await handleInventoryRoutes(req, env);
    expect(res.status).toBe(200);

    const json = await res.json() as { success: boolean; data: { activeImportId: string; imports: unknown[] } };
    expect(json.success).toBe(true);
    expect(json.data.activeImportId).toBe('imp_H1_v2');
    expect(json.data.imports).toHaveLength(2);
  });

  it('POST /api/inventory/imports/check detects duplicate file hash', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({
            import_id: 'imp_H1_v1',
            version_number: 1,
            original_filename: '库位库存_20261010.xlsx',
          }),
        }),
      }),
    } as unknown as D1Database;

    const env: Env = {
      DB: mockDb,
      PHOTO_BUCKET: {} as unknown as R2Bucket,
      ENVIRONMENT: 'test',
      AUTH_MODE: 'development',
    };

    const req = new Request('https://audit.test/api/inventory/imports/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hallId: 'H1', sha256: 'abc123hash' }),
    });

    const res = await handleInventoryRoutes(req, env);
    expect(res.status).toBe(200);

    const json = await res.json() as { success: boolean; isDuplicate: boolean; existingImport: { version_number: number } };
    expect(json.isDuplicate).toBe(true);
    expect(json.existingImport.version_number).toBe(1);
  });

  it('POST /api/inventory/imports/publish atomically updates active pointer and audit log', async () => {
    const batchMock = vi.fn().mockResolvedValue([]);
    const mockDb = {
      prepare: vi.fn().mockImplementation((query: string) => {
        if (query.includes('SELECT * FROM inventory_imports')) {
          return {
            bind: vi.fn().mockReturnValue({
              first: vi.fn().mockResolvedValue({
                import_id: 'imp_H1_v2',
                hall_id: 'H1',
                status: 'STAGING',
                version_number: 2,
              }),
            }),
          };
        }
        if (query.includes('total_rows')) {
          return {
            bind: vi.fn().mockReturnValue({
              first: vi.fn().mockResolvedValue({
                total_rows: 286,
                total_locations: 286,
                total_skus: 144,
                total_stock: 9984,
              }),
            }),
          };
        }
        return {
          bind: vi.fn().mockReturnValue({}),
        };
      }),
      batch: batchMock,
    } as unknown as D1Database;

    const env: Env = {
      DB: mockDb,
      PHOTO_BUCKET: {} as unknown as R2Bucket,
      ENVIRONMENT: 'test',
      AUTH_MODE: 'development',
    };

    const req = new Request('https://audit.test/api/inventory/imports/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ importId: 'imp_H1_v2', hallId: 'H1' }),
    });

    const res = await handleInventoryRoutes(req, env);
    expect(res.status).toBe(200);

    const json = await res.json() as { success: boolean; activeImportId: string; summary: { total_stock: number } };
    expect(json.success).toBe(true);
    expect(json.activeImportId).toBe('imp_H1_v2');
    expect(json.summary.total_stock).toBe(9984);
    expect(batchMock).toHaveBeenCalled();
  });

  it('GET /api/inventory/search-barcode correctly identifies ambiguous barcode candidates (Decision 1 Option A)', async () => {
    const mockActive = { active_import_id: 'imp_H1_v1' };
    const mockIndexMatches = [
      { sku: 'SKU-AAA', barcode_type: 'EBARCODE', barcode_value: '46' },
      { sku: 'SKU-BBB', barcode_type: 'EBARCODE', barcode_value: '46' },
    ];
    const mockCandidates = [
      { sku: 'SKU-AAA', name_zh: '商品 A', system_qty: 10, location_code: '112-074-1' },
      { sku: 'SKU-BBB', name_zh: '商品 B', system_qty: 5, location_code: '112-075-1' },
    ];

    const mockDb = {
      prepare: vi.fn().mockImplementation((query: string) => {
        if (query.includes('FROM active_hall_imports')) {
          return {
            bind: vi.fn().mockReturnValue({
              first: vi.fn().mockResolvedValue(mockActive),
            }),
          };
        }
        if (query.includes('FROM inventory_barcode_index')) {
          return {
            bind: vi.fn().mockReturnValue({
              all: vi.fn().mockResolvedValue({ results: mockIndexMatches }),
            }),
          };
        }
        return {
          bind: vi.fn().mockReturnValue({
            all: vi.fn().mockResolvedValue({ results: mockCandidates }),
          }),
        };
      }),
    } as unknown as D1Database;

    const env: Env = {
      DB: mockDb,
      PHOTO_BUCKET: {} as unknown as R2Bucket,
      ENVIRONMENT: 'test',
      AUTH_MODE: 'development',
    };

    const req = new Request('https://audit.test/api/inventory/search-barcode?hallId=H1&barcode=46');
    const res = await handleInventoryRoutes(req, env);
    expect(res.status).toBe(200);

    const json = await res.json() as {
      success: boolean;
      found: boolean;
      isAmbiguous: boolean;
      candidates: Array<{ sku: string }>;
    };

    expect(json.success).toBe(true);
    expect(json.found).toBe(true);
    expect(json.isAmbiguous).toBe(true); // Triggers Decision 1 Option A Candidate Modal!
    expect(json.candidates).toHaveLength(2);
  });
});

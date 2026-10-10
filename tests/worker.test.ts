import { describe, it, expect, vi } from 'vitest';
import { handleHealthCheck } from '../worker/routes/health';
import { handleD1Test } from '../worker/routes/d1-test';
import { handleR2Test } from '../worker/routes/r2-test';
import { authenticateRequest } from '../worker/auth/access';
import { Env } from '../worker/types';

describe('Worker Routes & Feasibility Diagnostics', () => {
  it('health check returns system status and binding information', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue({ count: 3 }),
      }),
    } as unknown as D1Database;

    const mockR2 = {} as unknown as R2Bucket;

    const env: Env = {
      DB: mockDb,
      PHOTO_BUCKET: mockR2,
      ENVIRONMENT: 'test',
    };

    const res = await handleHealthCheck(new Request('https://audit.test/api/health'), env);
    expect(res.status).toBe(200);

    const json = await res.json() as { status: string; bindings: { d1: { available: boolean } } };
    expect(json.status).toBe('ok');
    expect(json.bindings.d1.available).toBe(true);
  });

  it('d1-test GET retrieves halls and diagnostics', async () => {
    const mockHalls = [{ hall_id: 'H1', name: 'Hall 1' }];
    const mockDiags = [{ id: '1', test_key: 'k', test_value: 'v' }];

    const mockDb = {
      prepare: vi.fn().mockImplementation((query: string) => {
        if (query.includes('FROM halls')) {
          return { all: vi.fn().mockResolvedValue({ results: mockHalls }) };
        }
        return { all: vi.fn().mockResolvedValue({ results: mockDiags }) };
      }),
    } as unknown as D1Database;

    const env: Env = {
      DB: mockDb,
      PHOTO_BUCKET: {} as unknown as R2Bucket,
      ENVIRONMENT: 'test',
    };

    const res = await handleD1Test(new Request('https://audit.test/api/d1-test', { method: 'GET' }), env);
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean; data: { halls: unknown[] } };
    expect(json.success).toBe(true);
    expect(json.data.halls).toHaveLength(1);
  });

  it('d1-test POST writes and verifies new record', async () => {
    const mockRecord = { id: 'diag_123', test_key: 'loc', test_value: '120-075-1' };
    const mockDb = {
      prepare: vi.fn().mockImplementation((query: string) => {
        if (query.includes('INSERT INTO')) {
          return {
            bind: vi.fn().mockReturnValue({
              run: vi.fn().mockResolvedValue({ success: true }),
            }),
          };
        }
        return {
          bind: vi.fn().mockReturnValue({
            first: vi.fn().mockResolvedValue(mockRecord),
          }),
        };
      }),
    } as unknown as D1Database;

    const env: Env = {
      DB: mockDb,
      PHOTO_BUCKET: {} as unknown as R2Bucket,
      ENVIRONMENT: 'test',
    };

    const req = new Request('https://audit.test/api/d1-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testKey: 'loc', testValue: '120-075-1' }),
    });

    const res = await handleD1Test(req, env);
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean; record: { test_value: string } };
    expect(json.success).toBe(true);
    expect(json.record.test_value).toBe('120-075-1');
  });

  it('r2-test handles file upload and puts to R2 bucket', async () => {
    const mockPut = vi.fn().mockResolvedValue({
      key: 'phase0-test/123-test.jpg',
      httpEtag: 'etag123',
    });

    const mockR2 = {
      put: mockPut,
    } as unknown as R2Bucket;

    const env: Env = {
      DB: {} as unknown as D1Database,
      PHOTO_BUCKET: mockR2,
      ENVIRONMENT: 'test',
    };

    const req = new Request('https://audit.test/api/r2-test', {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg' },
      body: new Uint8Array([1, 2, 3, 4]),
    });

    const res = await handleR2Test(req, env);
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean; file: { key: string } };
    expect(json.success).toBe(true);
    expect(mockPut).toHaveBeenCalled();
  });

  it('Cloudflare Access rejects missing headers in production mode', async () => {
    const env: Env = {
      DB: {} as unknown as D1Database,
      PHOTO_BUCKET: {} as unknown as R2Bucket,
      ENVIRONMENT: 'production',
      AUTH_MODE: 'access',
    };

    const req = new Request('https://audit.test/api/auth/me');
    const auth = await authenticateRequest(req, env);
    expect(auth.user).toBeNull();
    expect(auth.error).toContain('Missing Cloudflare Access credentials');
  });

  it('Only designated admin email can be auto-provisioned as ADMIN in production Access', async () => {
    const mockDb = {
      prepare: vi.fn().mockImplementation((query: string) => ({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(null), // not registered yet
          all: vi.fn().mockResolvedValue({ results: [{ role: 'ADMIN' }] }),
          run: vi.fn().mockResolvedValue({ success: true }),
        }),
      })),
    } as unknown as D1Database;

    const env: Env = {
      DB: mockDb,
      PHOTO_BUCKET: {} as unknown as R2Bucket,
      ENVIRONMENT: 'production',
      AUTH_MODE: 'access',
      ADMIN_EMAILS: 'salahdhy@gmail.com',
    };

    // Whitelisted admin
    const adminReq = new Request('https://audit.test/api/auth/me', {
      headers: {
        'Cf-Access-Jwt-Assertion': 'jwt.token.valid',
        'Cf-Access-Authenticated-User-Email': 'salahdhy@gmail.com',
      },
    });

    const adminAuth = await authenticateRequest(adminReq, env);
    expect(adminAuth.user).not.toBeNull();
    expect(adminAuth.user?.email).toBe('salahdhy@gmail.com');
    expect(adminAuth.user?.roles).toContain('ADMIN');

    // Non-whitelisted user attempting first login
    const strangerReq = new Request('https://audit.test/api/auth/me', {
      headers: {
        'Cf-Access-Jwt-Assertion': 'jwt.token.valid',
        'Cf-Access-Authenticated-User-Email': 'stranger@example.com',
      },
    });

    const strangerAuth = await authenticateRequest(strangerReq, env);
    expect(strangerAuth.user).toBeNull();
    expect(strangerAuth.error).toContain('未在系统中授权');
  });
});

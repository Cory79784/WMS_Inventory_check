import { HealthResponse, DiagnosticRecord, Hall, PhotoUploadResult } from '../types';

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch('/api/health');
  if (!res.ok) {
    throw new Error(`Health check failed: HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchD1Data(): Promise<{ halls: Hall[]; diagnostics: DiagnosticRecord[] }> {
  const res = await fetch('/api/d1-test');
  if (!res.ok) {
    const errorJson = await res.json().catch(() => ({}));
    throw new Error(errorJson.error || `D1 fetch failed: HTTP ${res.status}`);
  }
  const json = await res.json();
  return json.data;
}

export async function writeD1TestRecord(
  testKey: string,
  testValue: string,
  notes?: string
): Promise<{ success: boolean; record: DiagnosticRecord; message: string }> {
  const res = await fetch('/api/d1-test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      testKey,
      testValue,
      clientTimestamp: new Date().toISOString(),
      notes,
    }),
  });

  if (!res.ok) {
    const errorJson = await res.json().catch(() => ({}));
    throw new Error(errorJson.error || `D1 write failed: HTTP ${res.status}`);
  }
  return res.json();
}

export async function uploadR2TestFile(file: File): Promise<PhotoUploadResult> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch('/api/r2-test', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const errorJson = await res.json().catch(() => ({}));
    throw new Error(errorJson.error || `R2 upload failed: HTTP ${res.status}`);
  }

  const json = await res.json();
  return json.file;
}

export async function listR2TestFiles(): Promise<{ key: string; size: number; uploaded: string; etag: string }[]> {
  const res = await fetch('/api/r2-test');
  if (!res.ok) {
    const errorJson = await res.json().catch(() => ({}));
    throw new Error(errorJson.error || `R2 list failed: HTTP ${res.status}`);
  }
  const json = await res.json();
  return json.objects || [];
}

export async function fetchAuthMe(): Promise<{ authenticated: boolean; mode: string; user?: unknown; error?: string }> {
  const res = await fetch('/api/auth/me');
  return res.json();
}

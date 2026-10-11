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

export async function fetchActiveVersion(hallId: string): Promise<any> {
  const res = await fetch(`/api/inventory/active-version?hallId=${hallId}`);
  if (!res.ok) {
    const errorJson = await res.json().catch(() => ({}));
    throw new Error(errorJson.error || `Failed to fetch active version: HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchLocationsList(hallId: string, query?: string): Promise<string[]> {
  const url = `/api/inventory/locations?hallId=${hallId}${query ? `&query=${encodeURIComponent(query)}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = await res.json();
  return json.locations || [];
}

export async function fetchLocationAudit(hallId: string, locationCode: string): Promise<any> {
  const res = await fetch(`/api/inventory/location?hallId=${hallId}&locationCode=${encodeURIComponent(locationCode)}`);
  if (!res.ok) {
    const errorJson = await res.json().catch(() => ({}));
    throw new Error(errorJson.error || `Failed to load location: HTTP ${res.status}`);
  }
  const json = await res.json();
  return json.data;
}

export async function saveLocationInspection(payload: any): Promise<any> {
  const res = await fetch('/api/inventory/inspection/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorJson = await res.json().catch(() => ({}));
    throw new Error(errorJson.error || `Failed to save inspection: HTTP ${res.status}`);
  }
  return res.json();
}

export async function uploadInspectionPhoto(
  file: File, hallId: string, locationCode: string, onProgress?: (percent: number) => void
): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const query = new URLSearchParams({ hallId, locationCode, filename: file.name });
    xhr.open('POST', `/api/inventory/inspection/photo?${query}`);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round(event.loaded / event.total * 100));
    };
    xhr.onload = () => {
      try {
        const result = JSON.parse(xhr.responseText);
        if (xhr.status < 200 || xhr.status >= 300 || !result.success) {
          reject(new Error(result.error || `Photo upload failed: HTTP ${xhr.status}`));
        } else {
          resolve(result);
        }
      } catch {
        reject(new Error('照片上传响应无效'));
      }
    };
    xhr.onerror = () => reject(new Error('照片上传网络失败，请重试'));
    xhr.onabort = () => reject(new Error('照片上传已取消'));
    xhr.send(file);
  });
}

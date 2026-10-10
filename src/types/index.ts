export type HallId = 'H1' | 'H2' | 'H3';

export interface Hall {
  hall_id: HallId;
  name: string;
  description?: string;
  created_at: string;
}

export interface DiagnosticRecord {
  id: string;
  test_key: string;
  test_value: string;
  client_timestamp: string | null;
  server_timestamp: string;
  notes: string | null;
}

export interface HealthResponse {
  status: string;
  system: string;
  phase: string;
  timestamp: string;
  environment: string;
  bindings: {
    d1: {
      available: boolean;
      details: string;
    };
    r2: {
      available: boolean;
      details: string;
    };
  };
}

export interface ScanEvent {
  id: string;
  code: string;
  timestamp: string;
  inputMethod: 'keyboard-wedge' | 'manual' | 'rapid-scan';
  detectedEnter: boolean;
  detectedTab: boolean;
  charIntervalAvgMs: number;
  likelyType: 'LOCATION' | 'SKU_OR_BARCODE' | 'UNKNOWN';
}

export interface PhotoUploadResult {
  key: string;
  size: number;
  mimeType: string;
  etag: string;
  previewUrl?: string;
}

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

export interface LocationSkuItem {
  sku: string;
  barcode: string;
  eBarcode: string;
  customerCode: string;
  nameZh: string;
  nameEn: string;
  systemQty: number;
  availableQty: number;
  allocatedQty: number;
  frozenQty: number;
  actualQty: number | null;
  differenceQty: number | null;
  discrepancyType: 'NORMAL' | 'SURPLUS' | 'SHORTAGE' | 'UNEXPECTED_SKU' | 'NO_SKU_SURPLUS' | null;
  notes?: string;
}

export interface InspectionPhotoItem {
  photoId: string;
  objectKey: string;
  previewUrl?: string;
}

export interface InspectionExportRow {
  inspectionId: string;
  hallId: string;
  locationCode: string;
  sku: string;
  barcode: string;
  systemQty: number;
  actualQty: number;
  differenceQty: number;
  completedAt: string;
  versionNumber: number;
  referenceImportId: string;
  notes: string;
  photoKeys: string[];
}

export interface LocationAuditData {
  hallId: HallId;
  locationCode: string;
  referenceImportId: string;
  versionNumber: number;
  sourceExportedAt: string | null;
  hasBookStock: boolean;
  lastInspection?: { completedAt: string; versionNumber: number } | null;
  skus: LocationSkuItem[];
  inspection: {
    inspectionId?: string;
    status: string;
    isEmptyConfirmed: boolean;
    notes: string;
    completedAt: string | null;
    photos: InspectionPhotoItem[];
  } | null;
  navigation: {
    currentIndex: number | null;
    totalLocations: number;
    prevLocationCode: string | null;
    nextLocationCode: string | null;
  };
}

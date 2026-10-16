// Line identity is independent of SKU text and remains stable across saves.
export const skuInspectionId = (inspectionId: string, lineId: string) =>
  `line:${encodeURIComponent(inspectionId)}:${encodeURIComponent(lineId)}`;
export function inspectionLineId(inspectionId: string, recordId: string): string {
  const prefix = `line:${encodeURIComponent(inspectionId)}:`;
  return recordId.startsWith(prefix) ? decodeURIComponent(recordId.slice(prefix.length)) : recordId;
}

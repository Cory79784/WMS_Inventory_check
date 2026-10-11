// User-approved local sequence: change the middle segment only; never wrap rows/layers.
// These are adjacent codes, not a claim that every physical location exists.
export function adjacentLocation(locationCode: string, offset: -1 | 1): string | null {
  const match = /^(\d+)-(\d+)-(\d+)$/.exec(locationCode);
  if (!match) return null;
  const next = Number(match[2]) + offset;
  if (!Number.isSafeInteger(next) || next < 1 || String(next).length > match[2].length) return null;
  return `${match[1]}-${String(next).padStart(match[2].length, '0')}-${match[3]}`;
}

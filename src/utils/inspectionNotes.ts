const RETURN_PREFIX = '@wms-return-v1:';

// Store per-SKU return metadata in the existing notes field; old plain notes stay valid.
export function encodeInspectionNotes(notes = '', isReturn = false, returnCode = ''): string {
  if (!isReturn && !notes.startsWith(RETURN_PREFIX)) return notes;
  return RETURN_PREFIX + JSON.stringify({ notes, isReturn, returnCode: isReturn ? returnCode.trim() : '' });
}

export function decodeInspectionNotes(value: string | null | undefined): {
  notes: string; isReturn: boolean; returnCode: string;
} {
  const notes = value || '';
  if (notes.startsWith(RETURN_PREFIX)) {
    try {
      const data = JSON.parse(notes.slice(RETURN_PREFIX.length));
      if (typeof data.notes === 'string' && typeof data.isReturn === 'boolean' && typeof data.returnCode === 'string') {
        return { notes: data.notes, isReturn: data.isReturn, returnCode: data.isReturn ? data.returnCode : '' };
      }
    } catch { /* Leave malformed or unrelated historic notes intact. */ }
  }
  return { notes, isReturn: false, returnCode: '' };
}

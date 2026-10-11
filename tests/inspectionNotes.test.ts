import { describe, it, expect } from 'vitest';
import { encodeInspectionNotes, decodeInspectionNotes } from '../src/utils/inspectionNotes';

describe('Return metadata in existing SKU notes', () => {
  it('keeps historical notes intact', () => {
    expect(encodeInspectionNotes('现场少货 2 件')).toBe('现场少货 2 件');
    expect(decodeInspectionNotes('现场少货 2 件')).toEqual({ notes: '现场少货 2 件', isReturn: false, returnCode: '' });
  });
  it('round trips optional return identifiers and human notes without losing leading zeroes', () => {
    expect(decodeInspectionNotes(encodeInspectionNotes('退货\n客户备注', true, ' 0001234567 ')))
      .toEqual({ notes: '退货\n客户备注', isReturn: true, returnCode: '0001234567' });
    expect(decodeInspectionNotes(encodeInspectionNotes('', true))).toEqual({ notes: '', isReturn: true, returnCode: '' });
  });
  it('clears identifiers when no longer marked as a return', () => {
    expect(decodeInspectionNotes(encodeInspectionNotes('正常', false, 'old-code')))
      .toEqual({ notes: '正常', isReturn: false, returnCode: '' });
  });
  it('does not reinterpret unrelated, malformed, or literal marker notes', () => {
    for (const notes of ['@wms-return-v1:broken', '@wms-return-v1:null', '@wms-return-v1:{"notes":"a"}',
      '@wms-return-v1:{"notes":"literal","isReturn":true,"returnCode":"literal-code"}']) {
      expect(decodeInspectionNotes(encodeInspectionNotes(notes)).notes).toBe(notes);
    }
    expect(decodeInspectionNotes('@wms-return-v1:broken').isReturn).toBe(false);
  });
});

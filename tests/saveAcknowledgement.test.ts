import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveLocationInspection } from '../src/services/api';
afterEach(()=>vi.unstubAllGlobals());
describe('D1 save acknowledgement contract',()=>{
  it.each([{success:false},{success:true},{inspectionId:'id',savedAt:'time'}])('rejects ambiguous HTTP 200 body %j',async body=>{
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json(body)));
    await expect(saveLocationInspection({})).rejects.toThrow('Save was not confirmed');
  });
  it('accepts only explicit server acknowledgement',async()=>{
    const saved={success:true,inspectionId:'id',savedAt:'2026-10-13T12:00:00Z'};
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json(saved)));
    expect(await saveLocationInspection({})).toEqual(saved);
  });
});

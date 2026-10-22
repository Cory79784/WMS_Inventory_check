import {describe,it,expect} from 'vitest';
import {parseCountRows} from '../src/skuCount/import';
import {buildCountPlan,expectedIdentity,needsIdentityPhoto,type CountRow} from '../src/skuCount/model';
const row=(patch:Partial<CountRow>={}):CountRow=>({hall:'H1',location:'107-002-1',sku:'000123',qty:5,barcode:'000045',eBarcode:'X-1,X-2',customer:'C',name:'原名',...patch});
const plan=(rows:CountRow[],skus=['000123'])=>buildCountPlan(rows,'H1',skus,'source.xlsx','a'.repeat(64));
describe('SKU-count import and frozen task scope',()=>{
 it('reads the supplied format without losing identifier zeroes, validates quantities and rejects ambiguous headers',()=>{
  const data=parseCountRows([['SKU编码','Barcode','eBarcode','客户编码','中文名称','库区','库位','库位库存','可用库存','已分配待出库存','冻结库存'],['000123','000045','X-1,X-2','C','原名','H1','107-002-1','5','4','1','0']]);
  expect(data[0]).toMatchObject({sku:'000123',barcode:'000045',qty:5,availableQty:4,allocatedQty:1,frozenQty:0});
  for(const qty of ['',-1,'1.5','unknown',Number.MAX_SAFE_INTEGER+1]) expect(()=>parseCountRows([['SKU编码','库区','库位','库位库存'],['SKU','H1','L',qty]])).toThrow();
  expect(()=>parseCountRows([['SKU编码','SKU','库区','库位','库位库存'],['A','B','H1','L',1]])).toThrow('DUPLICATE_HEADER');
  expect(()=>parseCountRows([['SKU编码','库位'],['A','L']])).toThrow('MISSING_HEADERS');
 });
 it('groups selected SKUs by location, sums duplicate stock and keeps all source floors without changing other halls',()=>{
  const p=plan([row(),row({qty:2}),row({sku:'OTHER',qty:3}),row({location:'107-010-5'}),row({hall:'H2',location:'107-002-1',qty:99})],['000123','OTHER']);
  expect(p.route).toEqual(['107-002-1','107-010-5']);expect(p.targets).toHaveLength(2);expect(p.targets[0].skus).toHaveLength(2);expect(p.targets[0].skus.find(s=>s.sku==='000123')?.qty).toBe(7);
  expect(p.sourceRows).toBe(4);expect(p.sourceFile).toBe('source.xlsx');
  expect(()=>plan([row(),row({customer:'DIFFERENT'})])).toThrow('AMBIGUOUS_CUSTOMER');
  expect(()=>plan([row()],['MISSING'])).toThrow('EMPTY_SCOPE');
 });
 it('requires images for different or unknown identities, but not for same-SKU quantity differences or known alternate barcodes',()=>{
  const target=plan([row()]).targets[0];
  expect(expectedIdentity(target,{sku:'000123',barcode:''})).toBe(true);expect(expectedIdentity(target,{sku:'',barcode:'X-2'})).toBe(true);expect(expectedIdentity(target,{sku:'000123',barcode:'WRONG'})).toBe(false);
  const extra={id:'extra:test-id-0001',sku:'000123',barcode:'',actual:2,notes:''};
  expect(needsIdentityPhoto(target,extra)).toBe(false);expect(needsIdentityPhoto(target,{...extra,sku:'OTHER'})).toBe(true);expect(needsIdentityPhoto(target,{...extra,sku:''})).toBe(true);
  expect(needsIdentityPhoto(target,{...extra,sku:'OTHER',actual:0})).toBe(false);
 });
});

it('accepts all named areas, groups only the three explicit second floors, and orders primary halls first',async()=>{
 const {areaScope,orderedScopes,validScope}=await import('../src/skuCount/areas');
 const areas=['RT','Halle3/2F','Halle1/2F','Halle2/2F','Halle2-Defective','Halle2-Shelves','D02','H2office','Halle1','WS','XH','NEW-ZONE'];
 const imported=parseCountRows([['SKU编码','库区','库位','库位库存'],...areas.map(a=>['S',a,'L',1])]);
 expect(imported).toHaveLength(areas.length);for(const area of ['Halle1/2F','Halle2/2F','Halle3/2F'])expect(areaScope(area)).toBe('SMALL_GOODS');
 expect(areaScope('Halle1')).toBe('AREA:HALLE1');expect(validScope('RT')).toBe(false);expect(validScope('AREA:RT')).toBe(false);expect(validScope('AREA:H1')).toBe(false);
 expect(orderedScopes(['AREA:XH','SMALL_GOODS','H3','AREA:D02','AREA:RT'])).toEqual(['H1','H2','H3','SMALL_GOODS','AREA:D02','AREA:XH']);
 expect(()=>parseCountRows([['SKU编码','库区','库位','库位库存'],[],['S','','L',1]])).toThrow('INVALID_ROW:3');
});
it('keeps same-code locations in small-goods areas separate and preserves excluded RT evidence outside the route',()=>{
 const rows=[row({hall:'Halle1/2F',location:'M-1',qty:2}),row({hall:'Halle2/2F',location:'M-1',qty:3}),row({hall:'RT',location:'RT-1',qty:7}),row({hall:'H1',location:'M-1',qty:99})];
 const p=buildCountPlan(rows,'SMALL_GOODS',['000123'],'source.xlsx','a'.repeat(64));
 expect(p.route).toEqual(['HALLE1/2F / M-1','HALLE2/2F / M-1']);expect(p.targets.map(t=>t.skus[0].qty)).toEqual([2,3]);expect(p.sourceRows).toBe(2);
 expect(p.excludedReturns?.[0]).toMatchObject({hall:'RT',location:'RT-1',sku:'000123',qty:7});expect(p.locations?.[p.route[0]]).toEqual({area:'Halle1/2F',code:'M-1'});
 expect(()=>buildCountPlan(rows,'AREA:RT',['000123'],'source.xlsx','a'.repeat(64))).toThrow('INVALID_SOURCE');
 const other=buildCountPlan([row({hall:'WS'})],'AREA:WS',['000123'],'source.xlsx','a'.repeat(64));expect(other.route).toEqual(['WS / 107-002-1']);
});

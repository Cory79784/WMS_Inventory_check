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

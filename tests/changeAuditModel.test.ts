import {describe,it,expect} from 'vitest';
import {snakeRoute,defaultRoute,buildPlan,similarCode,blankResult} from '../src/changeAudit/model';
import type {SnapshotComparison} from '../src/types';
const comparison=(locations:any[]):SnapshotComparison=>({hallId:'H1',oldVersion:{} as any,newVersion:{} as any,summary:{} as any,locations});
const changed=(locationCode:string,sku='ABC12345',oldQty=1,newQty=2)=>({locationCode,changeType:'CHANGED',oldTotalQty:oldQty,newTotalQty:newQty,changes:[{sku,barcode:'00001',nameZh:'',locationCode,oldQty,newQty,differenceQty:newQty-oldQty,changeType:'QUANTITY_CHANGED'}]});
describe('Snake route independent of risk',()=>{
 it('interleaves facing racks and reverses the next aisle with no omissions or duplicates',()=>{
  const codes=['103-001-1','104-001-1','103-099-1','104-099-1','105-001-1','106-001-1','105-099-1','106-099-1'];
  expect(snakeRoute([...codes,...codes],defaultRoute).route).toEqual([codes[0],codes[1],codes[2],codes[3],codes[6],codes[7],codes[4],codes[5]]);
 });
 it('counts empty intermediate aisles in physical direction parity and separates special places',()=>{
  const actual=snakeRoute(['103-001-1','103-099-1','107-001-1','107-099-1','107-001-2','REI-14','110-100'],defaultRoute);
  expect(actual.route).toEqual(['103-001-1','103-099-1','107-001-1','107-099-1']);expect(actual.special).toEqual(['107-001-2','110-100','REI-14']);
 });
 it('supports reverse starts, explicit pairs and middle starts without dropping targets',()=>{
  const codes=['103-001-1','106-001-1','103-090-1','106-090-1','104-001-1','105-001-1'];
  const config={startRack:106,startEnd:'high' as const,pairs:[[103,106],[104,105]]};
  expect(snakeRoute(codes,config).route).toEqual(['103-090-1','106-090-1','103-001-1','106-001-1','104-001-1','105-001-1']);
  expect(new Set(snakeRoute(codes,{...config,startRack:104}).route)).toEqual(new Set(codes));
  expect(()=>snakeRoute(codes,{...config,pairs:[[103,106],[103,104]]})).toThrow('INVALID_ROUTE');
  expect(()=>snakeRoute(codes,{...config,startRack:999})).toThrow('INVALID_START');
 });
});
describe('Explainable risk from full new stock',()=>{
 it('sees unchanged SKUs and nearby stock, records customer evidence, and never changes route',()=>{
  const source=comparison([changed('103-001-1'),changed('104-001-1','CHAIR-BLACK',5,0)]);
  const stock=[{location:'103-001-1',sku:'ABC12345',barcode:'',customer:'C1',name:'',qty:2},
   {location:'103-001-1',sku:'CHAIR-WHITE',barcode:'',customer:'C2',name:'',qty:5},
   {location:'104-001-1',sku:'ABC12346',barcode:'',customer:'C1',name:'',qty:9},
   {location:'104-001-1',sku:'CHAIR-BLACK',barcode:'',customer:'C2',name:'',qty:1}];
  const plan=buildPlan(source,stock,defaultRoute),target=plan.targets[0];
  expect(target.skus.map(s=>s.sku)).toContain('CHAIR-WHITE');
  expect(target.risks.map(r=>r.kind)).toEqual(expect.arrayContaining(['multi','similarCustomer','nearby','variant']));
  expect(target.risks.find(r=>r.kind==='similarCustomer')?.params).toMatchObject({customer:'C1',sku:'ABC12345',other:'ABC12346',location:'104-001-1'});
  expect(plan.route).toEqual(buildPlan(source,[],defaultRoute).route);
 });
 it('does not treat big single-SKU movements, numbers alone, or customer alone as high risk',()=>{
  const source=comparison([changed('103-001-1','12345678',1,1000)]);
  const plan=buildPlan(source,[{location:'103-001-1',sku:'12345678',barcode:'',customer:'C1',name:'',qty:1000},
   {location:'140-010-1',sku:'87654321',barcode:'',customer:'C1',name:'',qty:20}],defaultRoute);
  expect(plan.targets[0].risks).toEqual([]);expect(blankResult(plan.targets[0]).lines[0].actual).toBeNull();
  expect(similarCode('12345678','12345679')).toBe(true);expect(similarCode('12','13')).toBe(false);
 });
 it('links multiple reverse movement candidates as clues without forcing a pairing',()=>{
  const source=comparison([changed('103-001-1','skuX',10,0),changed('104-001-1','skuX',0,5),changed('105-001-1','skuX',0,5)]);
  const target=buildPlan(source,[],defaultRoute).targets[0];
  expect(target.risks[0]).toMatchObject({kind:'move',params:{count:2,locations:'104-001-1, 105-001-1'}});
 });
});
it('uses explicit name attributes to find same-customer variants even when codes differ',()=>{
 const source=comparison([changed('103-001-1','CODE-ONE')]);
 const plan=buildPlan(source,[{location:'103-001-1',sku:'CODE-ONE',barcode:'',customer:'C1',name:'办公椅 黑色',qty:2},
 {location:'140-010-1',sku:'DIFFERENT-CODE',barcode:'',customer:'C1',name:'办公椅 白色',qty:5}],defaultRoute);
 expect(plan.targets[0].risks).toContainEqual({kind:'variant',params:{sku:'CODE-ONE',other:'DIFFERENT-CODE'}});
});

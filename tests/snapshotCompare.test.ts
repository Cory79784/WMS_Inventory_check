import { beforeAll,afterAll,describe,it,expect } from 'vitest';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import ExcelJS from 'exceljs';
import { buildSnapshotComparisonWorkbook } from '../src/services/snapshotExport';
import type { SnapshotComparison } from '../src/types';
let mf:Miniflare,db:Awaited<ReturnType<Miniflare['getD1Database']>>;
const get=(path:string)=>mf.dispatchFetch(`http://localhost/api/inventory/${path}`);
const compare=(old='old',next='new',hall='H1')=>get(`snapshot-compare?hallId=${hall}&oldImportId=${old}&newImportId=${next}`);
beforeAll(async()=>{
 const bundle=await build({entryPoints:['worker/index.ts'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
 mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2024-10-11',d1Databases:['DB'],r2Buckets:['PHOTO_BUCKET'],bindings:{ENVIRONMENT:'test'}});
 await mf.dispatchFetch('http://localhost/api/health');db=await mf.getD1Database('DB');
 for(const [id,hall,v,status] of [['old','H1',1,'PUBLISHED'],['new','H1',2,'PUBLISHED'],['same','H1',3,'ARCHIVED'],['staging','H1',4,'STAGING'],['other','H2',1,'PUBLISHED']]) {
  await db.prepare('INSERT INTO inventory_imports(import_id,hall_id,version_number,original_filename,file_sha256,uploaded_by,status) VALUES(?,?,?,?,?,?,?)').bind(id,hall,v,'fixture.xlsx',id,'test',status).run();
 }
 await db.prepare("UPDATE active_hall_imports SET active_import_id='new' WHERE hall_id='H1'").run();
 let id=0;
 for(const [version,loc,sku,qty] of [
  ['old','a','0001',3],['old','A','0001',2],['new','A','0001',8],
  ['old','A','keep',10],['new','A','keep',10], // unchanged stock contributes to location totals
  ['old','B','move',4],['new','C','move',4],
  ['old','D','unchanged',7],['new','D','unchanged',7],
  ['old','ZERO','zero',0],['new','E','newSKU',2],
 ]) await db.prepare('INSERT INTO inventory_stock_rows(id,import_id,hall_id,location_code,sku,barcode,name_zh,system_qty) VALUES(?,?,?,?,?,?,?,?)').bind(String(++id),version,'H1',loc,sku,'000009','原文商品',qty).run();
 await db.prepare("INSERT INTO inventory_stock_rows(id,import_id,hall_id,location_code,sku,barcode,name_zh,system_qty) SELECT 'same-'||id,'same',hall_id,location_code,sku,barcode,name_zh,system_qty FROM inventory_stock_rows WHERE import_id='new'").run();
},20000);
afterAll(async()=>mf?.dispose());
describe('Read-only snapshot comparison against real D1',()=>{
 it('lists only published/archived versions of the selected hall',async()=>{
  const data=await(await get('snapshot-versions?hallId=H1')).json() as any;
  expect(data.versions.map((v:any)=>v.importId)).toEqual(['same','new','old']);expect(data.activeImportId).toBe('new');
 });
 it('aggregates duplicate lines, preserves whole location totals, and detects moves on both locations',async()=>{
  const before=await db.prepare('SELECT * FROM inventory_stock_rows ORDER BY id').all();
  const response=await compare();expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toBe('no-store');
  const {data}=await response.json() as {data:SnapshotComparison};
  expect(data.summary).toEqual({changedLocations:4,changedSkuRows:4,addedSkuRows:2,removedSkuRows:1,quantityChangedRows:1,newStockedLocations:2,emptiedLocations:1});
  expect(data.locations[0]).toMatchObject({locationCode:'A',oldTotalQty:15,newTotalQty:18,changes:[{sku:'0001',oldQty:5,newQty:8,differenceQty:3,changeType:'QUANTITY_CHANGED'}]});
  expect(data.locations[1]).toMatchObject({locationCode:'B',changeType:'EMPTIED_LOCATION',changes:[{sku:'move',differenceQty:-4}]});
  expect(data.locations[2]).toMatchObject({locationCode:'C',changeType:'NEW_LOCATION',changes:[{sku:'move',differenceQty:4}]});
  expect((await db.prepare('SELECT * FROM inventory_stock_rows ORDER BY id').all()).results).toEqual(before.results);
  expect(await db.prepare("SELECT active_import_id FROM active_hall_imports WHERE hall_id='H1'").first()).toMatchObject({active_import_id:'new'});
  expect((await db.prepare('SELECT COUNT(*) n FROM location_inspections').first())?.n).toBe(0);
 });
 it('returns no changes for identical snapshots, including different IDs',async()=>{
  const {data}=await(await compare('new','same')).json() as any;expect(data.locations).toEqual([]);expect(data.summary.changedSkuRows).toBe(0);
 });
 it('rejects cross-hall, staging, same, reversed, missing versions and writes',async()=>{
  for(const args of [['old','other'],['old','staging'],['old','old'],['new','old'],['old','missing']]) expect((await compare(...args)).status).toBe(400);
  expect((await compare('old','new','H2')).status).toBe(400);
  expect((await get('snapshot-versions?hallId=bad')).status).toBe(400);
  expect((await mf.dispatchFetch('http://localhost/api/inventory/snapshot-compare?hallId=H1',{method:'POST',headers:{Origin:'http://localhost'}})).status).toBe(405);
 });
 it.each(['zh','en','de'] as const)('exports every change with numeric quantities and original identifiers (%s)',async language=>{
  const {data}=await(await compare()).json() as {data:SnapshotComparison};
  const workbook=buildSnapshotComparisonWorkbook(data,language);
  const loaded=new ExcelJS.Workbook();await loaded.xlsx.load(await workbook.xlsx.writeBuffer());
  const sheet=loaded.worksheets[0];expect(sheet.rowCount).toBe(5);
  expect(sheet.getCell('E2').value).toBe('0001');expect(sheet.getCell('F2').value).toBe('000009');expect(sheet.getCell('G2').value).toBe('原文商品');
  expect(sheet.getCell('H2').value).toBe(5);expect(sheet.getCell('I2').value).toBe(8);expect(sheet.getCell('J2').value).toBe(3);
  expect(sheet.getCell('J3').value).toBe(-4);expect(sheet.getCell('K2').value).toBe(language==='zh'?'数量变化':language==='en'?'Quantity changed':'Menge geändert');
 });
});

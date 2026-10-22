import type {CountRow} from './model';
const aliases={sku:['SKU编码','SKU','sku'],hall:['库区','库厅','Hall'],location:['库位','库位编码','Location'],qty:['库位库存','库存数量','System quantity'],barcode:['Barcode','条码'],eBarcode:['eBarcode'],customer:['客户编码','Customer'],name:['中文名称','商品名称'],english:['英文名称'],availableQty:['可用库存'],allocatedQty:['已分配待出库存'],frozenQty:['冻结库存']} as const;
export function parseCountRows(matrix:unknown[][]):CountRow[] {
 if(matrix.length<2 || matrix.length>10001) throw new Error('INVALID_SOURCE');
 const headers=matrix[0].map(value=>String(value ?? '').trim()),columns:Record<string,number>={};
 for(const [field,names] of Object.entries(aliases)) {
  const found=headers.map((name,index)=>names.some(alias=>alias===name)?index:-1).filter(i=>i>=0);
  if(found.length>1) throw new Error('DUPLICATE_HEADER');
  columns[field]=found[0] ?? -1;
 }
 if(['sku','hall','location','qty'].some(field=>columns[field]<0)) throw new Error('MISSING_HEADERS');
 return matrix.slice(1).map((row,index)=>({row,index})).filter(({row})=>row.some(value=>value!==''&&value!==null&&value!==undefined)).map(({row,index})=>{
  const get=(field:string)=>String(row[columns[field]] ?? '').trim();
  const quantity=(field:string,required=false)=>{const raw=get(field);if(!raw && !required)return undefined;if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw)))throw new Error(`INVALID_QUANTITY:${index+2}`);return Number(raw);};
  const hall=get('hall'),sku=get('sku'),location=get('location').toUpperCase();
  if(!hall||hall.length>100||/[\x00-\x1f]/.test(hall)||!sku||!location) throw new Error(`INVALID_ROW:${index+2}`);
  return {hall:hall as CountRow['hall'],sku,location,qty:quantity('qty',true)!,barcode:get('barcode'),eBarcode:get('eBarcode'),customer:get('customer'),name:get('name') || get('english'),availableQty:quantity('availableQty'),allocatedQty:quantity('allocatedQty'),frozenQty:quantity('frozenQty')};
 });
}
export async function readCountFile(file:File) {
 if(file.size>10*1024*1024 || !/\.xlsx$/i.test(file.name)) throw new Error('INVALID_FILE');
 const bytes=await file.arrayBuffer(),XLSX=await import('xlsx');
 const workbook=XLSX.read(bytes,{type:'array',cellDates:false,sheetRows:10002});
 const quantityHeaders=new Set([...aliases.qty,...aliases.availableQty,...aliases.allocatedQty,...aliases.frozenQty]);
 const candidates=workbook.SheetNames.map(name=>{
  const sheet=workbook.Sheets[name],formatted=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,defval:'',raw:false}),raw=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,defval:'',raw:true});
  formatted[0]?.forEach((header,column)=>{if(quantityHeaders.has(String(header).trim() as never))for(let row=1;row<formatted.length;row++)if(typeof raw[row]?.[column]==='number')formatted[row][column]=raw[row][column];});
  return formatted;
 }).filter(rows=>rows[0]?.some(value=>aliases.sku.includes(String(value).trim() as never)));
 if(candidates.length!==1) throw new Error('SELECT_ONE_DATA_SHEET');
 const rows=parseCountRows(candidates[0]);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 return {rows,hash,file:file.name};
}

export const SMALL_GOODS='SMALL_GOODS';
export const mainHalls=['H1','H2','H3'] as const;
export const areaKey=(area:string)=>area.trim().toUpperCase();
export const isReturnArea=(area:string)=>areaKey(area)==='RT';
export function areaScope(area:string):string {
 const key=areaKey(area);
 if(mainHalls.some(h=>h===key))return key;
 if(/^HALLE[123]\/2F$/.test(key))return SMALL_GOODS;
 return `AREA:${key}`;
}
export function validScope(scope:unknown):scope is string {
 return typeof scope==='string'&&!/[\x00-\x1f]/.test(scope)&&(mainHalls.some(h=>h===scope)||scope===SMALL_GOODS||scope.startsWith('AREA:')&&scope.length<=105&&scope===areaScope(scope.slice(5))&&!isReturnArea(scope.slice(5)));
}
export function orderedScopes(scopes:string[]):string[] {
 return [...new Set([...mainHalls,SMALL_GOODS,...scopes.filter(validScope)])].sort((a,b)=>{
  const rank=(s:string)=>mainHalls.indexOf(s as typeof mainHalls[number])>=0?mainHalls.indexOf(s as typeof mainHalls[number]):s===SMALL_GOODS?3:4;
  return rank(a)-rank(b)||a.localeCompare(b,'en',{numeric:true});
 });
}
export function scopeLabel(scope:string,smallLabel:string):string {return scope===SMALL_GOODS?smallLabel:scope.startsWith('AREA:')?scope.slice(5):scope;}

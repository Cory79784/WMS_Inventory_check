import type { Env } from './types';
const COOKIE = 'wms_audit_manager';
const encode = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
async function signature(secret: string, value: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  return encode(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}
async function equal(a: string, b: string) {
  const hash = async (s: string) => encode(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
  const [x,y] = await Promise.all([hash(a),hash(b)]);
  let difference=0; for(let i=0;i<x.length;i++) difference |= x.charCodeAt(i)^y.charCodeAt(i);
  return difference===0;
}
export async function isAuditManager(request: Request, env: Env) {
  const secret = env.CHANGE_AUDIT_MANAGEMENT_KEY;
  if (!secret || secret.length < 24) return false;
  // Server-side automation can use the same capability; never infer authority from device/UA.
  const header=request.headers.get('X-Audit-Management-Key');
  if(header && await equal(header,secret)) return true;
  const cookie=request.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1) || '';
  const [expiry,mac]=cookie.split('.');
  return !!mac && /^\d+$/.test(expiry) && Number(expiry)>Date.now() && Number(expiry)<=Date.now()+31*86400000 && await equal(mac,await signature(secret,expiry));
}
export async function managerSession(request: Request, env: Env) {
  const headers: Record<string,string>={'Cache-Control':'no-store'};
  if(request.method==='POST') {
    const secret=env.CHANGE_AUDIT_MANAGEMENT_KEY;
    if(!secret || secret.length<24) return Response.json({error:'MANAGEMENT_NOT_CONFIGURED'},{status:503,headers});
    if(Number(request.headers.get('Content-Length')||0)>4096) return new Response(null,{status:413});
    const raw=await request.text();
    if(raw.length>4096) return new Response(null,{status:413});
    let supplied='';try{supplied=JSON.parse(raw).key || '';}catch{}
    if(typeof supplied!=='string' || !await equal(supplied,secret)) return Response.json({error:'MANAGEMENT_DENIED'},{status:403,headers});
    const expiry=String(Date.now()+30*86400000);
    headers['Set-Cookie']=`${COOKIE}=${expiry}.${await signature(secret,expiry)}; HttpOnly; Secure; SameSite=Strict; Path=/api/inventory/change-audit/; Max-Age=2592000`;
    return Response.json({manager:true},{headers});
  }
  if(request.method==='DELETE') { headers['Set-Cookie']=`${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/api/inventory/change-audit/; Max-Age=0`;return Response.json({manager:false},{headers}); }
  if(request.method!=='GET') return new Response(null,{status:405});
  return Response.json({manager:await isAuditManager(request,env),configured:!!env.CHANGE_AUDIT_MANAGEMENT_KEY && env.CHANGE_AUDIT_MANAGEMENT_KEY.length>=24},{headers});
}

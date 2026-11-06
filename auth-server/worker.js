const SCOPES='openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive.file';
const TOKEN_URL='https://oauth2.googleapis.com/token';
const USERINFO_URL='https://openidconnect.googleapis.com/v1/userinfo';
const SESSION_SECONDS=180*86400;
const utf8=new TextEncoder();
const b64=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const unb64=s=>Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
const random=()=>b64(crypto.getRandomValues(new Uint8Array(32)));
export const hash=async value=>b64(new Uint8Array(await crypto.subtle.digest('SHA-256',utf8.encode(value))));
const error=(status,code)=>Object.assign(new Error(code),{status,code});
export async function seal(value,keyText,aad){
 const key=await crypto.subtle.importKey('raw',unb64(keyText),'AES-GCM',false,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:utf8.encode(aad)},key,utf8.encode(value));
 return JSON.stringify({v:1,iv:b64(iv),data:b64(new Uint8Array(data))});
}
export async function unseal(value,keyText,aad){
 const saved=JSON.parse(value);if(saved.v!==1)throw error(503,'auth_unavailable');
 const key=await crypto.subtle.importKey('raw',unb64(keyText),'AES-GCM',false,['decrypt']);
 return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(saved.iv),additionalData:utf8.encode(aad)},key,unb64(saved.data)));
}
function response(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8'}});}
function redirect(url){return new Response(null,{status:303,headers:{Location:url}});}
function ready(env){try{return !!env.DB&&!!env.GOOGLE_CLIENT_SECRET&&unb64(env.TOKEN_ENCRYPTION_KEY).length===32;}catch{return false;}}
function returnTo(value,env){
 const app=new URL(env.APP_URL),url=new URL(value||app.href);
 if(url.origin!==app.origin||![app.pathname,app.pathname+'index.html'].includes(url.pathname))throw error(400,'invalid_return_url');
 const safe=new URL(app.href),workspace=url.searchParams.get('workspace');
 if(url.searchParams.get('auth_preview')==='1')safe.searchParams.set('auth_preview','1');
 if(workspace){if(!/^[\w-]{20,200}$/.test(workspace))throw error(400,'invalid_workspace');safe.searchParams.set('workspace',workspace);}
 return safe.href;
}
async function body(request){
 if(request.headers.get('Content-Type')?.split(';')[0]!=='application/json')throw error(415,'json_required');
 const text=await request.text();if(utf8.encode(text).length>4096)throw error(413,'request_too_large');
 try{return JSON.parse(text);}catch{throw error(400,'invalid_json');}
}
async function googleTokens(params,env,fetcher){
 const r=await fetcher(TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,...params}),signal:AbortSignal.timeout(20000)});
 const token=await r.json();
 if(!r.ok){if(token.error==='invalid_grant')throw error(401,'auth_required');throw error(503,'google_temporarily_unavailable');}
 if(typeof token.access_token!=='string'||!Number.isFinite(Number(token.expires_in))||Number(token.expires_in)<=0)throw error(503,'invalid_google_response');
 return token;
}
function assertScopes(token){const scopes=new Set(String(token.scope||'').split(' '));if(!['openid','https://www.googleapis.com/auth/userinfo.email','https://www.googleapis.com/auth/drive.file'].every(s=>scopes.has(s)))throw error(403,'required_permissions_missing');}
async function accountToken(account,env,fetcher,now,force=false){
 if(!force&&account.access_expires>now+60)return {access_token:await unseal(account.access_cipher,env.TOKEN_ENCRYPTION_KEY,'access:'+account.sub),expires_at:account.access_expires};
 const refresh=await unseal(account.refresh_cipher,env.TOKEN_ENCRYPTION_KEY,'refresh:'+account.sub);
 let token;try{token=await googleTokens({grant_type:'refresh_token',refresh_token:refresh},env,fetcher);}catch(e){if(e.code==='auth_required')await env.DB.prepare('DELETE FROM auth_sessions WHERE sub=?').bind(account.sub).run();throw e;}
 const expiry=now+Number(token.expires_in)-30;
 const accessCipher=await seal(token.access_token,env.TOKEN_ENCRYPTION_KEY,'access:'+account.sub);
 const refreshCipher=token.refresh_token?await seal(token.refresh_token,env.TOKEN_ENCRYPTION_KEY,'refresh:'+account.sub):account.refresh_cipher;
 await env.DB.prepare('UPDATE auth_accounts SET access_cipher=?,access_expires=?,refresh_cipher=?,updated_at=? WHERE sub=?').bind(accessCipher,expiry,refreshCipher,now,account.sub).run();
 return {access_token:token.access_token,expires_at:expiry};
}
async function start(request,env,origin,now){
 const data=await body(request),challenge=data.challenge;
 if(typeof challenge!=='string'||!/^[\w-]{43}$/.test(challenge))throw error(400,'invalid_challenge');
 const destination=returnTo(data.returnTo,env);
 const ipHash=await hash((request.headers.get('CF-Connecting-IP')||'unknown')+env.TOKEN_ENCRYPTION_KEY);
 const rate=await env.DB.prepare('SELECT COUNT(*) AS n FROM oauth_attempts WHERE ip_hash=? AND created_at>?').bind(ipHash,now-600).first();
 if(rate.n>=30)throw error(429,'try_again_later');
 // Expired temporary rows are bounded without touching account grants or app data.
 await env.DB.batch([env.DB.prepare('DELETE FROM oauth_attempts WHERE expires_at<?').bind(now),env.DB.prepare('DELETE FROM auth_handoffs WHERE expires_at<?').bind(now),env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at<?').bind(now)]);
 const state=random(),verifier=random(),stateHash=await hash(state);
 await env.DB.prepare('INSERT INTO oauth_attempts(state_hash,challenge,verifier_cipher,return_to,ip_hash,created_at,expires_at) VALUES(?,?,?,?,?,?,?)').bind(stateHash,challenge,await seal(verifier,env.TOKEN_ENCRYPTION_KEY,'pkce:'+stateHash),destination,ipHash,now,now+600).run();
 const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
 url.search=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:origin+'/auth/callback',response_type:'code',scope:SCOPES,access_type:'offline',include_granted_scopes:'true',prompt:'consent select_account',state,code_challenge:await hash(verifier),code_challenge_method:'S256'}).toString();
 return response({authorization_url:url.href,state});
}
async function storeGoogleGrant(token,env,fetcher,now){
 assertScopes(token);
 const identity=await fetcher(USERINFO_URL,{headers:{Authorization:'Bearer '+token.access_token},signal:AbortSignal.timeout(15000)});
 if(!identity.ok)throw error(503,'identity_unavailable');const user=await identity.json();
 if(!user.sub||!user.email||user.email_verified!==true)throw error(403,'unverified_google_identity');
 const previous=await env.DB.prepare('SELECT * FROM auth_accounts WHERE sub=?').bind(user.sub).first();
 if(!token.refresh_token&&!previous)throw error(403,'offline_permission_required');
 const refreshCipher=token.refresh_token?await seal(token.refresh_token,env.TOKEN_ENCRYPTION_KEY,'refresh:'+user.sub):previous.refresh_cipher;
 await env.DB.prepare('INSERT INTO auth_accounts(sub,email,refresh_cipher,access_cipher,access_expires,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(sub) DO UPDATE SET email=excluded.email,refresh_cipher=excluded.refresh_cipher,access_cipher=excluded.access_cipher,access_expires=excluded.access_expires,updated_at=excluded.updated_at').bind(user.sub,user.email.toLowerCase(),refreshCipher,await seal(token.access_token,env.TOKEN_ENCRYPTION_KEY,'access:'+user.sub),now+Number(token.expires_in)-30,now).run();
 return {sub:user.sub,email:user.email.toLowerCase()};
}
async function callback(url,env,fetcher,now){
 const state=url.searchParams.get('state');if(!state||!/^[\w-]{43}$/.test(state))throw error(400,'invalid_oauth_state');
 const stateHash=await hash(state);
 const attempt=await env.DB.prepare('DELETE FROM oauth_attempts WHERE state_hash=? AND expires_at>? RETURNING *').bind(stateHash,now).first();
 if(!attempt)throw error(400,'expired_oauth_state');
 const destination=new URL(attempt.return_to);
 if(url.searchParams.get('error')){destination.hash=new URLSearchParams({subong_auth_error:'cancelled',state}).toString();return redirect(destination.href);}
 const code=url.searchParams.get('code');if(!code||code.length>4096)throw error(400,'invalid_oauth_code');
 const token=await googleTokens({grant_type:'authorization_code',code,redirect_uri:url.origin+'/auth/callback',code_verifier:await unseal(attempt.verifier_cipher,env.TOKEN_ENCRYPTION_KEY,'pkce:'+stateHash)},env,fetcher);
 const user=await storeGoogleGrant(token,env,fetcher,now);
 const handoff=random();await env.DB.prepare('INSERT INTO auth_handoffs(code_hash,state_hash,challenge,sub,expires_at) VALUES(?,?,?,?,?)').bind(await hash(handoff),stateHash,attempt.challenge,user.sub,now+120).run();
 destination.hash=new URLSearchParams({subong_auth:handoff,state}).toString();return redirect(destination.href);
}
async function codeLogin(request,env,fetcher,now){
 if(request.headers.get('X-Requested-With')!=='XmlHttpRequest')throw error(403,'csrf_header_required');
 const data=await body(request);if(typeof data.code!=='string'||!data.code||data.code.length>4096)throw error(400,'invalid_oauth_code');
 const bucket=(await hash((request.headers.get('CF-Connecting-IP')||'unknown')+env.TOKEN_ENCRYPTION_KEY))+':'+Math.floor(now/600);
 await env.DB.prepare('DELETE FROM auth_code_limits WHERE expires_at<?').bind(now).run();
 const limit=await env.DB.prepare('INSERT INTO auth_code_limits(bucket_key,n,expires_at) VALUES(?,1,?) ON CONFLICT(bucket_key) DO UPDATE SET n=n+1 RETURNING n').bind(bucket,now+600).first();
 if(limit.n>30)throw error(429,'try_again_later');
 const token=await googleTokens({grant_type:'authorization_code',code:data.code,redirect_uri:new URL(env.APP_URL).origin},env,fetcher);
 const user=await storeGoogleGrant(token,env,fetcher,now),account=await env.DB.prepare('SELECT * FROM auth_accounts WHERE sub=?').bind(user.sub).first();
 const session=random(),expiry=now+SESSION_SECONDS;
 await env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at<?').bind(now).run();
 await env.DB.prepare('INSERT INTO auth_sessions(session_hash,sub,created_at,expires_at,last_seen) VALUES(?,?,?,?,?)').bind(await hash(session),user.sub,now,expiry,now).run();
 return response({session,session_expires:expiry,user,...await accountToken(account,env,fetcher,now)});
}
async function exchange(request,env,fetcher,now){
 const data=await body(request);
 if(!/^[\w-]{43}$/.test(data.code||'')||!/^[\w-]{43}$/.test(data.state||'')||!/^[\w-]{43}$/.test(data.verifier||''))throw error(400,'invalid_handoff');
 const codeHash=await hash(data.code),stateHash=await hash(data.state),challenge=await hash(data.verifier);
 // Incorrect binding must not consume another browser's valid handoff.
 const handoff=await env.DB.prepare('DELETE FROM auth_handoffs WHERE code_hash=? AND state_hash=? AND challenge=? AND expires_at>? RETURNING *').bind(codeHash,stateHash,challenge,now).first();
 if(!handoff)throw error(401,'invalid_or_expired_handoff');
 const account=await env.DB.prepare('SELECT * FROM auth_accounts WHERE sub=?').bind(handoff.sub).first();if(!account)throw error(401,'auth_required');
 const session=random(),sessionExpiry=now+SESSION_SECONDS;
 await env.DB.prepare('INSERT INTO auth_sessions(session_hash,sub,created_at,expires_at,last_seen) VALUES(?,?,?,?,?)').bind(await hash(session),account.sub,now,sessionExpiry,now).run();
 return response({session,session_expires:sessionExpiry,user:{sub:account.sub,email:account.email},...await accountToken(account,env,fetcher,now)});
}
async function session(request,env,fetcher,now,logout=false){
 const bearer=request.headers.get('Authorization')?.match(/^Bearer ([\w-]{43})$/)?.[1];if(!bearer)throw error(401,'auth_required');
 const sid=await hash(bearer),saved=await env.DB.prepare('SELECT * FROM auth_sessions WHERE session_hash=? AND expires_at>?').bind(sid,now).first();if(!saved)throw error(401,'auth_required');
 if(logout){await env.DB.prepare('DELETE FROM auth_sessions WHERE session_hash=?').bind(sid).run();return response({signed_out:true});}
 const input=await body(request),account=await env.DB.prepare('SELECT * FROM auth_accounts WHERE sub=?').bind(saved.sub).first();if(!account)throw error(401,'auth_required');
 const token=await accountToken(account,env,fetcher,now,input.force===true);
 const expiry=now+SESSION_SECONDS;
 if(saved.last_seen<now-3600)await env.DB.prepare('UPDATE auth_sessions SET expires_at=?,last_seen=? WHERE session_hash=?').bind(expiry,now,sid).run();
 return response({...token,user:{sub:account.sub,email:account.email},session_expires:saved.last_seen<now-3600?expiry:saved.expires_at});
}
export function createHandler({fetcher=(...args)=>fetch(...args),clock=()=>Date.now()}={}){
 return async function handle(request,env){
  let result;const url=new URL(request.url),appOrigin=new URL(env.APP_URL).origin,origin=request.headers.get('Origin');
  try{
   if(url.pathname==='/health'&&request.method==='GET')result=response({service:'subong-auth-v1',ready:ready(env),client_id:env.GOOGLE_CLIENT_ID});
   else{
    if(!ready(env))throw error(503,'auth_not_configured');
    if(url.pathname==='/auth/callback'&&request.method==='GET')result=await callback(url,env,fetcher,Math.floor(clock()/1000));
    else{
     if(origin!==appOrigin)throw error(403,'origin_not_allowed');
     if(request.method==='OPTIONS')result=new Response(null,{status:204});
     else if(request.method!=='POST')throw error(405,'post_required');
     else if(url.pathname==='/auth/code')result=await codeLogin(request,env,fetcher,Math.floor(clock()/1000));
     else if(url.pathname==='/auth/start')result=await start(request,env,url.origin,Math.floor(clock()/1000));
     else if(url.pathname==='/auth/exchange')result=await exchange(request,env,fetcher,Math.floor(clock()/1000));
     else if(url.pathname==='/auth/token')result=await session(request,env,fetcher,Math.floor(clock()/1000));
     else if(url.pathname==='/auth/logout')result=await session(request,env,fetcher,Math.floor(clock()/1000),true);
     else throw error(404,'not_found');
    }
   }
  }catch(e){result=response({error:e.code||'auth_temporarily_unavailable'},e.status||503);}
  const headers=new Headers(result.headers);headers.set('Cache-Control','no-store');headers.set('Referrer-Policy','no-referrer');headers.set('X-Content-Type-Options','nosniff');headers.set('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
  if(origin===appOrigin){headers.set('Access-Control-Allow-Origin',appOrigin);headers.set('Vary','Origin');headers.set('Access-Control-Allow-Methods','POST, OPTIONS');headers.set('Access-Control-Allow-Headers','Content-Type, Authorization, X-Requested-With');headers.set('Access-Control-Max-Age','600');}
  return new Response(result.body,{status:result.status,headers});
 };
}
export default {fetch:createHandler()};

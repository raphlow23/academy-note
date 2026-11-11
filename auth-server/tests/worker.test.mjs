import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHandler,hash,seal,unseal} from '../worker.js';
import {AUTH_TABLES,initializeAuthStorage,authDatabase} from '../auth-storage.js';
import {USAGE_SCHEMA,initializeUsageStorage} from '../usage.js';
const APP='https://raphlow23.github.io/academy-note/',ORIGIN=new URL(APP).origin,AUTH='https://auth.example.test';
const SCOPE='openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive.file';
const KEY=Buffer.alloc(32,17).toString('base64url');
function fixture(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
 const DB=process.env.AUTH_TEST_STORAGE==='durable'?authDatabase(sqliteStorage(sqlite)):{prepare(sql){let values=[];return {bind(...args){values=args;return this;},async first(){return sqlite.prepare(sql).get(...values)||null;},async run(){const meta=sqlite.prepare(sql).run(...values);return {success:true,meta:{changes:Number(meta.changes)}};}};},async batch(statements){return Promise.all(statements.map(s=>s.run()));}};
 let now=1793920000000,access=0,invalidRefresh=false,scope=SCOPE;const calls=[];
 sqlite.exec(USAGE_SCHEMA);sqlite.prepare('INSERT INTO usage_meta(id,started_at) VALUES(1,?)').run(Math.floor(now/1000));
 const fetcher=async(url,options={})=>{
  calls.push({url,options});
  if(url==='https://oauth2.googleapis.com/token'){
   const p=new URLSearchParams(options.body);assert.equal(p.get('client_secret'),'test-private-client-secret');
   if(p.get('grant_type')==='refresh_token'&&invalidRefresh)return new Response(JSON.stringify({error:'invalid_grant'}),{status:400});
   return Response.json({access_token:'google-access-'+(++access),expires_in:3600,scope,...(p.get('grant_type')==='authorization_code'?{refresh_token:'private-google-refresh'}:{})});
  }
  if(url==='https://openidconnect.googleapis.com/v1/userinfo')return Response.json({sub:'google-user-one',email:'owner@example.test',email_verified:true});
  throw Error('Authentication server must never request Sheets/Drive: '+url);
 };
 const env={DB,APP_URL:APP,GOOGLE_CLIENT_ID:'test.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'test-private-client-secret',TOKEN_ENCRYPTION_KEY:KEY};
 const handle=createHandler({fetcher,clock:()=>now});
 const post=(path,data={},token,origin=ORIGIN)=>handle(new Request(AUTH+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Requested-With':'XmlHttpRequest',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(data)}),env);
 async function login(){const verifier='v'.repeat(43),start=await (await post('/auth/start',{challenge:await hash(verifier),returnTo:APP+'?workspace=existing_sheet_123456789012345'})).json();const r=await handle(new Request(AUTH+'/auth/callback?'+new URLSearchParams({state:start.state,code:'one-use-google-code'})),env);assert.equal(r.status,303);const fragment=new URLSearchParams(new URL(r.headers.get('Location')).hash.slice(1));return {verifier,state:start.state,code:fragment.get('subong_auth'),start,redirect:r};}
 return {DB,sqlite,env,calls,post,handle,login,fetcher,advance:s=>now+=s*1000,invalidate:()=>invalidRefresh=true,restrictScopes:()=>scope='openid',now:()=>now};
}

function sqliteStorage(sqlite=new DatabaseSync(':memory:')){
 return {sql:{exec(query,...values){const statement=sqlite.prepare(query),rows=statement.all(...values);return {toArray:()=>rows,rowsWritten:0};}},transactionSync(fn){sqlite.exec('BEGIN');try{const result=fn();sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
}

test('usage timestamps are authenticated, deduplicated and independent of token refresh',async()=>{
 const f=fixture(),grant=await (await f.post('/auth/exchange',await f.login())).json();
 const at=Math.floor(f.now()/1000),event={id:'v'.repeat(32),kind:'visit',at};
 assert.equal((await f.post('/usage/event',event)).status,401);
 assert.equal((await f.post('/usage/event',{...event,email:'someone@example.test'},grant.session)).status,400);
 assert.equal((await f.post('/usage/event',event,grant.session)).status,200);
 f.advance(120);
 assert.equal((await f.post('/usage/event',{...event,kind:'save',at:at+120},grant.session)).status,200);
 let data=await (await f.post('/usage/status',{},grant.session)).json();
 assert.equal(data.accounts[0].lastVisit,at);assert(!data.accounts[0].lastSaved);
 await f.post('/auth/token',{},grant.session);
 data=await (await f.post('/usage/status',{},grant.session)).json();assert.equal(data.accounts[0].lastVisit,at);
 await f.post('/usage/event',{id:'w'.repeat(32),kind:'save',at:at+120},grant.session);
 data=await (await f.post('/usage/status',{},grant.session)).json();assert.equal(data.accounts[0].lastSaved,at+120);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM usage_events').get().n,2);
 assert(!JSON.stringify(data).includes('access_token'));assert(!JSON.stringify(data).includes('session_hash'));
});

test('only the configured operator sees other accounts, even when all app users own their sheets',async()=>{
 const f=fixture(),grant=await (await f.post('/auth/exchange',await f.login())).json();
 f.sqlite.exec("INSERT INTO auth_accounts SELECT 'other','other@example.test',refresh_cipher,access_cipher,access_expires,updated_at FROM auth_accounts LIMIT 1");
 let data=await (await f.post('/usage/status',{admin:true,sub:'other'},grant.session)).json();
 assert.equal(data.admin,false);assert.equal(data.accounts.length,1);assert.equal(data.accounts[0].email,'owner@example.test');
 f.env.USAGE_ADMIN_EMAILS='owner@example.test';
 data=await (await f.post('/usage/status',{},grant.session)).json();assert.equal(data.admin,true);assert.equal(data.accounts.length,2);
 assert.equal((await f.post('/usage/event',{id:'x'.repeat(32),kind:'visit',at:Math.floor(f.now()/1000)+301},grant.session)).status,400);
});

test('usage schema migration keeps existing sessions and timestamps across object restarts',()=>{
 const storage=sqliteStorage();initializeUsageStorage(storage,1000);
 storage.sql.exec('INSERT INTO usage_summary(sub,last_visit,last_saved) VALUES(?,?,?)','user',1100,1200);
 initializeUsageStorage(storage,2000);
 assert.equal(storage.sql.exec('SELECT started_at FROM usage_meta WHERE id=1').toArray()[0].started_at,1000);
 assert.equal(storage.sql.exec('SELECT last_saved FROM usage_summary').toArray()[0].last_saved,1200);
});

test('encrypted accounts and existing device sessions migrate once, renew and revoke without D1',async()=>{
 const f=fixture(),login=await (await f.post('/auth/exchange',await f.login())).json();
 const seed=Object.fromEntries(Object.keys(AUTH_TABLES).map(t=>[t,f.sqlite.prepare('SELECT * FROM '+t).all()]));
 const storage=sqliteStorage();initializeAuthStorage(storage,JSON.stringify(seed));
 const env={...f.env,DB:authDatabase(storage)};
 f.advance(3700);
 const request=()=>new Request(AUTH+'/auth/token',{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json',Authorization:'Bearer '+login.session},body:'{}'});
 const renewed=await f.handle(request(),env);assert.equal(renewed.status,200);assert.equal((await renewed.json()).user.sub,login.user.sub);
 initializeAuthStorage(storage); // No bootstrap secret needed after first initialization.
 const revoked=new Request(AUTH+'/auth/logout',{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json',Authorization:'Bearer '+login.session},body:'{}'});
 assert.equal((await f.handle(revoked,env)).status,200);
 initializeAuthStorage(storage,JSON.stringify(seed)); // Old seed cannot resurrect a logged-out session.
 assert.equal((await f.handle(request(),env)).status,401);
});

test('missing or partial authentication migration fails atomically rather than starting an empty login store',()=>{
 const storage=sqliteStorage();assert.throws(()=>initializeAuthStorage(storage),/not_initialized/);
 const invalid=Object.fromEntries(Object.keys(AUTH_TABLES).map(t=>[t,[]]));invalid.auth_accounts=[{sub:'incomplete'}];
 assert.throws(()=>initializeAuthStorage(storage,JSON.stringify(invalid)),/invalid_auth_bootstrap/);
 const valid=Object.fromEntries(Object.keys(AUTH_TABLES).map(t=>[t,[]]));
 initializeAuthStorage(storage,JSON.stringify(valid));
 assert.equal(storage.sql.exec('SELECT COUNT(*) AS n FROM auth_accounts').toArray()[0].n,0);
});
test('same OAuth client, offline scope, PKCE and original workspace return URL are preserved',async()=>{
 const f=fixture(),flow=await f.login(),url=new URL(flow.start.authorization_url);
 assert.equal(url.searchParams.get('client_id'),f.env.GOOGLE_CLIENT_ID);assert.equal(url.searchParams.get('access_type'),'offline');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('redirect_uri'),AUTH+'/auth/callback');assert.equal(url.searchParams.get('scope'),SCOPE);
 assert.equal(new URL(flow.redirect.headers.get('Location')).searchParams.get('workspace'),'existing_sheet_123456789012345');
 const account=f.sqlite.prepare('SELECT * FROM auth_accounts').get();assert(!account.refresh_cipher.includes('private-google-refresh'));assert(!account.access_cipher.includes('google-access-1'));
 assert.equal(await unseal(account.refresh_cipher,KEY,'refresh:'+account.sub),'private-google-refresh');
 assert(f.calls.every(c=>['https://oauth2.googleapis.com/token','https://openidconnect.googleapis.com/v1/userinfo'].includes(c.url)));
});
test('browser binding prevents stolen handoff exchange and each handoff is one-use',async()=>{
 const f=fixture(),flow=await f.login();assert.equal((await f.post('/auth/exchange',{...flow,verifier:'x'.repeat(43)})).status,401);
 const r=await f.post('/auth/exchange',flow);assert.equal(r.status,200);const result=await r.json();assert.equal(result.user.sub,'google-user-one');assert(result.session_expires*1000>f.now()+86400000);
 assert.equal((await f.post('/auth/exchange',flow)).status,401);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_handoffs').get().n,0);
 assert(!JSON.stringify(f.sqlite.prepare('SELECT * FROM auth_sessions').all()).includes(result.session));
});
test('expired Google access tokens renew silently through the same user session',async()=>{
 const f=fixture(),flow=await f.login(),saved=await (await f.post('/auth/exchange',flow)).json();f.advance(3700);
 const r=await f.post('/auth/token',{},saved.session);assert.equal(r.status,200);const renewed=await r.json();assert.equal(renewed.access_token,'google-access-2');assert.equal(renewed.user.sub,saved.user.sub);
 assert.equal(f.calls.filter(c=>c.url.endsWith('/token')).length,2);assert(!JSON.stringify(renewed).includes('private-google-refresh'));
});
test('logout revokes only that device session, not other sessions or Google sheet permissions',async()=>{
 const f=fixture(),first=await (await f.post('/auth/exchange',await f.login())).json(),second=await (await f.post('/auth/exchange',await f.login())).json();
 assert.equal((await f.post('/auth/logout',{},first.session)).status,200);assert.equal((await f.post('/auth/token',{},first.session)).status,401);assert.equal((await f.post('/auth/token',{},second.session)).status,200);
 assert.equal(f.calls.some(c=>c.url.includes('revoke')||c.url.includes('sheets.googleapis.com')||c.url.includes('drive/')),false);
});
test('unapproved origin, return URL and scopes are rejected without widening access',async()=>{
 const f=fixture(),data={challenge:'a'.repeat(43),returnTo:APP};assert.equal((await f.post('/auth/start',data,null,'https://attacker.test')).status,403);
 assert.equal((await f.post('/auth/start',{...data,returnTo:'https://attacker.test'})).status,400);
 const start=await (await f.post('/auth/start',data)).json();f.restrictScopes();assert.equal((await f.handle(new Request(AUTH+'/auth/callback?'+new URLSearchParams({state:start.state,code:'code'})),f.env)).status,403);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_accounts').get().n,0);
});
test('revoked Google grant clears authentication sessions and leaves all other data alone',async()=>{
 const f=fixture(),saved=await (await f.post('/auth/exchange',await f.login())).json();f.advance(3700);f.invalidate();assert.equal((await f.post('/auth/token',{},saved.session)).status,401);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n,0);
});
test('OAuth callback states expire and cannot be replayed',async()=>{
 const f=fixture(),flow=await f.login();assert.equal((await f.handle(new Request(AUTH+'/auth/callback?'+new URLSearchParams({state:flow.state,code:'again'})),f.env)).status,400);
 const start=await (await f.post('/auth/start',{challenge:'a'.repeat(43),returnTo:APP})).json();f.advance(601);assert.equal((await f.handle(new Request(AUTH+'/auth/callback?'+new URLSearchParams({state:start.state,code:'expired'})),f.env)).status,400);
});
test('encrypted tokens cannot be read under another user or a different token type',async()=>{
 const encrypted=await seal('test-token',KEY,'refresh:one');await assert.rejects(unseal(encrypted,KEY,'refresh:two'));await assert.rejects(unseal(encrypted,KEY,'access:one'));
});
test('unconfigured deployment fails closed and never asks for Google user permission',async()=>{
 const f=fixture();delete f.env.GOOGLE_CLIENT_SECRET;assert.equal((await (await f.handle(new Request(AUTH+'/health'),f.env)).json()).ready,false);assert.equal((await f.post('/auth/start',{challenge:'a'.repeat(43)})).status,503);assert.equal(f.calls.length,0);
});
test('start requests are bounded by an authentication-only rate limit',async()=>{
 const f=fixture();for(let i=0;i<30;i++)assert.equal((await f.post('/auth/start',{challenge:'a'.repeat(43),returnTo:APP})).status,200);assert.equal((await f.post('/auth/start',{challenge:'a'.repeat(43),returnTo:APP})).status,429);
});


test('GIS popup code uses the original GitHub origin and returns the same long-lived session',async()=>{
 const f=fixture(),r=await f.post('/auth/code',{code:'google-popup-code'});assert.equal(r.status,200);const result=await r.json();assert.equal(result.user.sub,'google-user-one');assert.equal(new URLSearchParams(f.calls[0].options.body).get('redirect_uri'),ORIGIN);
 f.advance(3700);const renewed=await (await f.post('/auth/token',{},result.session)).json();assert.equal(renewed.user.sub,result.user.sub);assert.equal(renewed.access_token,'google-access-2');
});
test('popup code login rejects requests missing its CSRF header before calling Google',async()=>{
 const f=fixture(),r=await f.handle(new Request(AUTH+'/auth/code',{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({code:'untrusted-code'})}),f.env);assert.equal(r.status,403);assert.equal(f.calls.length,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n,0);
});

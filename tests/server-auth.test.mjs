import test from 'node:test';
import assert from 'node:assert/strict';
import {ServerAuth,SERVER_SESSION_KEY} from '../server-auth.js';
const CLIENT='test.apps.googleusercontent.com',APP='https://raphlow23.github.io/academy-note/?workspace=existing_sheet_1234567890';
const token='s'.repeat(43),state='n'.repeat(43),code='c'.repeat(43);
function fixture(){
 const data=new Map(),store={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 const location={href:APP,hash:''},history={state:{},replaceState(s,t,url){location.href=url;location.hash=new URL(url).hash;}};
 let now=Date.now(),offline=false,sub='owner-one',requests=0;
 const reply=()=>({session:token,access_token:'google-access-private',expires_at:Math.floor(now/1000)+3500,session_expires:Math.floor(now/1000)+180*86400,user:{sub,email:'owner@example.test'}});
 const fetcher=async(url,options)=>{
  requests++;assert.equal(options.credentials,'omit');const body=JSON.parse(options.body);if(offline)throw Error('offline');
  if(url.endsWith('/auth/start')){assert.equal(body.returnTo,APP);assert.equal(body.challenge.length,43);const authorization=new URL('https://accounts.google.com/o/oauth2/v2/auth');authorization.search=new URLSearchParams({client_id:CLIENT,state}).toString();return Response.json({state,authorization_url:authorization.href});}
  if(url.endsWith('/auth/code')){assert.equal(options.headers['X-Requested-With'],'XmlHttpRequest');assert.equal(body.code,'popup-code');return Response.json(reply());}
  if(url.endsWith('/auth/exchange')){assert.equal(body.state,state);assert.equal(body.code,code);assert.equal(body.verifier.length,43);return Response.json(reply());}
  if(url.endsWith('/auth/token')){assert.equal(options.headers.Authorization,'Bearer '+token);return Response.json(reply());}
  if(url.endsWith('/auth/logout'))return Response.json({signed_out:true});
  throw Error('unexpected URL');
 };
 const client=new ServerAuth({baseUrl:'https://auth.example.test',clientId:CLIENT,fetcher,store,location,history,clock:()=>now});
 return {client,data,store,location,reply,requests:()=>requests,offline:()=>offline=true,changeUser:()=>sub='other-user',advance:ms=>now+=ms};
}
async function login(f){await f.client.prepareLogin();f.location.hash='#'+new URLSearchParams({subong_auth:code,state});f.location.href=APP+f.location.hash;return f.client.restore();}
test('same GitHub shortcut and workspace survive authorization with no cross-site cookies',async()=>{
 const f=fixture(),result=await login(f);assert.equal(result.user.sub,'owner-one');assert.equal(f.location.href,APP);assert(f.data.has(SERVER_SESSION_KEY));assert.equal(f.client.sessionToken,token);
 const saved=JSON.stringify([...f.data]);assert(!saved.includes('google-access-private'));assert(!saved.includes('refresh_token'));
});
test('next day reopen renews Google access without account chooser or consent',async()=>{
 const f=fixture();await login(f);f.advance(86400000);const result=await f.client.restore();assert.equal(result.user.sub,'owner-one');assert.equal(f.requests(),3);assert.equal(f.location.href,APP);
});
test('temporary network failure keeps the long-lived session for the next retry',async()=>{
 const f=fixture();await login(f);f.offline();await assert.rejects(f.client.restore(),e=>e.code==='AUTH_NETWORK');assert(f.data.has(SERVER_SESSION_KEY));
});
test('Google identity mismatch cannot overwrite the original saved account',async()=>{
 const f=fixture();await login(f);f.changeUser();await assert.rejects(f.client.token(),e=>e.code==='AUTH_PERMISSION');assert.equal(JSON.parse(f.data.get(SERVER_SESSION_KEY)).sub,'owner-one');
});
test('a stale response from an older tab cannot overwrite a newly switched session',async()=>{
 const f=fixture();await login(f);let release;f.client.fetcher=async()=>new Promise(resolve=>release=()=>resolve(Response.json(f.reply())));
 const pending=f.client.token();f.store.setItem(SERVER_SESSION_KEY,JSON.stringify({token:'x'.repeat(43),sub:'other-user'}));release();await assert.rejects(pending,e=>e.code==='ACCOUNT_CHANGED');assert.equal(JSON.parse(f.data.get(SERVER_SESSION_KEY)).sub,'other-user');
});
test('binding storage failure stops before navigating or starting Google authorization',async()=>{
 const f=fixture();f.client.store={getItem:()=>null,setItem:()=>{throw Error('quota');}};await assert.rejects(f.client.prepareLogin(),e=>e.code==='AUTH_STORAGE');assert.equal(f.requests(),0);
});
test('missing browser binding refuses an unexpected login handoff',async()=>{
 const f=fixture();f.location.href=APP+'#'+new URLSearchParams({subong_auth:code,state});await assert.rejects(f.client.restore(),e=>e.code==='AUTH_REQUIRED');assert.equal(f.requests(),0);
});
test('old device logout never deletes a different account now stored in the browser',async()=>{
 const f=fixture();await login(f);f.store.setItem(SERVER_SESSION_KEY,JSON.stringify({token:'x'.repeat(43),sub:'other-user'}));f.client.logout();assert.equal(JSON.parse(f.data.get(SERVER_SESSION_KEY)).sub,'other-user');
});


test('popup starts in the original button gesture and leaves the PWA URL unchanged',async()=>{
 const f=fixture();let started=false;
 const google={accounts:{oauth2:{initCodeClient:options=>{assert.equal(options.client_id,CLIENT);assert.equal(options.ux_mode,'popup');return {requestCode(){started=true;options.callback({code:'popup-code'});}};}}}};
 const pending=f.client.signIn({google});assert.equal(started,true);const result=await pending;assert.equal(result.user.sub,'owner-one');assert.equal(f.location.href,APP);assert.equal(f.requests(),1);
});
test('closing the Google popup leaves the old app session and data connection intact',async()=>{
 const f=fixture();await login(f);const before=f.data.get(SERVER_SESSION_KEY),requests=f.requests();const google={accounts:{oauth2:{initCodeClient:options=>({requestCode:()=>options.error_callback({type:'popup_closed'})})}}};
 await assert.rejects(f.client.signIn({google}),e=>e.code==='AUTH_CANCELLED');assert.equal(f.data.get(SERVER_SESSION_KEY),before);assert.equal(f.requests(),requests);
});

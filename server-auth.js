// Optional long-lived authentication. No sheet contents or Google refresh tokens
// are stored in the browser. Keeping this disabled preserves the legacy app.
export const SERVER_SESSION_KEY='subong-server-session-v1';
const FLOW_PREFIX='subong-auth-flow-v1:';
const storage=()=>{try{return globalThis.localStorage;}catch{return null;}};
const random=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const digest=async text=>btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const authError=(message,code='AUTH_REQUIRED')=>Object.assign(new Error(message),{code});
export class ServerAuth{
 constructor({baseUrl='',clientId='',fetcher=(...args)=>fetch(...args),store=storage(),location=globalThis.location,history=globalThis.history,clock=()=>Date.now()}={}){
  this.baseUrl=baseUrl.replace(/\/$/,'');this.clientId=clientId;this.fetcher=fetcher;this.store=store;this.location=location;this.history=history;this.clock=clock;this.sessionToken='';
  if(this.baseUrl){const url=new URL(this.baseUrl);if(url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw new Error('인증 서버 주소를 확인하세요.');}
 }
 get enabled(){return !!this.baseUrl;}
 read(key){try{return JSON.parse(this.store?.getItem(key)||'null');}catch{throw authError('저장된 연결 정보를 읽을 수 없습니다. 기기 저장소를 지우지 말고 다시 시도하세요.','AUTH_STORAGE');}}
 write(key,value){try{if(!this.store)throw Error();this.store.setItem(key,JSON.stringify(value));}catch{throw authError('로그인 유지에 필요한 기기 저장소를 사용할 수 없습니다.','AUTH_STORAGE');}}
 async api(path,data={},session){
  let r;try{r=await this.fetcher(this.baseUrl+path,{method:'POST',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(25000),headers:{'Content-Type':'application/json','X-Requested-With':'XmlHttpRequest',...(session?{Authorization:'Bearer '+session}:{})},body:JSON.stringify(data)});}catch{throw authError('로그인 유지 서버에 연결할 수 없습니다. 인터넷 연결 후 다시 시도하세요.','AUTH_NETWORK');}
  const value=await r.json().catch(()=>({}));
  if(!r.ok){if(r.status===401)throw authError('구글 연결을 다시 확인해야 합니다. 구글 로그인 버튼을 눌러주세요.');if(r.status===403)throw authError('구글 연결 권한을 확인하세요.','AUTH_PERMISSION');throw authError('로그인 유지 서버가 응답하지 않습니다. 잠시 후 다시 시도하세요.','AUTH_NETWORK');}
  return value;
 }
 async prepareLogin(){
  // Fail before leaving the current app if durable binding storage is unavailable.
  const verifier=random(),probe=FLOW_PREFIX+'probe';this.write(probe,{at:this.clock()});this.store.removeItem(probe);
  const result=await this.api('/auth/start',{challenge:await digest(verifier),returnTo:this.location.href});
  const url=new URL(result.authorization_url);
  if(url.origin!=='https://accounts.google.com'||url.pathname!=='/o/oauth2/v2/auth'||url.searchParams.get('client_id')!==this.clientId||url.searchParams.get('state')!==result.state||!/^[\w-]{43}$/.test(result.state))throw authError('구글 인증 요청을 확인할 수 없습니다.','AUTH_PERMISSION');
  this.write(FLOW_PREFIX+result.state,{verifier,expires:this.clock()+600000,previousHash:this.location.hash});
  return url.href;
 }
 async signIn({google=globalThis.google}={}){
  if(!google?.accounts?.oauth2?.initCodeClient)throw authError('구글 로그인 화면을 준비 중입니다. 잠시 후 다시 눌러주세요.','AUTH_LOADING');
  // requestCode runs directly in the original button gesture: no redirect away
  // from the home-screen app and no third-party-cookie session dependency.
  const code=await new Promise((resolve,reject)=>{
   const client=google.accounts.oauth2.initCodeClient({client_id:this.clientId,scope:'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive.file',include_granted_scopes:true,ux_mode:'popup',select_account:true,
    callback:r=>r.error?reject(authError('구글 로그인이 취소되었거나 승인되지 않았습니다.','AUTH_CANCELLED')):resolve(r.code),
    error_callback:e=>reject(authError(e.type==='popup_closed'?'로그인 창이 닫혔습니다.':'구글 로그인 창을 열 수 없습니다. 팝업 차단을 확인하세요.','AUTH_CANCELLED'))});
   client.requestCode();
  });
  const old=this.read(SERVER_SESSION_KEY),result=await this.api('/auth/code',{code});this.save(result,result.session);
  if(old?.token&&old.token!==result.session)this.api('/auth/logout',{},old.token).catch(()=>{});
  return result;
 }
 save(result,token){
  if(!/^[\w-]{43}$/.test(token||'')||!result.user?.sub||!result.user?.email||typeof result.access_token!=='string'||result.expires_at*1000<=this.clock()||result.session_expires*1000<=this.clock())throw authError('로그인 유지 응답을 확인할 수 없습니다.','AUTH_PERMISSION');
  this.write(SERVER_SESSION_KEY,{token,sub:result.user.sub,email:result.user.email,expires:result.session_expires*1000});this.sessionToken=token;return result;
 }
 async restore(){
  const url=new URL(this.location.href),fragment=new URLSearchParams(url.hash.slice(1)),code=fragment.get('subong_auth'),state=fragment.get('state');
  if(code||fragment.has('subong_auth_error')){
   const pending=state&&this.read(FLOW_PREFIX+state);
   if(!pending||pending.expires<=this.clock())throw authError('로그인 확인 시간이 지났습니다. 구글 로그인을 다시 눌러주세요.');
   if(fragment.has('subong_auth_error')){this.store.removeItem(FLOW_PREFIX+state);url.hash=pending.previousHash||'';this.history.replaceState(this.history.state,'',url.href);throw authError('로그인이 취소되었습니다.','AUTH_CANCELLED');}
   const result=await this.api('/auth/exchange',{code,state,verifier:pending.verifier});
   const old=this.read(SERVER_SESSION_KEY);this.save(result,result.session);
   this.store.removeItem(FLOW_PREFIX+state);url.hash=pending.previousHash||'';this.history.replaceState(this.history.state,'',url.href);
   if(old?.token&&old.token!==result.session)this.api('/auth/logout',{},old.token).catch(()=>{});
   return result;
  }
  const saved=this.read(SERVER_SESSION_KEY);if(!saved)return null;
  if(saved.expires<=this.clock()){this.clear();return null;}
  this.sessionToken=saved.token;
  try{return await this.token();}catch(e){if(e.code==='AUTH_REQUIRED'){this.clear();return null;}throw e;}
 }
 async token({force=false}={}){
  const saved=this.read(SERVER_SESSION_KEY);if(!saved?.token)throw authError('구글 계정으로 로그인하세요.');
  const result=await this.api('/auth/token',{force},saved.token);
  // A response arriving after another tab switched accounts cannot restore the old one.
  if(this.read(SERVER_SESSION_KEY)?.token!==saved.token)throw authError('계정이 변경되었습니다. 다시 불러오세요.','ACCOUNT_CHANGED');
  if(result.user?.sub!==saved.sub)throw authError('구글 계정이 일치하지 않습니다.','AUTH_PERMISSION');
  return this.save(result,saved.token);
 }
 clear(){this.store?.removeItem(SERVER_SESSION_KEY);this.sessionToken='';}
 logout(){const token=this.sessionToken;const current=this.read(SERVER_SESSION_KEY);if(!token||current?.token===token)this.clear();if(token)this.api('/auth/logout',{},token).catch(()=>{});this.sessionToken='';}
}

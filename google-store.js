import {changedViews,viewWriteRequest,viewTables} from './sheet-views.js?v=20261106-exportfix1';
import {ServerAuth,SERVER_SESSION_KEY} from './server-auth.js?v=20261106-auth1';
import {SaveOutbox} from './save-outbox.js?v=20261104-durable1';
import {CONFIG} from './config.js?v=20261106-exportfix1';
import {TABLES, emptyTables, replay, tablesToData} from './domain.js?v=20261104-closure1';
import {needsCompletion} from './booking-completion.js?v=20261104-start1';
import {LOG, LOG_HEADERS, BASE, range, workbookResource, parseBase,initialSettingsRows} from './workbook.js?v=20261106-exportfix1';

const SCOPES='openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive.file';
const DRIVE='https://www.googleapis.com/drive/v3', SHEETS='https://sheets.googleapis.com/v4/spreadsheets';
const mutations=new Set(['saveStudent','addTransaction','book','changeBooking','saveClosures','saveSchedule']);
const clone=x=>structuredClone(x);
const stamp=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date());
const validId=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{20,200}$/.test(id);
const SESSION_KEY='subong-google-session-v1';

export class GoogleStore{
 constructor({fetcher=(...args)=>globalThis.fetch(...args),config=CONFIG,outboxStorage}={}){if(outboxStorage===undefined)try{outboxStorage=globalThis.localStorage;}catch{}this.authPreview=false;try{this.authPreview=!!config.authServer&&new URL(globalThis.location?.href).searchParams.get('auth_preview')==='1';}catch{}this.serverAuth=new ServerAuth({baseUrl:config.authEnabled!==false||this.authPreview?config.authServer||'':'',clientId:config.clientId,fetcher:(...args)=>this.fetcher(...args)});this.refreshing=null;this.outbox=new SaveOutbox(outboxStorage);this.flushing=null;this.fetcher=fetcher;this.config=config;this.token='';this.expires=0;this.epoch=0;this.user=null;this.files=[];this.selected='';this.pending=new Map();this.gridMeta=new Map();this.onSignOut=()=>{};if(this.serverAuth.enabled)globalThis.addEventListener?.('storage',e=>{if(!this.serverAuth.enabled||e.key!==SERVER_SESSION_KEY||!this.user)return;let saved;try{saved=JSON.parse(e.newValue);}catch{}if(saved?.token===this.serverAuth.sessionToken)return;this.disconnect({forget:false});});globalThis.addEventListener?.('storage',e=>{if(this.serverAuth.enabled||e.key!==SESSION_KEY||!this.token)return;let saved;try{saved=JSON.parse(e.newValue);}catch{}if(saved?.token===this.token)return;try{sessionStorage.removeItem(SESSION_KEY);}catch{}this.disconnect({forget:false});});}
 async ensureSession({force=false}={}){
  if(!this.serverAuth.enabled||!force&&this.token&&this.expires>Date.now()+30000)return;
  if(this.refreshing){await this.refreshing;if(!force)return;}
  const epoch=this.epoch,expected=this.user?.sub;
  const refresh=(async()=>{const grant=await this.serverAuth.token({force});if(this.epoch!==epoch)throw new Error('계정이 변경되었습니다.');if(expected&&grant.user.sub!==expected)throw new Error('구글 계정이 일치하지 않습니다.');this.token=grant.access_token;this.expires=grant.expires_at*1000;})();
  this.refreshing=refresh;try{await refresh;}finally{if(this.refreshing===refresh)this.refreshing=null;}
 }
 get configured(){return /^[\w.-]+\.apps\.googleusercontent\.com$/.test(this.config.clientId);}
 async signIn(){
  if(this.serverAuth.enabled){const epoch=this.epoch,grant=await this.serverAuth.signIn();if(this.epoch!==epoch)throw new Error('계정이 변경되었습니다.');this.disconnect({forget:false});this.token=grant.access_token;this.expires=grant.expires_at*1000;await this.connectAccount(grant.user.sub,grant.user);return this.user;}
  if(!this.configured)throw new Error('구글 로그인 연결 설정이 아직 준비되지 않았습니다.');
  if(!globalThis.google?.accounts?.oauth2)throw new Error('구글 로그인 화면을 준비 중입니다. 잠시 후 다시 눌러주세요.');
  this.disconnect();const epoch=this.epoch;
  const response=await new Promise((resolve,reject)=>{
   const client=google.accounts.oauth2.initTokenClient({client_id:this.config.clientId,scope:SCOPES,include_granted_scopes:true,callback:r=>r.error?reject(new Error(r.error_description||r.error)):resolve(r),error_callback:e=>reject(new Error(e.type==='popup_closed'?'로그인 창이 닫혔습니다.':'로그인 창을 열 수 없습니다. 브라우저 팝업 설정을 확인하세요.'))});
   client.requestAccessToken({prompt:'select_account'});
  });
  if(this.epoch!==epoch)throw new Error('계정이 전환되었습니다. 다시 연결하세요.');
  if(!google.accounts.oauth2.hasGrantedAllScopes(response,'https://www.googleapis.com/auth/drive.file','https://www.googleapis.com/auth/userinfo.email'))throw new Error('이 앱에서 사용하는 파일 접근과 이메일 확인 권한을 승인해 주세요.');
  this.token=response.access_token;this.expires=Date.now()+Number(response.expires_in||3500)*1000-30000;
  await this.connectAccount();this.persistSession();return this.user;
 }
 async connectAccount(expectedSub,verifiedIdentity){
  // The same-origin-configured auth server already verified Google identity when
  // creating this grant. Avoid repeating Google's userinfo request on every open.
  const identity=this.serverAuth.enabled&&verifiedIdentity?verifiedIdentity:await this.http('https://openidconnect.googleapis.com/v1/userinfo');
  if(expectedSub&&identity.sub!==expectedSub)throw new Error('구글 계정이 일치하지 않아 자료 연결을 중단했습니다.');
  if(!identity.email||!identity.sub)throw new Error('로그인한 구글 계정을 확인할 수 없습니다.');
  this.user={email:identity.email.toLowerCase(),sub:identity.sub,name:identity.email.split('@')[0],role:'admin'};
  await this.ensureOwnWorkspace();
  let saved=null;try{saved=localStorage.getItem('academy-selected:'+this.user.sub);}catch{}
  this.selected=this.files.some(f=>f.id===saved)?saved:this.files.find(f=>f.ownedByMe)?.id||this.files[0]?.id||'';
  const invited=new URL(location.href).searchParams.get('workspace');
  if(invited&&validId(invited)){try{const meta=await this.meta(invited);if(meta.ownedByMe||meta.capabilities?.canEdit){this.remember(meta);this.selected=invited;}}catch{}}
  return this.user;
 }
 persistSession(){if(this.serverAuth.enabled)return;const saved=JSON.stringify({token:this.token,expires:this.expires,savedAt:Date.now()});try{localStorage.setItem(SESSION_KEY,saved);}catch{}try{sessionStorage.setItem(SESSION_KEY,saved);}catch{}}
 forgetSession(){if(this.serverAuth.enabled)this.serverAuth.logout();try{localStorage.setItem(SESSION_KEY,'null');}catch{}try{sessionStorage.removeItem(SESSION_KEY);}catch{}}
 async restoreSession(){
  if(this.serverAuth.enabled){this.disconnect({forget:false});const grant=await this.serverAuth.restore();if(!grant)return false;this.token=grant.access_token;this.expires=grant.expires_at*1000;await this.connectAccount(grant.user.sub,grant.user);return true;}
  let saved,persistent=false;try{const raw=localStorage.getItem(SESSION_KEY);if(raw!==null){persistent=true;saved=JSON.parse(raw);}}catch{}
  if(!persistent)try{saved=JSON.parse(sessionStorage.getItem(SESSION_KEY));}catch{return false;}
  if(!saved){if(persistent)try{sessionStorage.removeItem(SESSION_KEY);}catch{}return false;}
  if(typeof saved.token!=='string'||!saved.token||!Number.isFinite(saved.expires)||!Number.isFinite(saved.savedAt)||saved.expires<=Date.now()||saved.savedAt>Date.now()+60000){this.forgetSession();return false;}
  this.disconnect({forget:false});this.token=saved.token;this.expires=Math.min(saved.expires,saved.savedAt+3600000);
  try{await this.connectAccount();this.persistSession();return true;}catch(e){if(e.code==='AUTH_REQUIRED'){this.disconnect();return false;}throw e;}
 }
 disconnect({forget=true}={}){if(forget)this.forgetSession();this.epoch++;this.token='';this.expires=0;this.user=null;this.selected='';this.files=[];this.latestTables=null;this.latestWorkspace='';this.pending.clear();this.gridMeta.clear();this.knownTables?.clear();this.ownSetup=null;this.onSignOut();}
 assertSession(){if(!this.token||Date.now()>=this.expires){this.token='';this.forgetSession();const e=new Error('구글 연결이 만료됐습니다. 계정 버튼에서 다시 연결하세요.');e.code='AUTH_REQUIRED';throw e;}}
 unsent(id){return this.outbox.read(this.user?.sub).filter(r=>!id||r.workspace===id);}
 async flushUnsent(id,locked=false){
  if(this.flushing)return this.flushing;
  const sub=this.user?.sub,epoch=this.epoch;
  const run=async()=>{
   const results=new Map();
   for(const row of this.outbox.read(sub).filter(r=>r.workspace===id)){
    if(this.serverAuth.enabled)await this.ensureSession();this.assertSession();if(this.epoch!==epoch||this.user?.sub!==sub)throw new Error('원래 계정으로 다시 연결하여 저장을 마치세요.');
    if(!this.files.some(f=>f.id===id))throw new Error('미전송 자료의 파일 접근 권한을 확인하세요.');
    this.pending.set(JSON.stringify([id,row.action,row.data]),{id:row.id,action:row.action,data:clone(row.data),actor:row.actor,at:row.at});
    try{const result=row.action==='registerAndBook'?await this.registerAndBook(row.data,id):await this.mutate(row.action,row.data,id);this.outbox.remove(sub,row.id);results.set(row.id,result);}
    catch(e){if(e.permanent||[400,403,404].includes(e.status)){this.outbox.remove(sub,row.id);this.pending.delete(JSON.stringify([id,row.action,row.data]));}throw e;}
   }return results;
  };
  const execute=()=>!locked&&globalThis.navigator?.locks?.request?navigator.locks.request('subong-save:'+sub,run):run();
  const promise=execute();this.flushing=promise;try{return await promise;}finally{if(this.flushing===promise)this.flushing=null;}
 }
 async durableSave(action,data,id){
  const sub=this.user.sub,epoch=this.epoch;
  const fingerprint=JSON.stringify([id,action,data]);
  if(this.unsent().some(row=>row.fingerprint!==fingerprint))throw new Error('구글 저장 대기 중인 내용을 먼저 다시 저장하세요.');
  // Persist before token renewal, navigator.locks, or the first network await.
  // visibilitychange can freeze this page at any of those await boundaries.
  const row=this.outbox.add(sub,id,action,data,this.user.email,stamp());
  const run=async()=>{
   if(this.serverAuth.enabled)await this.ensureSession();this.assertSession();if(epoch!==this.epoch||this.user?.sub!==sub)throw new Error('계정이 변경되었습니다.');
   const results=await this.flushUnsent(id,true);
   if(results.has(row.id))return results.get(row.id);
   throw new Error('구글 저장 결과를 확인할 수 없습니다. 다시 불러와 확인하세요.');
  };
  return globalThis.navigator?.locks?.request?navigator.locks.request('subong-save:'+sub,run):run();
 }
 backgroundFlush(){
  if(this.authPreview||!this.user||!this.token||this.expires<=Date.now())return false;
  const rows=this.unsent(),groups=new Map();
  for(const row of rows){if(!this.files.some(f=>f.id===row.workspace))continue;const commands=row.action==='registerAndBook'?[['saveStudent',row.data.student],['addTransaction',row.data.transaction],['book',row.data.booking]].filter(([,d])=>d).map(([action,data])=>({id:'registration:'+action+':'+data.id,action,data})): [{id:row.id,action:row.action,data:row.data}];
   const known=this.knownTables?.get(row.workspace);if(!known||known.sub!==this.user.sub)continue;
   const checked=replay(known.tables,commands.map(c=>({...c,actor:row.actor,at:row.at})));if(checked.outcomes.some(o=>o.status==='거절'))continue;
   const values=commands.map(c=>[c.id,c.action,row.actor,row.at,JSON.stringify(c.data),'처리 대기','','','',...Array(13).fill('')]);groups.set(row.workspace,[...(groups.get(row.workspace)||[]),...values]);
  }
  let sent=false;for(const [id,values] of groups){const body=JSON.stringify({values});if(new TextEncoder().encode(body).length>48000)continue;
   try{Promise.resolve(this.fetcher(SHEETS+'/'+id+'/values/'+encodeURIComponent(range(LOG,'A:V'))+':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',{method:'POST',keepalive:true,credentials:'omit',headers:{Authorization:'Bearer '+this.token,'Content-Type':'application/json'},body})).catch(()=>{});sent=true;}catch{}
  }return sent;
 }
 async http(url,{method='GET',body,readRetry=method==='GET',authRetried=false}={}){
  const initialEpoch=this.epoch;if(this.serverAuth.enabled)await this.ensureSession();if(this.epoch!==initialEpoch)throw new Error('계정이 바뀌어 요청을 중단했습니다.');this.assertSession();const epoch=this.epoch,token=this.token;
  for(let attempt=0;;attempt++){
   let response;
   try{response=await this.fetcher(url,{method,...(body!==undefined&&new TextEncoder().encode(JSON.stringify(body)).length<48000?{keepalive:true}:{}),signal:AbortSignal.timeout(25000),headers:{Authorization:'Bearer '+token,...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});}
   catch{const stage=url.includes('/userinfo')?'구글 계정 확인':url.startsWith(SHEETS)?'구글 시트 연결':'구글 드라이브 연결';throw new Error(method==='GET'?stage+' 응답을 받지 못했습니다. 인터넷 연결을 확인하고 다시 눌러주세요.':stage+' 저장 응답을 받지 못했습니다. 새로고침으로 저장 여부를 먼저 확인하세요.');}
   if(this.epoch!==epoch)throw new Error('계정이 바뀌어 이전 계정의 요청을 중단했습니다.');
   if(response.status===401&&this.serverAuth.enabled&&!authRetried&&attempt===0){await this.ensureSession({force:true});return this.http(url,{method,body,readRetry,authRetried:true});}
   if(response.status===401){this.disconnect();const e=new Error('구글 연결이 만료됐습니다. 다시 로그인해 주세요.');e.code='AUTH_REQUIRED';throw e;}
   if(readRetry&&[429,500,502,503].includes(response.status)&&attempt<3){await new Promise(r=>setTimeout(r,500*2**attempt));continue;}
   const data=response.status===204?{}:await response.json().catch(()=>({}));
   if(!response.ok){const error=new Error(response.status===403?'이 파일 접근이 허용되지 않았습니다. 파일 선택에서 직접 연결하거나 소유자의 공유 권한을 확인하세요.':data.error?.message||'구글 요청을 처리하지 못했습니다. ('+response.status+')');error.status=response.status;throw error;}
   return data;
  }
 }
 async meta(id){if(!validId(id))throw new Error('자료 주소를 확인하세요.');return this.http(DRIVE+'/files/'+id+'?fields=id,name,mimeType,ownedByMe,capabilities(canEdit),owners(emailAddress),appProperties,properties,trashed');}
 eligible(m){return !m.trashed&&m.mimeType==='application/vnd.google-apps.spreadsheet'&&m.capabilities?.canEdit&&(m.appProperties?.academySchema==='3'||m.properties?.academySchema==='3');}
 async listFiles(){
  const q="trashed=false and mimeType='application/vnd.google-apps.spreadsheet' and (appProperties has { key='academySchema' and value='3' } or properties has { key='academySchema' and value='3' })";
  const files=[];let pageToken='';
  do{const data=await this.http(DRIVE+'/files?'+new URLSearchParams({q,spaces:'drive',fields:'nextPageToken,files(id,name,ownedByMe,capabilities(canEdit),owners(emailAddress),appProperties,properties,mimeType)',pageSize:'100',...(pageToken?{pageToken}:{})}));files.push(...(data.files||[]));pageToken=data.nextPageToken||'';}while(pageToken);
  this.files=files.filter(m=>this.eligible(m));this.listedAt=Date.now();return this.files;
 }
 remember(meta){if(!this.eligible(meta))throw new Error('새 수봉화실 자료가 아닙니다. 기존 자료는 이관 기능으로 연결하세요.');this.files=this.files.filter(f=>f.id!==meta.id).concat(meta);}
 workspaces(){return this.files.map(f=>({id:f.id,name:f.name,own:!!f.ownedByMe}));}
 async ensureOwnWorkspace(){
  if(!this.user)throw new Error('로그인하세요.');
  if(this.ownSetup)return this.ownSetup;
  const epoch=this.epoch,sub=this.user.sub;
  const setup=async()=>{
   if(epoch!==this.epoch)throw new Error('계정이 전환되었습니다. 다시 연결하세요.');
   await this.listFiles();
   let own=this.files.find(f=>f.ownedByMe);
   if(!own){
    let saved;try{saved=localStorage.getItem('academy-own:'+sub)||localStorage.getItem('academy-selected:'+sub);}catch{}
    if(saved&&validId(saved)){try{const m=await this.meta(saved);if(m.ownedByMe&&this.eligible(m)){this.remember(m);own=m;}}catch(e){if(this.serverAuth.enabled||![403,404].includes(e.status))throw e;}}
   }
   if(epoch!==this.epoch)throw new Error('계정이 전환되었습니다. 다시 연결하세요.');
   const id=own?.id||(await this.initialize()).id;
   try{localStorage.setItem('academy-own:'+sub,id);}catch{}
   return id;
  };
  const run=globalThis.navigator?.locks?.request?()=>navigator.locks.request('academy-own:'+sub,setup):setup;
  const promise=run();this.ownSetup=promise;
  try{return await promise;}finally{if(this.ownSetup===promise)this.ownSetup=null;}
 }
 select(id){if(!this.files.some(f=>f.id===id))throw new Error('이 계정에 연결되지 않은 자료입니다.');this.selected=id;try{localStorage.setItem('academy-selected:'+this.user.sub,id);}catch{}return {id};}
 async snapshot(id,knownMeta){
  const meta=knownMeta||(Date.now()-this.listedAt<30000?this.files.find(f=>f.id===id):null)||await this.meta(id);if(meta.id!==id||!this.eligible(meta))throw new Error('접근할 수 있는 학원 자료가 아닙니다.');
  const names=Object.keys(TABLES),params=new URLSearchParams();names.forEach(n=>params.append('ranges',range(BASE(n))));params.append('ranges',range(LOG));params.set('valueRenderOption','UNFORMATTED_VALUE');
  if(this.config.viewValues)for(const name of [...names,'수강현황'])params.append('ranges',range(name));
  const data=await this.http(SHEETS+'/'+id+'/values:batchGet?'+params);
  const base=parseBase(data.valueRanges),rows=data.valueRanges?.[names.length]?.values||[];
  if(JSON.stringify(rows[0])!==JSON.stringify(LOG_HEADERS))throw new Error('작업기록 머리글이 바뀌었습니다. 원본을 확인하세요.');
  const events=rows.slice(1).map((r,i)=>{
   if(!r[0])throw new Error('작업기록 중간에 빈 행이 있습니다. 행을 정렬하거나 삭제하지 마세요.');
   try{const payload=JSON.parse(r[4]);if(!payload||typeof payload!=='object')throw 0;return {id:r[0],action:r[1],actor:r[2],at:r[3],data:payload,row:i+2,stored:r};}
   catch{throw new Error('작업기록 '+(i+2)+'행의 데이터를 확인할 수 없습니다. 원본을 보존하고 복사본에서 확인하세요.');}
  });
  const folded=replay(base,events);this.knownTables??=new Map();this.knownTables.set(id,{sub:this.user?.sub,tables:folded.tables});return {meta,base,events,...folded,views:this.config.viewValues?Object.fromEntries([...names,'수강현황'].map((name,i)=>[name,data.valueRanges?.[names.length+1+i]?.values||[]])):undefined};
 }
 async settle(id,snapshot){
  await this.ensureViewCapacity(id,snapshot.tables);
  const data=[];
  snapshot.outcomes.forEach((o,i)=>{
   const e=snapshot.events[i],record=(o.record||[]).slice(0,13),values=[o.status,o.error||'',o.target||'',record[0]||'',...Array.from({length:13},(_,j)=>record[j]??'')];
   if(JSON.stringify(Array.from({length:17},(_,j)=>e.stored[j+5]??''))!==JSON.stringify(values))data.push({range:range(LOG,'F'+e.row+':V'+e.row),values:[values]});
  });
  if(data.length)await this.http(SHEETS+'/'+id+'/values:batchUpdate',{method:'POST',body:{valueInputOption:'RAW',data}});
  if(this.config.viewValues)await this.syncViews(id,snapshot);
 }
 async syncViews(id,snapshot){
  if(this.authPreview)throw new Error('읽기 전용 화면에서는 원본 표를 갱신하지 않습니다.');
  const changed=changedViews(snapshot.tables,snapshot.views,stamp().slice(0,10));if(!changed.length)return;
  let meta=this.gridMeta.get(id);if(!meta){const r=await this.http(SHEETS+'/'+id+'?fields=sheets(properties(sheetId,title,gridProperties(rowCount)))');meta=new Map(r.sheets.map(s=>[s.properties.title,s.properties]));this.gridMeta.set(id,meta);}
  const requests=changed.map(([name,rows])=>{const properties=meta.get(name);if(!properties)throw new Error('조회용 '+name+' 탭이 없습니다. 원본을 확인하세요.');return viewWriteRequest(properties,rows);});
  await this.http(SHEETS+'/'+id+':batchUpdate',{method:'POST',body:{requests}});
 }
 async ensureViewCapacity(id,tables){
  if(Math.max(...Object.values(tables).map(rows=>rows.length))<900)return;
  let meta=this.gridMeta.get(id);if(!meta){const r=await this.http(SHEETS+'/'+id+'?fields=sheets(properties(sheetId,title,gridProperties(rowCount)))');meta=new Map(r.sheets.map(s=>[s.properties.title,s.properties]));this.gridMeta.set(id,meta);}
  const sizes=Object.fromEntries(Object.entries(tables).map(([name,rows])=>[name,rows.length+20]));sizes['수강현황']=tables['수강생'].length+20;const requests=[];
  for(const [name,count] of Object.entries(sizes)){const sh=meta.get(name);if(!sh)throw new Error('조회용 '+name+' 탭이 없습니다. 원본을 확인하세요.');if(count>sh.gridProperties.rowCount)requests.push({appendDimension:{sheetId:sh.sheetId,dimension:'ROWS',length:Math.max(500,count-sh.gridProperties.rowCount)}});}
  if(requests.length){await this.http(SHEETS+'/'+id+':batchUpdate',{method:'POST',body:{requests}});for(const r of requests){const sh=[...meta.values()].find(s=>s.sheetId===r.appendDimension.sheetId);sh.gridProperties.rowCount+=r.appendDimension.length;}}
 }
 async load(id=this.selected,{readOnly=false}={}){
  if(!this.user)throw new Error('구글 계정으로 로그인하세요.');
  const base={user:clone(this.user),workspaces:this.workspaces(),hasOwnWorkspace:this.files.some(f=>f.ownedByMe),appUrl:this.appUrl(),savedAt:stamp(),users:[]};
  if(!id)return {...base,needsSetup:true,...tablesToData(emptyTables()),databaseUrl:'',workspace:null};
  if(!this.files.some(f=>f.id===id))throw new Error('현재 계정에 연결되지 않은 자료입니다.');
  const snapshot=readOnly?await this.snapshot(id):await this.completeElapsed(id);const m=snapshot.meta;
  return {...base,needsSetup:false,...tablesToData(snapshot.tables),databaseUrl:'https://docs.google.com/spreadsheets/d/'+id+'/edit',workspace:{id,name:m.name,ownedByMe:!!m.ownedByMe,ownerEmail:m.owners?.[0]?.emailAddress||'',shareUrl:this.appUrl()+'?workspace='+id,permissions:[]}};
 }
 appUrl(){return location.origin+location.pathname;}
 async completeElapsed(id){
  let snapshot=await this.snapshot(id);const at=stamp();
  const due=tablesToData(snapshot.tables).bookings.filter(b=>needsCompletion(b,Date.parse(at.replace(' ','T')+'+09:00')));
  if(due.length){
   const events=due.map(b=>({id:'auto-complete:'+b.id+':'+b.version,action:'changeBooking',actor:this.user.email,at,data:{id:b.id,version:b.version,status:'수강완료',automatic:true}}));
   await this.http(SHEETS+'/'+id+'/values/'+encodeURIComponent(range(LOG,'A:V'))+':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',{method:'POST',body:{values:events.map(e=>[e.id,e.action,e.actor,e.at,JSON.stringify(e.data),'처리 대기','','','',...Array(13).fill('')])}});
   snapshot=await this.snapshot(id,snapshot.meta);
  }
  await this.settle(id,snapshot);return snapshot;
 }
 async initialize(base=emptyTables()){
  if(!this.user)throw new Error('로그인하세요.');
  if(arguments.length===0){const own=this.files.find(f=>f.ownedByMe);if(own)return this.select(own.id);}
  // Create empty first: no imported personal records until Google ownership and privacy are checked.
  const resource=workbookResource(),created=await this.http(SHEETS,{method:'POST',body:resource});
  const id=created.spreadsheetId;
  await this.http(DRIVE+'/files/'+id+'?fields=id',{method:'PATCH',body:{appProperties:{academySchema:'3'},properties:{academySchema:'3'},writersCanShare:false}});
  const meta=await this.meta(id);if(!meta.ownedByMe)throw new Error('생성된 자료의 소유자를 확인할 수 없습니다.');
  const permissions=await this.permissions(id);if(permissions.length)throw new Error('조직의 자동 공유 정책이 적용된 파일입니다. 비공개 여부를 확인하세요.');
  const requests=[];for(const [name,rows] of Object.entries(viewTables(base,stamp().slice(0,10)))){const properties=created.sheets.find(s=>s.properties.title===name).properties;if(rows.length>properties.gridProperties.rowCount){const length=rows.length-properties.gridProperties.rowCount+20;requests.push({appendDimension:{sheetId:properties.sheetId,dimension:'ROWS',length}});properties.gridProperties.rowCount+=length;}requests.push(viewWriteRequest(properties,rows));}
  const imports=Object.keys(TABLES).map(name=>({name:BASE(name),rows:base[name]})).concat({name:'초기설정요약',rows:initialSettingsRows(base)});
  for(const item of imports){const sh=created.sheets.find(s=>s.properties.title===item.name),count=sh.properties.gridProperties?.rowCount||1000;if(item.rows.length>count)requests.push({appendDimension:{sheetId:sh.properties.sheetId,dimension:'ROWS',length:item.rows.length-count+20}});requests.push({updateCells:{start:{sheetId:sh.properties.sheetId,rowIndex:0,columnIndex:0},rows:item.rows.map(row=>({values:row.map(v=>({userEnteredValue:typeof v==='number'?{numberValue:v}:{stringValue:String(v??'')}}))})),fields:'userEnteredValue'}});}
  await this.http(SHEETS+'/'+id+':batchUpdate',{method:'POST',body:{requests}});
  this.remember(meta);return this.select(id);
 }
 async mutate(action,data,id){
  if(['saveSchedule','saveClosures'].includes(action)&&!data.effectiveFrom)throw Object.assign(new Error('적용 시작일을 선택하세요. 이전 화면을 사용 중이면 페이지를 새로고침해 주세요.'),{permanent:true});
  this.latestTables=null;this.latestWorkspace='';
  const fingerprint=JSON.stringify([id,action,data]),pending=this.pending.get(fingerprint)||{id:crypto.randomUUID(),actor:this.user.email,at:stamp(),action,data:clone(data)};
  this.pending.set(fingerprint,pending);
  let snapshot=await this.snapshot(id),index=snapshot.events.findIndex(e=>e.id===pending.id);
  if(index<0){
   replay(snapshot.tables,[pending]).outcomes.forEach(o=>{if(o.status==='거절')throw Object.assign(new Error(o.error),{permanent:true});});
   await this.http(SHEETS+'/'+id+'/values/'+encodeURIComponent(range(LOG,'A:V'))+':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',{method:'POST',body:{values:[[pending.id,action,pending.actor,pending.at,JSON.stringify(pending.data),'처리 대기','','','',...Array(13).fill('')]]}});
   snapshot=await this.snapshot(id,snapshot.meta);index=snapshot.events.findIndex(e=>e.id===pending.id);
  }
  if(index<0)throw new Error('저장 결과를 확인할 수 없습니다. 새로고침하세요.');
  await this.settle(id,snapshot);this.latestTables=snapshot.tables;this.latestWorkspace=id;const outcome=snapshot.outcomes[index];this.pending.delete(fingerprint);
  if(outcome.status==='거절')throw Object.assign(new Error(outcome.error),{permanent:true});
  if(!outcome.result)throw new Error('기록을 다시 불러와 저장 결과를 확인하세요.');
  return outcome.result;
 }
 async registerAndBook(d,id){
  d=clone(d);
  for(const [obj,keys] of [[d.student,['name','phone','note']],[d.transaction,['note']],[d.booking,['note']]])if(obj)for(const k of keys)if(typeof obj[k]==='string')obj[k]=obj[k].trim();
  const studentId=d.student?.id||d.transaction?.studentId;
  if(d.transaction&&d.transaction.studentId!==studentId||d.booking&&(d.booking.studentId!==studentId||d.booking.passId!==d.transaction?.id))throw Object.assign(new Error('같은 수강생의 수강권과 예약을 선택하세요.'),{permanent:true});
  this.latestTables=null;this.latestWorkspace='';
  let snapshot=await this.snapshot(id);const current=tablesToData(snapshot.tables),commands=[];
  const add=(action,data,existing,fields)=>{
   if(!data)return;
   if(existing){
    if(fields.some(k=>existing[k]!==data[k]))throw Object.assign(new Error('이미 저장된 등록·납부 내용과 다릅니다. 저장된 내역을 확인하고 예약만 다시 진행하세요.'),{permanent:true});
    if(action==='book'&&existing.status==='취소')throw Object.assign(new Error('이미 취소된 예약입니다. 새 예약으로 등록하세요.'),{permanent:true});
   }else commands.push({action,data});
  };
  add('saveStudent',d.student,current.students.find(x=>x.id===d.student?.id),['name','phone','since','active','note','priorCount','priorPaid']);
  add('addTransaction',d.transaction,current.transactions.find(x=>x.id===d.transaction?.id),['studentId','date','kind','credits','amount','note']);
  add('book',d.booking,current.bookings.find(x=>x.id===d.booking?.id),['studentId','passId','date','time','endTime','note']);
  if(!d.student&&!d.transaction)throw Object.assign(new Error('등록할 수강생 또는 수강권을 확인하세요.'),{permanent:true});
  const at=stamp(),events=commands.map(c=>({id:'registration:'+c.action+':'+c.data.id,...c,actor:this.user.email,at}));
  const checked=replay(snapshot.tables,events);const invalid=checked.outcomes.find(o=>o.status==='거절');
  if(invalid)throw Object.assign(new Error(invalid.error),{permanent:true});
  if(events.length){
   await this.http(SHEETS+'/'+id+'/values/'+encodeURIComponent(range(LOG,'A:V'))+':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',{method:'POST',body:{values:events.map(e=>[e.id,e.action,e.actor,e.at,JSON.stringify(e.data),'처리 대기','','','',...Array(13).fill('')])}});
   snapshot=await this.snapshot(id,snapshot.meta);
  }
  await this.settle(id,snapshot);this.latestTables=snapshot.tables;this.latestWorkspace=id;
  const rejected=snapshot.outcomes.find((o,i)=>events.some(e=>e.id===snapshot.events[i].id)&&o.status==='거절');
  if(rejected)throw Object.assign(new Error('일부 내용은 저장됐습니다. 목록·납부 내역을 확인하세요. '+rejected.error),{permanent:true});
  return {studentId:d.student?.id||d.transaction.studentId,bookingId:d.booking?.id||''};
 }
 async permissions(id){const r=await this.http(DRIVE+'/files/'+id+'/permissions?fields=permissions(id,type,role,emailAddress,displayName)');return (r.permissions||[]).filter(p=>p.role!=='owner').map(p=>({id:p.id,email:p.emailAddress||'',name:p.displayName||'',type:p.type,role:p.role}));}
 async owner(id){const m=await this.meta(id);if(!this.eligible(m)||!m.ownedByMe)throw new Error('자료 소유자만 공유 권한을 관리할 수 있습니다.');return m;}
 async share(id,d){
  await this.owner(id);const email=String(d.email||'').trim().toLowerCase();
  if(d.confirm!==true||!/^\S+@\S+\.\S+$/.test(email)||email===this.user.email)throw new Error('공유할 구글 계정과 전체 자료 공유 확인을 확인하세요.');
  const existing=(await this.permissions(id)).find(p=>p.email===email&&p.type==='user');
  if(!existing)await this.http(DRIVE+'/files/'+id+'/permissions?sendNotificationEmail=false',{method:'POST',body:{type:'user',role:'writer',emailAddress:email}});
  else if(existing.role!=='writer')await this.http(DRIVE+'/files/'+id+'/permissions/'+existing.id,{method:'PATCH',body:{role:'writer'}});
  return {permissions:await this.permissions(id),shareUrl:this.appUrl()+'?workspace='+id};
 }
 async revoke(id,d){await this.owner(id);const p=(await this.permissions(id)).find(p=>p.id===d.permissionId&&p.type==='user');if(!p)throw new Error('해제할 공유 계정을 확인하세요.');await this.http(DRIVE+'/files/'+id+'/permissions/'+p.id,{method:'DELETE'});return {permissions:await this.permissions(id)};}
 async join(link){let id=String(link||'').trim();if(id.startsWith('https:')){const u=new URL(id);id=u.hostname==='docs.google.com'?u.pathname.match(/\/spreadsheets\/d\/([\w-]+)/)?.[1]:u.searchParams.get('workspace');}if(!validId(id))throw new Error('학원 자료 주소를 확인하세요.');const m=await this.meta(id);this.remember(m);return this.select(id);}
 async chooseFile(){
  this.assertSession();if(!this.config.pickerApiKey||!this.config.projectNumber)throw new Error('파일 선택 연결 설정이 준비되지 않았습니다.');
  await new Promise((resolve,reject)=>{if(!globalThis.gapi)reject(new Error('구글 파일 선택 화면을 준비 중입니다. 다시 눌러주세요.'));else gapi.load('picker',{callback:resolve,onerror:()=>reject(new Error('파일 선택을 불러오지 못했습니다.'))});});
  return new Promise(resolve=>{
   const view=new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS).setIncludeFolders(false);
   const picker=new google.picker.PickerBuilder().addView(view).setOAuthToken(this.token).setDeveloperKey(this.config.pickerApiKey).setAppId(this.config.projectNumber).setOrigin(location.origin).setCallback(data=>{if(data.action===google.picker.Action.PICKED)resolve(data.docs[0].id);else if(data.action===google.picker.Action.CANCEL)resolve(null);}).build();picker.setVisible(true);
  });
 }
 async connectFile(){const id=await this.chooseFile();if(!id)return null;const m=await this.meta(id);if(this.eligible(m)){this.remember(m);return this.select(id);}if(!m.ownedByMe)throw new Error('기존 자료 이관은 소유자 계정에서 진행하세요. 공유받은 새 자료는 그대로 연결할 수 있습니다.');const params=new URLSearchParams();Object.keys(TABLES).forEach(n=>params.append('ranges',range(n)));params.set('valueRenderOption','UNFORMATTED_VALUE');const old=await this.http(SHEETS+'/'+id+'/values:batchGet?'+params);const base=parseBase(old.valueRanges);if(!confirm('선택한 기존 자료를 본인 소유의 새 시트로 복사해 연결할까요? 원본은 수정하지 않으며 공유 권한은 새로 설정해야 합니다.'))return null;return this.initialize(base);}
 async request(action,data={},id=this.selected){
  if(mutations.has(action)||action==='registerAndBook'){
   if(this.authPreview)throw new Error('로그인 연결 확인 화면입니다. 기존 자료는 읽기만 하며 저장하지 않습니다.');
   if(!this.user)throw new Error('로그인하세요.');if(!this.files.some(f=>f.id===id))throw new Error('현재 계정에 연결되지 않은 자료입니다.');
   return this.durableSave(action,data,id);
  }
  const initialEpoch=this.epoch;if(this.serverAuth.enabled)await this.ensureSession();if(this.epoch!==initialEpoch)throw new Error('계정이 바뀌어 요청을 중단했습니다.');this.assertSession();if(!this.user)throw new Error('로그인하세요.');
  if(this.authPreview&&!['load','listShares','export'].includes(action))throw new Error('로그인 연결 확인 화면입니다. 기존 자료는 읽기만 하며 저장하지 않습니다.');
  if(mutations.has(action)){if(!this.files.some(f=>f.id===id))throw new Error('현재 계정에 연결되지 않은 자료입니다.');return this.durableSave(action,data,id);}
  if(action==='load'){if(this.authPreview)return this.load(id,{readOnly:true});for(const workspace of new Set(this.unsent().map(r=>r.workspace)))await this.flushUnsent(workspace);return this.load(id);}
  if(action==='initialize')return this.initialize();
  if(action==='selectWorkspace')return this.select(data.id);
  if(action==='selectOwnWorkspace'){const own=this.files.find(f=>f.ownedByMe);if(!own){this.selected='';return {id:''};}return this.select(own.id);}
  if(action==='joinWorkspace')return this.join(data.link);
  if(!this.files.some(f=>f.id===id))throw new Error('현재 계정에 연결되지 않은 자료입니다.');
  if(action==='registerAndBook')return this.durableSave(action,data,id);
  if(action==='autoComplete')return tablesToData((await this.completeElapsed(id)).tables);
  if(action==='listShares'){await this.owner(id);return {permissions:await this.permissions(id)};}
  if(action==='shareWorkspace')return this.share(id,data);
  if(action==='revokeShare')return this.revoke(id,data);
  if(action==='exportXlsx'){
   await this.completeElapsed(id);
   for(let attempt=0;attempt<2;attempt++){
    await this.ensureSession();const epoch=this.epoch;let response;
    try{response=await this.fetcher(DRIVE+'/files/'+id+'/export?'+new URLSearchParams({mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),{headers:{Authorization:'Bearer '+this.token},signal:AbortSignal.timeout(25000)});}catch{throw new Error('엑셀 파일을 내려받지 못했습니다. 인터넷 연결 후 다시 시도하세요.');}
    if(epoch!==this.epoch)throw new Error('계정이 변경되었습니다.');
    if(response.status===401&&this.serverAuth.enabled&&attempt===0){await this.ensureSession({force:true});continue;}
    if(!response.ok)throw new Error('구글 시트의 엑셀 다운로드를 완료하지 못했습니다. 원본 시트에서 다시 다운로드하세요.');
    return response.arrayBuffer();
   }
  }
  if(action==='export'){const s=this.authPreview?await this.snapshot(id):await this.completeElapsed(id);return {format:'academy-calendar-v3',exportedAt:stamp(),tables:s.tables};}
  throw new Error('지원하지 않는 작업입니다.');
 }
}

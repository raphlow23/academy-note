import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {GoogleStore} from '../google-store.js';

test('새로고침 후 유효한 연결을 Google에 재확인하고 같은 계정 공간을 불러온다',async()=>{
 const previousStorage=globalThis.sessionStorage,previousLocation=globalThis.location,entries=new Map();
 globalThis.sessionStorage={getItem:k=>entries.get(k)||null,setItem:(k,v)=>entries.set(k,v),removeItem:k=>entries.delete(k)};
 globalThis.location={href:'https://example.test/academy/'};
 try{
  const first=new GoogleStore();first.token='test-saved-token';first.expires=Date.now()+60000;first.persistSession();
  const reloaded=new GoogleStore();let verified=0;
  reloaded.http=async url=>{assert(url.includes('/userinfo'));verified++;return {email:'restore@example.test',sub:'restore-owner'};};
  reloaded.listFiles=async()=>{reloaded.files=[{id:'restored-sheet',ownedByMe:true}];return reloaded.files;};
  assert.equal(await reloaded.restoreSession(),true);assert.equal(verified,1);assert.equal(reloaded.user.email,'restore@example.test');assert.equal(reloaded.selected,'restored-sheet');
  reloaded.disconnect();assert.equal(entries.size,0);assert.equal(reloaded.token,'');
 }finally{if(previousStorage===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=previousStorage;if(previousLocation===undefined)delete globalThis.location;else globalThis.location=previousLocation;}
});
test('만료·취소된 연결은 복구하지 않고 보관된 토큰을 지운다',async()=>{
 const previous=globalThis.sessionStorage,entries=new Map();globalThis.sessionStorage={getItem:k=>entries.get(k)||null,setItem:(k,v)=>entries.set(k,v),removeItem:k=>entries.delete(k)};
 try{
  const a=new GoogleStore();a.token='expired-token';a.expires=Date.now()-1;a.persistSession();assert.equal(await a.restoreSession(),false);assert.equal(entries.size,0);
  a.token='revoked-token';a.expires=Date.now()+60000;a.persistSession();a.connectAccount=async()=>{const e=new Error('revoked');e.code='AUTH_REQUIRED';throw e;};assert.equal(await a.restoreSession(),false);assert.equal(entries.size,0);
 }finally{if(previous===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=previous;}
});

test('첫 로그인 저장 공간을 자동 생성하고 동시 연결 요청은 한 번만 생성한다',async()=>{
 const a=new GoogleStore();a.user={sub:'auto-owner',email:'auto@example.test'};let creates=0;
 a.listFiles=async()=>a.files;
 a.initialize=async()=>{creates++;const m={id:'auto-sheet',ownedByMe:true};a.files.push(m);return {id:m.id};};
 assert.deepEqual(await Promise.all([a.ensureOwnWorkspace(),a.ensureOwnWorkspace()]),['auto-sheet','auto-sheet']);assert.equal(creates,1);
 assert.equal(await a.ensureOwnWorkspace(),'auto-sheet');assert.equal(creates,1);
});
test('로그인 완료 전에 자동 준비하고 재로그인에서는 기존 공간을 선택한다',async()=>{
 const savedGoogle=globalThis.google,savedLocation=globalThis.location;
 globalThis.location={href:'https://example.test/academy/'};
 globalThis.google={accounts:{oauth2:{hasGrantedAllScopes:()=>true,initTokenClient:o=>({requestAccessToken:()=>o.callback({access_token:'test-token',expires_in:3600})})}}};
 try{
  const a=new GoogleStore({config:{clientId:'test.apps.googleusercontent.com'}});let creates=0;
  const own={id:'first-login-sheet',ownedByMe:true,name:'내 학원'};
  a.http=async()=>({email:'first@example.test',sub:'first'});
  a.listFiles=async()=>{a.files=creates?[own]:[];return a.files;};
  a.initialize=async()=>{creates++;a.files=[own];return a.select(own.id);};
  await a.signIn();assert.equal(creates,1);assert.equal(a.selected,own.id);
  await a.signIn();assert.equal(creates,1);assert.equal(a.selected,own.id);
 }finally{if(savedGoogle===undefined)delete globalThis.google;else globalThis.google=savedGoogle;if(savedLocation===undefined)delete globalThis.location;else globalThis.location=savedLocation;}
});
test('기존 내 공간이 있으면 재사용하고 목록 조회 실패를 새 공간 생성으로 처리하지 않는다',async()=>{
 const a=new GoogleStore();a.user={sub:'existing-owner',email:'existing@example.test'};let creates=0;
 a.files=[{id:'existing-sheet',ownedByMe:true}];a.listFiles=async()=>a.files;a.initialize=async()=>{creates++;};
 assert.equal(await a.ensureOwnWorkspace(),'existing-sheet');assert.equal(creates,0);
 a.files=[];a.listFiles=async()=>{throw new Error('연결 실패');};await assert.rejects(a.ensureOwnWorkspace(),/연결 실패/);assert.equal(creates,0);
});

test('기본 브라우저 fetch를 저장소 객체의 this로 호출하지 않는다',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async function(){assert.equal(this,globalThis,'브라우저 fetch의 수신자는 Window여야 한다');return {ok:true,status:200,json:async()=>({email:'sample@example.com',sub:'test-user'})};};
 try{const a=new GoogleStore();a.token='test-token';a.expires=Date.now()+3600000;assert.equal((await a.http('https://openidconnect.googleapis.com/v1/userinfo')).sub,'test-user');}
 finally{globalThis.fetch=original;}
});

test('통신 실패는 연결 단계를 알리고 인증 정보는 오류에 포함하지 않는다',async()=>{
 const a=new GoogleStore({fetcher:async()=>{throw new Error('network failure');}});
 a.token='private-token';a.expires=Date.now()+3600000;
 await assert.rejects(a.http('https://openidconnect.googleapis.com/v1/userinfo'),e=>e.message.includes('구글 계정 확인')&&!e.message.includes(a.token));
 await assert.rejects(a.http('https://www.googleapis.com/drive/v3/files'),/구글 드라이브 연결/);
 await assert.rejects(a.http('https://sheets.googleapis.com/v4/spreadsheets/test',{method:'POST',body:{}}),/저장 응답.*저장 여부/);
});
import {emptyTables,replay} from '../domain.js';
import {LOG_HEADERS} from '../workbook.js';

const id='spreadsheet_'+randomUUID().replaceAll('-','');
const person='owner@example.test';
function fixture(){
 const s={id:randomUUID(),version:0,name:'김하늘',phone:'',since:'2022-01-01',note:'',active:true,priorCount:0,priorPaid:0};
 const p={id:randomUUID(),studentId:s.id,date:'2026-11-01',kind:'정규권',credits:1,amount:10000,note:''};
 const e=(action,data)=>({id:randomUUID(),action,data,actor:person,at:'2026-11-04 10:00:00'});
 const base=replay(emptyTables(),[e('saveStudent',s),e('addTransaction',p)]).tables;
 const rows=[LOG_HEADERS],calls=[];let loseNextAppend=false;
 const meta={id,name:'학원 노트',mimeType:'application/vnd.google-apps.spreadsheet',ownedByMe:true,capabilities:{canEdit:true},appProperties:{academySchema:'3'},owners:[{emailAddress:person}]};
 const fetcher=async(url,options)=>{
  const u=new URL(url),body=options.body?JSON.parse(options.body):null;calls.push({url,method:options.method,body});
  assert.match(options.headers.Authorization,/^Bearer token-/);
  let out={};
  if(u.pathname.startsWith('/drive/v3/files/')&&options.method==='GET')out=meta;
  else if(u.pathname.endsWith('/values:batchGet'))out={valueRanges:[...Object.values(base).map(values=>({values:structuredClone(values)})),{values:rows.map(r=>{const out=structuredClone(r);while(out.length&&out.at(-1)==='')out.pop();return out;})}]};
  else if(u.pathname.endsWith(':append')){rows.push(structuredClone(body.values[0]));if(loseNextAppend){loseNextAppend=false;throw new Error('Lost response after commit');}out={updates:{updatedRange:"'작업기록'!A"+rows.length+':V'+rows.length}};}
  else if(u.pathname.endsWith('/values:batchUpdate')){for(const d of body.data){const row=Number(d.range.match(/!F(\d+)/)[1])-1;d.values[0].forEach((v,i)=>rows[row][i+5]=v);}}
  else throw new Error('Unexpected test URL '+u.pathname);
  return {ok:true,status:200,json:async()=>structuredClone(out)};
 };
 function client(email=person){const store=new GoogleStore({fetcher});store.appUrl=()=> 'https://example.test/academy/';store.token='token-'+email;store.expires=Date.now()+3600000;store.user={email,sub:email,name:email,role:'admin'};store.files=[meta];store.selected=id;return store;}
 const command=()=>({id:randomUUID(),studentId:s.id,passId:p.id,date:'2026-11-07',time:'11:00',endTime:'13:00',note:''});
 return {client,command,rows,calls,base,lose(){loseNextAppend=true;}};
}
test('두 기기가 동시에 마지막 1회를 예약해도 적용된 예약은 하나다',async()=>{const f=fixture(),a=f.client(),b=f.client('editor@example.test');const results=await Promise.allSettled([a.request('book',f.command(),id),b.request('book',f.command(),id)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);const d=await a.request('load',{},id);assert.equal(d.bookings.length,1);assert.equal(f.rows.filter(r=>r[5]==='적용').length,1);assert.equal(f.rows.filter(r=>r[5]==='거절').length,1);});
test('시트에 추가된 직후 응답이 사라져도 재시도에서 같은 작업을 찾아 중복 추가하지 않는다',async()=>{const f=fixture(),a=f.client(),cmd=f.command();f.lose();await assert.rejects(a.request('book',cmd,id),/저장 응답/);const saved=await a.request('book',cmd,id);assert.equal(saved.id,cmd.id);assert.equal(f.rows.length,2);assert.equal((await a.request('load',{},id)).bookings.length,1);});
test('로그인 만료 후에는 API에 데이터를 전송하지 않는다',async()=>{const f=fixture(),a=f.client();a.expires=0;await assert.rejects(a.request('book',f.command(),id),/만료/);assert.equal(f.calls.length,0);});
test('등록되지 않은 파일 ID로는 저장하지 않는다',async()=>{const f=fixture(),a=f.client();await assert.rejects(a.request('book',f.command(),'other_file_12345678901234567890'),/연결되지/);assert.equal(f.calls.length,0);});
test('계정 전환 중 도착한 이전 계정 응답을 새 계정에 적용하지 않는다',async()=>{let release;const a=new GoogleStore({fetcher:()=>new Promise(resolve=>release=()=>resolve({ok:true,status:200,json:async()=>({secret:'old account data'})}))});a.token='token-old';a.expires=Date.now()+3600000;const result=a.http('https://www.googleapis.com/drive/v3/files/test');a.disconnect();a.token='token-new';a.expires=Date.now()+3600000;release();await assert.rejects(result,/계정이 바뀌어/);});
test('잘못된 예약 시간은 추가 API 요청 전에 검증하고 시트 작업기록을 늘리지 않는다',async()=>{const f=fixture(),a=f.client();await assert.rejects(a.request('book',{...f.command(),time:'11:15'},id),/30분/);assert.equal(f.rows.length,1);assert.equal(f.calls.some(c=>c.url.includes(':append')),false);});

test('이미 반영된 기록은 다시 불러올 때 불필요한 저장 요청을 반복하지 않는다',async()=>{const f=fixture(),a=f.client();await a.request('book',f.command(),id);const writes=f.calls.filter(c=>c.method==='POST').length;await a.request('load',{},id);await a.request('load',{},id);assert.equal(f.calls.filter(c=>c.method==='POST').length,writes);});

test('지난 수업을 저장된 완료로 자동 전환하고 재접속·두 기기에서도 한 번만 적용하며 완료 취소로 1회를 복구한다',async()=>{
 const f=fixture(),a=f.client(),b=f.client('editor@example.test');
 const cmd={...f.command(),date:'2020-01-04'};
 f.base['수강권납부'][1][3]='2020-01-01';
 await a.request('book',cmd,id);
 const both=await Promise.all([a.request('load',{},id),b.request('load',{},id)]);
 for(const d of both){assert.equal(d.bookings[0].status,'수강완료');assert.equal(d.bookings[0].endTime,'13:00');}
 const done=await a.request('load',{},id);assert.equal(done.bookings[0].version,2);
 const autoRows=f.rows.slice(1).filter(r=>JSON.parse(r[4]).automatic&&r[5]==='적용');assert.equal(autoRows.length,1);
 assert.equal(done.bookings.filter(x=>x.status!=='취소').length,1);
 await a.request('changeBooking',{id:cmd.id,version:2,status:'취소'},id);
 const cancelled=await a.request('load',{},id);assert.equal(cancelled.bookings[0].status,'취소');
 assert.equal(cancelled.bookings.filter(x=>x.status!=='취소').length,0);
 assert.equal(cancelled.bookings.filter(x=>x.status==='수강완료').length,0);
 assert.equal(cancelled.transactions[0].credits-cancelled.bookings.filter(x=>x.status!=='취소').length,1);
});

test('브라우저 보관 기능이 없어도 현재 계정의 자료 선택은 동작한다',()=>{const f=fixture(),a=f.client();assert.equal(a.select(id).id,id);});
test('1000행을 넘는 자료의 조회용 표를 확장하고 같은 확장을 반복하지 않는다',async()=>{const base=emptyTables();for(let i=0;i<1005;i++)base['예약'].push(['old'+i]);const titles=[...Object.keys(base),'수강현황'];let reads=0;const batches=[];const a=new GoogleStore({fetcher:async(url,o)=>{if(o.method==='GET'){reads++;return {ok:true,status:200,json:async()=>({sheets:titles.map((title,sheetId)=>({properties:{title,sheetId,gridProperties:{rowCount:1000}}}))})};}batches.push(JSON.parse(o.body));return {ok:true,status:200,json:async()=>({})};}});a.token='token-capacity';a.expires=Date.now()+3600000;await a.ensureViewCapacity(id,base);await a.ensureViewCapacity(id,base);assert.equal(reads,1);assert.equal(batches.length,1);assert.equal(batches[0].requests[0].appendDimension.length,500);});
test('기존 자료 이관 전에 새 파일의 비공개 여부를 확인하고 자동 공유 파일에는 기록을 쓰지 않는다',async()=>{const f=fixture();f.base['수강생'][1][1]='SecretStudent';let createdBody;const urls=[];const a=new GoogleStore({fetcher:async(url,o)=>{urls.push(url);let data;if(url.endsWith('/v4/spreadsheets')){createdBody=JSON.parse(o.body);data={spreadsheetId:id,sheets:createdBody.sheets};}else if(url.includes('/permissions'))data={permissions:[{id:'owner',role:'owner'},{id:'unexpected',type:'domain',role:'reader'}]};else data={id,ownedByMe:true};return {ok:true,status:200,json:async()=>data};}});a.token='token-create';a.expires=Date.now()+3600000;a.user={email:person};await assert.rejects(a.initialize(f.base),/자동 공유/);assert.equal(JSON.stringify(createdBody).includes('SecretStudent'),false);assert.equal(urls.some(u=>u.includes(':batchUpdate')),false);});

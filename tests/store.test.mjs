import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {GoogleStore} from '../google-store.js';
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

test('브라우저 보관 기능이 없어도 현재 계정의 자료 선택은 동작한다',()=>{const f=fixture(),a=f.client();assert.equal(a.select(id).id,id);});
test('1000행을 넘는 자료의 조회용 표를 확장하고 같은 확장을 반복하지 않는다',async()=>{const base=emptyTables();for(let i=0;i<1005;i++)base['예약'].push(['old'+i]);const titles=[...Object.keys(base),'수강현황'];let reads=0;const batches=[];const a=new GoogleStore({fetcher:async(url,o)=>{if(o.method==='GET'){reads++;return {ok:true,status:200,json:async()=>({sheets:titles.map((title,sheetId)=>({properties:{title,sheetId,gridProperties:{rowCount:1000}}}))})};}batches.push(JSON.parse(o.body));return {ok:true,status:200,json:async()=>({})};}});a.token='token-capacity';a.expires=Date.now()+3600000;await a.ensureViewCapacity(id,base);await a.ensureViewCapacity(id,base);assert.equal(reads,1);assert.equal(batches.length,1);assert.equal(batches[0].requests[0].appendDimension.length,500);});
test('기존 자료 이관 전에 새 파일의 비공개 여부를 확인하고 자동 공유 파일에는 기록을 쓰지 않는다',async()=>{const f=fixture();f.base['수강생'][1][1]='SecretStudent';let createdBody;const urls=[];const a=new GoogleStore({fetcher:async(url,o)=>{urls.push(url);let data;if(url.endsWith('/v4/spreadsheets')){createdBody=JSON.parse(o.body);data={spreadsheetId:id,sheets:createdBody.sheets};}else if(url.includes('/permissions'))data={permissions:[{id:'owner',role:'owner'},{id:'unexpected',type:'domain',role:'reader'}]};else data={id,ownedByMe:true};return {ok:true,status:200,json:async()=>data};}});a.token='token-create';a.expires=Date.now()+3600000;a.user={email:person};await assert.rejects(a.initialize(f.base),/자동 공유/);assert.equal(JSON.stringify(createdBody).includes('SecretStudent'),false);assert.equal(urls.some(u=>u.includes(':batchUpdate')),false);});

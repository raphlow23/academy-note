import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {GoogleStore} from '../google-store.js';
import {TABLES,emptyTables,replay} from '../domain.js';
import {LOG,LOG_HEADERS,BASE} from '../workbook.js';
function fixture(){
 const id='existing_sheet_123456789012345',sid=randomUUID(),pid=randomUUID(),actor='owner@example.test',at='2026-11-06 12:00:00',base=emptyTables();
 const events=[{id:'student-command',action:'saveStudent',actor,at,data:{id:sid,version:0,name:'테스트 학생',phone:'01012345678',since:'2026-11-01',note:'',active:true,priorCount:0,priorPaid:0}},{id:'pass-command',action:'addTransaction',actor,at,data:{id:pid,studentId:sid,date:'2026-11-01',kind:'정규권',credits:8,amount:80000,note:''}}];
 const log=[LOG_HEADERS,...events.map(e=>[e.id,e.action,e.actor,e.at,JSON.stringify(e.data),'처리 대기'])],views=Object.fromEntries([...Object.entries(TABLES),['수강현황',['머리글']]].map(([n,h])=>[n,[h.slice()]])),names=Object.keys(views),calls=[];let failWrite=false;
 const fetcher=async(url,o={})=>{calls.push({url,method:o.method||'GET'});const u=new URL(url);let result={};
  if(u.pathname.startsWith('/drive/v3/files/')&&u.pathname.endsWith('/export')){assert(views.수강생.length>1,'값 복구가 끝난 뒤에만 다운로드');assert.equal(views.수강현황[1][8],8);return {ok:true,status:200,arrayBuffer:async()=>new Uint8Array([80,75,3,4]).buffer};}
  if(u.pathname.startsWith('/drive/v3/files/'))result={id,mimeType:'application/vnd.google-apps.spreadsheet',appProperties:{academySchema:'3'},capabilities:{canEdit:true},ownedByMe:true};
  else if(u.pathname.endsWith('/values:batchGet'))result={valueRanges:u.searchParams.getAll('ranges').map(r=>{const n=r.slice(1,-1);return {values:structuredClone(n===LOG?log:n.startsWith('이관_')?base[n.slice(3)]:views[n]||[])};})};
  else if(u.searchParams.has('fields'))result={sheets:names.map((title,sheetId)=>({properties:{title,sheetId,gridProperties:{rowCount:1000}}}))};
  else if(u.pathname.endsWith('/values:batchUpdate')){const data=JSON.parse(o.body).data;for(const d of data){const row=Number(d.range.match(/!F(\d+)/)[1])-1;d.values[0].forEach((v,i)=>log[row][i+5]=v);}}
  else if(u.pathname.endsWith(':batchUpdate')){if(failWrite)return {ok:false,status:503,json:async()=>({})};for(const r of JSON.parse(o.body).requests){assert(r.updateCells);const n=names[r.updateCells.range.sheetId];assert(n&&!n.startsWith('이관_')&&n!==LOG);views[n]=r.updateCells.rows.map(row=>row.values.map(c=>c.userEnteredValue.numberValue??c.userEnteredValue.stringValue));}}
  else throw Error('Unexpected '+url);
  return {ok:true,status:200,json:async()=>structuredClone(result)};
 };
 const store=new GoogleStore({config:{clientId:'test.apps.googleusercontent.com',authEnabled:false,viewValues:true},fetcher});store.appUrl=()=> 'https://example.test/academy/';store.token='test-token';store.expires=Date.now()+3600000;store.user={sub:'owner',email:actor};store.files=[{id}];store.selected=id;
 return {store,id,base,events,log,views,calls,fail:()=>failWrite=true};
}
test('숨겨진 원본과 작업 이력만 있어도 일반 조회 탭을 복구하고 실제 값 확인 후 엑셀을 받는다',async()=>{
 const f=fixture(),source=JSON.stringify(f.base),commands=JSON.stringify(f.log.map(r=>r.slice(0,5)));const bytes=await f.store.request('exportXlsx',{},f.id);
 assert.equal(new Uint8Array(bytes)[0],80);assert.equal(f.views.수강생.length,2);assert.equal(f.views.수강권납부.length,2);assert.equal(f.views.수강현황[1][10],80000);assert.equal(JSON.stringify(f.base),source);assert.equal(JSON.stringify(f.log.map(r=>r.slice(0,5))),commands);
 const writes=f.calls.filter(c=>c.url.endsWith(':batchUpdate')).length;await f.store.request('load',{},f.id);assert.equal(f.calls.filter(c=>c.url.endsWith(':batchUpdate')).length,writes);
});
test('표 복구에 실패하면 빈 엑셀을 정상 다운로드로 내보내지 않는다',async()=>{const f=fixture();f.fail();await assert.rejects(f.store.request('exportXlsx',{},f.id));assert.equal(f.calls.some(c=>c.url.includes('/export?')),false);});
test('읽기 전용 확인 모드는 원본 조회용 표도 쓰지 않는다',async()=>{const f=fixture();f.store.authPreview=true;const result=await f.store.request('load',{},f.id);assert.equal(result.students.length,1);assert(f.calls.every(c=>c.method==='GET'));});

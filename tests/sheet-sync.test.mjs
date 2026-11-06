import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyTables,replay,tablesToData} from '../domain.js';
import {INPUT_NAMES,INPUT_TITLE,inputHeaders} from '../sheet-input.js';
import {syncSheetInputs} from '../sheet-sync.js';
function fixture(){
 const base=emptyTables(),events=[],writes=[],groups=Object.fromEntries(INPUT_NAMES.map(n=>[n,[inputHeaders(n)]]));let inputReads=0,onReread=()=>{};
 const store={user:{sub:'test-owner',email:'teacher@example.test'},epoch:0,async snapshot(){return {events:structuredClone(events),...replay(base,events)};},async settle(){},async http(url,options={}){
  if(url.includes('?fields=sheets'))return {sheets:[...INPUT_NAMES.map(INPUT_TITLE),'시트입력안내'].map((title,sheetId)=>({properties:{title,sheetId}}))};
  if(url.includes('/values:batchGet')){inputReads++;if(inputReads%2===0)onReread(groups);return {valueRanges:INPUT_NAMES.map(n=>({values:structuredClone(groups[n])}))};}
  writes.push({url,body:options.body});
  if(url.includes(':append')){for(const r of options.body.values)events.push({id:r[0],action:r[1],actor:r[2],at:r[3],data:JSON.parse(r[4])});return {};}
  if(url.includes('/values:batchUpdate')){for(const item of options.body.data){const m=item.range.match(/^'입력_(.+)'!([A-Z]+)(\d+)/),col=[...m[2]].reduce((n,ch)=>n*26+ch.charCodeAt(0)-64,0)-1,row=groups[m[1]][Number(m[3])-1];item.values[0].forEach((v,i)=>row[col+i]=v);}return {};}
  throw Error('Unexpected write '+url);
 }};
 return {store,groups,writes,events,base,onReread(fn){onReread=fn;}};
}
test('입력 탭만 읽고 작업기록에 추가하며 기존 이관 원본이나 조회 수식을 덮어쓰지 않는다',async()=>{
 const f=fixture(),before=structuredClone(f.base);f.groups.수강생.push(['','김새학생','01012345678','2026-11-01','','재원',0,0]);
 const result=await syncSheetInputs(f.store,'same-original-sheet');assert.equal(result.changed,true);assert.equal(result.errors,0);assert.deepEqual(f.base,before);assert.equal(f.events.length,1);
 assert(f.writes.every(w=>w.url.includes(':append')||w.body.data.every(d=>d.range.startsWith("'입력_"))));
 assert.equal(f.groups.수강생[1][11],'반영 완료');assert(f.groups.수강생[1][0]);assert.equal(f.groups.수강생[1][8],'1');
 const again=await syncSheetInputs(f.store,'same-original-sheet');assert.equal(again.changed,false);assert.equal(f.events.length,1);
});
test('통신 중 사용자가 다시 쓴 셀은 반영확인값과 ID로 덮어쓰지 않는다',async()=>{
 const f=fixture();f.groups.수강생.push(['','수정전','','2026-11-01']);f.onReread(g=>g.수강생[1][1]='수정중');
 await syncSheetInputs(f.store,'same-original-sheet');assert.equal(f.groups.수강생[1][1],'수정중');assert.equal(f.groups.수강생[1][0],'');assert.equal(f.writes.filter(w=>w.url.includes('/values:batchUpdate')).length,0);
 assert.equal(tablesToData(replay(f.base,f.events).tables).students[0].name,'수정전');
});
test('읽기 전용 인증 확인 화면에서는 새 탭도 만들거나 입력을 반영하지 않는다',async()=>{
 const f=fixture();f.store.authPreview=true;await assert.rejects(syncSheetInputs(f.store,'same-original-sheet'),/읽기 전용/);assert.equal(f.writes.length,0);
});

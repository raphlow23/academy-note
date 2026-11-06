import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyTables,replay,tablesToData,TABLES} from '../domain.js';
import {inputHeaders,inputHash,planSheetInputs,INPUT_NAMES} from '../sheet-input.js';
const actor='teacher@example.test',at='2026-11-06 12:00:00',workspace='test_sheet_123456789012345';
const groups=()=>Object.fromEntries(INPUT_NAMES.map(n=>[n,[inputHeaders(n)]]));
const snapshot=(base=emptyTables(),events=[])=>({events,...replay(base,events)});
const student=()=>['','김하늘','01012345678','2026-11-01','','재원',0,0];
const pass=()=>['','','김하늘','2026-11-01','정규권',3,100000,''];
const booking=()=>['','2026-11-07','11:00','','김하늘','','정규권','예약','',0,'','','13:00'];

test('시트의 학생·납부·예약을 순서대로 검증하고 동일한 잔여·누적 자료로 재생한다',async()=>{
 const input=groups();input.수강생.push(student());input.수강권납부.push(pass());input.예약.push(booking());
 const plan=await planSheetInputs(snapshot(),input,actor,at,workspace),d=tablesToData(plan.tables);
 assert.equal(plan.events.length,3);assert.equal(plan.receipts.filter(r=>r.status!=='반영 완료').length,0);
 assert.equal(d.students[0].phone,'01012345678');assert.equal(d.transactions[0].credits,3);assert.equal(d.bookings[0].passId,d.transactions[0].id);
 assert.equal(d.transactions[0].credits-d.bookings.filter(b=>b.status!=='취소').length,2);
 assert.deepEqual(replay(emptyTables(),plan.events).tables,plan.tables);
});
test('동시 불러오기와 응답 유실 후 재시도에도 같은 입력은 한 번만 차감한다',async()=>{
 const input=groups();input.수강생.push(student());input.수강권납부.push(pass());input.예약.push(booking());
 const first=await planSheetInputs(snapshot(),input,actor,at,workspace),second=await planSheetInputs(snapshot(),input,actor,at,workspace);
 const replayed=replay(emptyTables(),[...first.events,...second.events]);assert.equal(tablesToData(replayed.tables).bookings.length,1);assert.equal(tablesToData(replayed.tables).transactions.length,1);
 const retry=await planSheetInputs(snapshot(emptyTables(),first.events),input,actor,at,workspace);assert.equal(retry.events.length,0);assert(retry.receipts.every(r=>r.status==='반영 완료'));
});
test('확인값이 같은 완료 행은 다시 처리하지 않는다',async()=>{
 const input=groups();input.수강생.push(student());const plan=await planSheetInputs(snapshot(),input,actor,at,workspace),r=plan.receipts[0];
 const final=r.values;input.수강생[1]=[...final,'반영 완료','완료',await inputHash(final,TABLES.수강생.length)];
 const retry=await planSheetInputs(snapshot(emptyTables(),plan.events),input,actor,at,workspace);assert.equal(retry.events.length,0);assert.equal(retry.receipts.length,0);
});
test('잘못된 행만 오류를 표시하고 정상 행과 기존 자료는 보존한다',async()=>{
 const input=groups();input.수강생.push(student(),['','잘못된 학생','','2026-02-30']);input.수강권납부.push(pass());input.예약.push(booking());
 const original=snapshot(),copy=JSON.stringify(original),plan=await planSheetInputs(original,input,actor,at,workspace);
 assert.equal(JSON.stringify(original),copy);assert.equal(plan.events.length,3);assert.equal(plan.receipts.filter(r=>r.status==='확인 필요').length,1);
});
test('동명이인은 ID 없이 납부에 연결하지 않고 금액 미입력을 0원으로 등록하지 않는다',async()=>{
 const input=groups();input.수강생.push(student(),student());input.수강권납부.push(pass());
 const plan=await planSheetInputs(snapshot(),input,actor,at,workspace);assert.match(plan.receipts.at(-1).message,/동명이인/);assert.equal(tablesToData(plan.tables).transactions.length,0);
 const one=groups();one.수강생.push(student());const p=pass();p[6]='';one.수강권납부.push(p);const invalid=await planSheetInputs(snapshot(),one,actor,at,workspace);assert.equal(tablesToData(invalid.tables).transactions.length,0);
});
test('예약 취소 행은 원래 예약을 보존하면서 잔여 1회를 복구한다',async()=>{
 const input=groups();input.수강생.push(student());input.수강권납부.push(pass());input.예약.push(booking());const initial=await planSheetInputs(snapshot(),input,actor,at,workspace);
 const cancel=groups(),row=initial.tables.예약[1].slice();row[7]='취소';cancel.예약.push(row);
 const plan=await planSheetInputs(snapshot(emptyTables(),initial.events),cancel,actor,at,workspace);assert.equal(plan.events[0].action,'changeBooking');assert.equal(tablesToData(plan.tables).bookings[0].status,'취소');
 assert.equal(tablesToData(plan.tables).transactions[0].credits,3);
});
test('기존 납부 금액 변경과 과거 버전 수정은 중복 거래·덮어쓰기가 되지 않는다',async()=>{
 const input=groups();input.수강생.push(student());input.수강권납부.push(pass());const first=await planSheetInputs(snapshot(),input,actor,at,workspace),change=groups();
 const p=first.tables.수강권납부[1].slice();p[6]=200000;change.수강권납부.push(p);
 const s=first.tables.수강생[1].slice();s[1]='다른 이름';s[8]=0;change.수강생.push(s);
 const plan=await planSheetInputs(snapshot(emptyTables(),first.events),change,actor,at,workspace);assert.equal(plan.events.length,0);assert.equal(plan.receipts.filter(r=>r.status==='확인 필요').length,2);assert.deepEqual(plan.tables,first.tables);
});
test('머리글이 바뀌면 열을 잘못 연결하지 않고 중단한다',async()=>{
 const input=groups();input.수강생[0][1]='연락처';await assert.rejects(planSheetInputs(snapshot(),input,actor,at,workspace),/머리글/);
});

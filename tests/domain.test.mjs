import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {emptyTables,replay,tablesToData} from '../domain.js';
import {orderedStudentGroups} from '../student-order.js';
import {studentCreditState,isLastLesson} from '../student-alerts.js';
import {workbookResource,parseBase} from '../workbook.js';
import {scheduleAtDate} from '../schedule-history.js';

const actor='owner@example.test';
const event=(action,data,extra={})=>({id:randomUUID(),action,data,actor,at:'2026-11-04 10:00:00',...extra});
function fixture(credits=3){
 const s={id:randomUUID(),version:0,name:'김하늘',phone:'',since:'2022-01-01',note:'',active:true,priorCount:3,priorPaid:10000};
 const pass={id:randomUUID(),studentId:s.id,date:'2026-11-01',kind:'정규권',credits,amount:300000,note:''};
 const events=[event('saveStudent',s),event('addTransaction',pass)];
 const book=(date='2026-11-07',time='11:00',endTime='13:00')=>event('book',{id:randomUUID(),studentId:s.id,passId:pass.id,date,time,endTime,note:''});
 return {s,pass,events,book,fold:(extra=[])=>replay(emptyTables(),events.concat(extra))};
}
test('자동 완료는 수업 시작부터 적용되고 취소하면 차감·완료 집계 대상에서 빠진다',()=>{
 const f=fixture(),b=f.book();
 const complete=at=>event('changeBooking',{id:b.data.id,version:1,status:'수강완료',automatic:true},{at});
 const early=f.fold([b,complete('2026-11-07 10:59:59')]);assert.equal(early.outcomes.at(-1).status,'거절');
 const done=f.fold([b,complete('2026-11-07 11:00:00')]);assert.equal(done.outcomes.at(-1).status,'적용');assert.equal(tablesToData(done.tables).bookings[0].status,'수강완료');
 const cancelled=replay(done.tables,[event('changeBooking',{id:b.data.id,version:2,status:'취소'},{at:'2026-11-07 11:01:00'})]);
 const bs=tablesToData(cancelled.tables).bookings;assert.equal(bs.filter(x=>x.status!=='취소').length,0);assert.equal(bs.filter(x=>x.status==='수강완료').length,0);
});
test('마지막 잔여 1회의 동시 요청은 시트 행 순서상 첫 요청만 적용한다',()=>{
 const f=fixture(1),a=f.book(),b=f.book('2026-11-08');
 for(const order of [[a,b],[b,a]]){const r=f.fold(order);assert.equal(r.outcomes.at(-2).status,'적용');assert.equal(r.outcomes.at(-1).status,'거절');assert.match(r.outcomes.at(-1).error,/잔여 횟수/);assert.equal(tablesToData(r.tables).bookings.length,1);}
});
test('응답 유실로 동일 작업이 다시 추가돼도 두 번 차감하지 않는다',()=>{const f=fixture(1),b=f.book(),r=f.fold([b,b]);assert.equal(r.outcomes.at(-1).status,'중복');assert.equal(tablesToData(r.tables).bookings.length,1);assert.equal(r.outcomes.at(-1).result.id,b.data.id);});
test('다른 내용으로 작업 ID를 재사용하면 적용하지 않는다',()=>{const f=fixture(),b=f.book(),r=f.fold([b,{...b,data:{...b.data,date:'2026-11-08'}}]);assert.equal(r.outcomes.at(-1).status,'중복');assert.equal(r.outcomes.at(-1).result,null);assert.equal(tablesToData(r.tables).bookings.length,1);});
test('완료는 추가 차감 없고 취소는 복구되며 이후 재예약을 허용한다',()=>{
 const f=fixture(1),b=f.book('2026-11-04'),done=event('changeBooking',{id:b.data.id,version:1,status:'수강완료'}),cancel=event('changeBooking',{id:b.data.id,version:2,status:'취소'});
 const a=f.fold([b,done]);assert.equal(studentCreditState(f.s.id,tablesToData(a.tables)).remaining,0);
 const r=f.fold([b,done,cancel,f.book('2026-11-09')]);assert.equal(r.outcomes.at(-1).status,'적용');assert.equal(studentCreditState(f.s.id,tablesToData(r.tables)).remaining,0);assert.equal(tablesToData(r.tables).bookings.length,2);
});
test('잘못된 요청은 원본을 일부 수정하지 않는다',()=>{const f=fixture(),before=f.fold(),bad=event('saveStudent',{...f.s,version:1,name:'변경',priorPaid:-1}),r=f.fold([bad]);assert.deepEqual(r.tables,before.tables);assert.equal(r.outcomes.at(-1).status,'거절');});
test('동시에 같은 수강생을 수정하면 먼저 적용된 버전 뒤의 오래된 수정은 거절한다',()=>{const f=fixture(),a=event('saveStudent',{...f.s,version:1,name:'가나다'}),b=event('saveStudent',{...f.s,version:1,name:'다른 수정'}),r=f.fold([a,b]);assert.equal(r.outcomes.at(-1).status,'거절');assert.equal(tablesToData(r.tables).students[0].name,'가나다');});
test('요일별 타임과 휴무는 서로 보존하며 정규권·1일 클래스 시간을 검증한다',()=>{
 const f=fixture(),slots=[{id:randomUUID(),day:6,start:'11:00',end:'13:00'},{id:randomUUID(),day:6,start:'13:30',end:'15:30'},{id:randomUUID(),day:6,start:'16:00',end:'18:00'}];
 const sch=event('saveSchedule',{version:1,slots}),hol=event('saveClosures',{version:1,weekdays:[0],ranges:[]});
 const bad=f.book('2026-11-07','11:30','12:30'),good=f.book(),r=f.fold([sch,hol,bad,good]);
 assert.equal(r.outcomes.at(-2).status,'거절');assert.equal(r.outcomes.at(-1).status,'적용');assert.equal(tablesToData(r.tables).schedule.slots.length,3);assert.deepEqual(tablesToData(r.tables).closures.weekdays,[0]);
 const one={...f.pass,id:randomUUID(),kind:'1일클래스',credits:1},b=event('book',{...bad.data,id:randomUUID(),passId:one.id}),rr=f.fold([sch,event('addTransaction',one),b]);assert.equal(rr.outcomes.at(-1).status,'적용');assert.equal(tablesToData(rr.tables).bookings[0].endTime,'12:30');
});
test('같은 학생의 겹치는 예약은 막고 서로 다른 수강생의 같은 타임은 허용한다',()=>{const f=fixture(),a=f.book(),b=f.book('2026-11-07','12:30','14:30'),r=f.fold([a,b]);assert.match(r.outcomes.at(-1).error,/겹치는/);});
test('예약 당일부터 상단으로 이동하며 미래 예약·예전 수강생을 분리하고 이름순으로 정렬한다',()=>{
 const students=[{id:'b',name:'박하늘',active:true},{id:'g',name:'김하늘',active:true},{id:'old',name:'강이전',active:false},{id:'n',name:'나미래',active:true}];
 const bookings=[{studentId:'g',date:'2026-11-04',status:'예약'},{studentId:'b',date:'2026-11-03',status:'예약'},{studentId:'n',date:'2026-11-05',status:'예약'}];
 const groups=orderedStudentGroups(students,bookings,'2026-11-04');assert.deepEqual(groups.map(g=>g.students.map(s=>s.id)),[['g','b'],['n'],['old']]);
 assert.deepEqual(orderedStudentGroups(students,bookings,'2026-11-05')[0].students.map(s=>s.id),['g','n','b']);
 assert.equal(orderedStudentGroups(students,bookings,'2026-11-04','',false).length,2);
});
test('취소·완료 예약은 미래 예약으로 세지 않는다',()=>{const s=[{id:'a',name:'가',active:true}],b=[{studentId:'a',date:'2026-12-01',status:'취소'},{studentId:'a',date:'2026-12-02',status:'수강완료'}];assert.match(orderedStudentGroups(s,b,'2026-11-04')[0].title,/다음 예약 없음/);});
test('소진 표시와 마지막 수업은 예약 취소·추가 수강권에 따라 다시 계산된다',()=>{
 const f=fixture(2),a=f.book('2026-11-04'),b=f.book('2026-11-07'),r=f.fold([a,b]),d=tablesToData(r.tables);
 assert.equal(studentCreditState(f.s.id,d).exhausted,true);assert.equal(isLastLesson(d.bookings[0],d),false);assert.equal(isLastLesson(d.bookings[1],d),true);
 const cancelled=f.fold([a,b,event('changeBooking',{id:b.data.id,version:1,status:'취소'})]),dc=tablesToData(cancelled.tables);assert.equal(studentCreditState(f.s.id,dc).exhausted,false);assert.equal(isLastLesson(dc.bookings[0],dc),false);
 const renewed=f.fold([a,b,event('addTransaction',{...f.pass,id:randomUUID(),credits:8})]);assert.equal(studentCreditState(f.s.id,tablesToData(renewed.tables)).exhausted,false);
});
test('아직 수강권을 등록하지 않은 신규 학생은 소진으로 잘못 표시하지 않는다',()=>{assert.equal(studentCreditState('new',{transactions:[],bookings:[]}).exhausted,false);});
test('기존 12열 예약 자료를 보존해 이관하고 늦은 시각의 추정 종료를 24시로 제한한다',()=>{const f=fixture(),r=f.fold([f.book('2026-11-07','23:00','24:00')]),ranges=Object.values(r.tables).map(rows=>({values:rows}));ranges[2].values=ranges[2].values.map(r=>r.slice(0,12));const base=parseBase(ranges);assert.equal(base['예약'][0].length,13);assert.equal(tablesToData(base).bookings[0].endTime,'24:00');assert.equal(tablesToData(base).bookings[0].legacyTime,true);});
test('새 워크북은 직접 확인 가능한 작업기록과 수강현황을 포함한다',()=>{const r=workbookResource();assert(r.sheets.find(s=>s.properties.title==='작업기록'));assert(r.sheets.find(s=>s.properties.title==='수강현황'));assert.equal(r.sheets.find(s=>s.properties.title==='수강생').data[1].rowData[0].values[0].userEnteredValue.formulaValue.startsWith('=IFERROR'),true);});

const weekSlots=(start,end)=>Array.from({length:7},(_,day)=>({id:randomUUID(),day,start,end}));
test('적용일 이전 시간표와 완료·미래 예약의 원래 시간이 보존된다',()=>{
 const f=fixture(10),old=event('saveSchedule',{version:1,slots:weekSlots('11:00','13:00')}),past=f.book('2026-11-03'),future=f.book('2026-11-07');
 const done=event('changeBooking',{id:past.data.id,version:1,status:'수강완료'}),change=event('saveSchedule',{version:2,effectiveFrom:'2026-11-05',slots:weekSlots('13:30','15:30')});
 const before=f.fold([old,past,done,future]),after=f.fold([old,past,done,future,change]),d=tablesToData(after.tables);
 assert.equal(after.outcomes.at(-1).status,'적용');assert.deepEqual(after.tables['예약'],before.tables['예약']);
 assert.equal(scheduleAtDate(d.schedule,'2026-11-03').slots[0].start,'11:00');assert.equal(scheduleAtDate(d.schedule,'2026-11-04').slots[0].start,'11:00');assert.equal(scheduleAtDate(d.schedule,'2026-11-05').slots[0].start,'13:30');
 const r=f.fold([old,change,f.book('2026-11-06'),f.book('2026-11-06','13:30','15:30')]);assert.equal(r.outcomes.at(-2).status,'거절');assert.equal(r.outcomes.at(-1).status,'적용');
});
test('여러 적용일과 휴무 저장 후에도 날짜별 시간표 이력이 유지된다',()=>{
 const f=fixture(),a=event('saveSchedule',{version:1,slots:weekSlots('11:00','13:00')}),b=event('saveSchedule',{version:2,effectiveFrom:'2026-11-05',slots:weekSlots('13:30','15:30')}),c=event('saveSchedule',{version:3,effectiveFrom:'2026-11-10',slots:weekSlots('16:00','18:00')});
 const r=f.fold([a,b,c,event('saveClosures',{version:1,weekdays:[0],ranges:[]})]),s=tablesToData(r.tables).schedule;
 assert.equal(s.history.length,3);assert.equal(scheduleAtDate(s,'2026-11-04').slots[0].start,'11:00');assert.equal(scheduleAtDate(s,'2026-11-09').slots[0].start,'13:30');assert.equal(scheduleAtDate(s,'2026-11-10').slots[0].start,'16:00');
 assert.deepEqual(replay(r.tables,[]).tables,r.tables);
});
test('오늘·과거 적용일과 이전 버전 클라이언트의 시간표 덮어쓰기를 막는다',()=>{
 const f=fixture(),slots=weekSlots('11:00','13:00');
 for(const effectiveFrom of ['2026-11-03','2026-11-04']){const r=f.fold([event('saveSchedule',{version:1,effectiveFrom,slots})]);assert.equal(r.outcomes.at(-1).status,'거절');assert.match(r.outcomes.at(-1).error,/내일 이후/);}
 const r=f.fold([event('saveSchedule',{version:1,effectiveFrom:'2026-11-05',slots}),event('saveSchedule',{version:2,slots:[]})]);assert.equal(r.outcomes.at(-1).status,'거절');assert.equal(scheduleAtDate(tablesToData(r.tables).schedule,'2026-11-04').slots.length,0);
});

// Pure validation and deterministic ordered replay. No credentials or remote state.
const TABLES_ = {
  '수강생': ['수강생ID','이름','연락처','최초등록일','메모','재원상태','이관전누적수강횟수','이관전누적납부금액','수정버전','수정일시','기록자'],
  '수강권납부': ['거래ID','수강생ID','수강생이름','거래일','종류','충전횟수','납부금액','메모','기록일시','기록자'],
  '예약': ['예약ID','예약일','시간','수강생ID','수강생이름','수강권거래ID','수강권종류','상태','메모','수정버전','수정일시','기록자','종료시간'],
  '휴무설정': ['규칙ID','구분','요일','시작일','종료일','사유','수정버전']
};
const NUMERIC_={'수강생':[6,7,8],'수강권납부':[5,6],'예약':[9],'휴무설정':[6]};
const SUMMARY_HEADERS_=['수강생ID','이름','연락처','최초등록일','등록기간','재원상태','총충전횟수','차감횟수','현재잔여횟수','누적수강완료','누적납부금액'];


export function applyOperation(tables, event) {
  const edits=[];
  const user={email:event.actor,name:event.actor.split('@')[0],role:'admin'};
  const Utilities={formatDate:(_,__,format)=>format==='yyyy-MM-dd'?event.at.slice(0,10):event.at};
  function identity_(){return user;}
  function workspace_(){return {id:'current'};}
  function accessError_(message){return new Error(message);}
  function rows_(name){return tables[name].slice(1).map(r=>r.map(v=>String(v??'')));}
  function lastRow_(name){return tables[name].length;}
  function setRows_(name,start,rows){edits.push({name,start,rows});}
  function write_(name,start,row){setRows_(name,start,[row]);}
  function append_(name,row){write_(name,lastRow_(name)+1,row);}
  function summaryRow_(){}
function admin_(u){if(!u||u.email!==identity_().email)throw accessError_('로그인 계정을 확인하세요.');workspace_();}
function text_(v,max,required){
  if(typeof v!=='string') throw new Error('입력 형식을 확인하세요.');
  const s=v.trim(); if((required&&!s)||s.length>max) throw new Error('필수 내용과 입력 길이를 확인하세요. (최대 '+max+'자)'); return s;
}
function int_(v,min,max){if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>max) throw new Error('금액 또는 횟수 범위를 확인하세요.');return v;}
function date_(v){
  if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('날짜를 확인하세요.');
  const d=new Date(v+'T00:00:00Z'); if(isNaN(d.getTime())||d.toISOString().slice(0,10)!==v) throw new Error('실제 존재하는 날짜를 입력하세요.'); return v;
}
function time_(v){if(typeof v!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(v))throw new Error('시간을 확인하세요.');return v;}
function id_(v){if(typeof v!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v))throw new Error('요청 ID를 확인하세요.');return v;}
function now_(){return Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd HH:mm:ss');}
function student_(r){return {id:r[0],name:r[1],phone:r[2],since:r[3],note:r[4],active:r[5]==='재원',priorCount:Number(r[6]),priorPaid:Number(r[7]),version:Number(r[8])};}
function transaction_(r){return {id:r[0],studentId:r[1],studentName:r[2],date:r[3],kind:r[4],credits:Number(r[5]),amount:Number(r[6]),note:r[7],at:r[8],author:r[9]};}
function minutes_(v){const t=v.split(':').map(Number);return t[0]*60+t[1];}
function clock_(n){return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');}
function endTime_(r){return r[12]||clock_(Math.min(1440,minutes_(r[2])+(r[6]==='1일클래스'?60:120)));}
function booking_(r){return {id:r[0],date:r[1],time:r[2],endTime:endTime_(r),legacyTime:!r[12],studentId:r[3],studentName:r[4],passId:r[5],kind:r[6],status:r[7],note:r[8],version:Number(r[9]),at:r[10],author:r[11]};}
function saveStudent_(u,d){
  admin_(u);
  const name=text_(d.name,60,true),phone=text_(d.phone,40,false),since=date_(d.since),note=text_(d.note,1500,false);
  const priorCount=int_(d.priorCount,0,1000000),priorPaid=int_(d.priorPaid,0,1000000000000);
  if(typeof d.active!=='boolean')throw new Error('재원 상태를 확인하세요.');
  const all=rows_('수강생'),id=id_(d.id),idx=all.findIndex(r=>r[0]===id);
  if(idx<0&&d.version!==0)throw new Error('수강생을 찾을 수 없습니다.');
  if(idx>=0&&Number(all[idx][8])!==d.version)throw new Error('다른 사용자가 수정했습니다. 새로고침 후 다시 수정하세요.');
  const v=[id,name,phone,since,note,d.active?'재원':'퇴원',priorCount,priorPaid,idx>=0?Number(all[idx][8])+1:1,now_(),u.name];
  const targetRow=idx>=0?idx+2:lastRow_('수강생')+1;
  write_('수강생',targetRow,v);
  const result=student_(v.map(String));
  try{summaryRow_(targetRow);}catch(e){result.warning='수강생 정보는 저장했습니다. 원본 수강현황 탭 갱신에 실패해 소유자의 확인이 필요합니다.';}
  return result;
}
function addTransaction_(u,d){
  admin_(u);
  const id=id_(d.id),date=date_(d.date),kind=text_(d.kind,20,true),note=text_(d.note,1000,false),amount=int_(d.amount,0,1000000000000);
  if(!['정규권','1일클래스','추가납부'].includes(kind))throw new Error('수강권 종류를 확인하세요.');
  const credits=int_(d.credits,0,10000);
  if((kind==='1일클래스'&&credits!==1)||(kind==='추가납부'&&credits!==0)||(kind==='정규권'&&credits<1))throw new Error('정규권은 1회 이상, 1일클래스는 1회, 추가납부는 0회입니다.');
  const student=rows_('수강생').find(r=>r[0]===d.studentId);if(!student)throw new Error('수강생을 찾을 수 없습니다.');
  const old=rows_('수강권납부').find(r=>r[0]===id);
  if(old){if(old[1]!==d.studentId||old[3]!==date||old[4]!==kind||Number(old[5])!==credits||Number(old[6])!==amount||old[7]!==note)throw new Error('이미 사용된 거래 ID입니다.');return transaction_(old);}
  const row=[id,student[0],student[1],date,kind,credits,amount,note,now_(),u.name];append_('수강권납부',row);return transaction_(row.map(String));
}
function book_(u,d){
  const id=id_(d.id),date=date_(d.date),time=time_(d.time),note=text_(d.note,1000,false);
  const all=rows_('예약'),old=all.find(r=>r[0]===id);
  if(old){if(old[1]!==date||old[2]!==time||old[3]!==d.studentId||old[5]!==d.passId||old[8]!==note||(d.endTime&&endTime_(old)!==d.endTime))throw new Error('이미 사용된 예약 ID입니다.');return booking_(old);}
  const s=rows_('수강생').find(r=>r[0]===d.studentId);if(!s||s[5]!=='재원')throw new Error('재원 수강생만 예약할 수 있습니다.');
  const closed=closed_(date,closures_());if(closed)throw new Error('휴무일은 예약할 수 없습니다: '+closed);
  const pass=rows_('수강권납부').find(r=>r[0]===d.passId&&r[1]===d.studentId&&Number(r[5])>0);
  if(!pass)throw new Error('사용할 수강권을 선택하세요.');
  if(date<pass[3])throw new Error('수강권 거래일 이전에는 예약할 수 없습니다.');
  const used=all.filter(r=>r[5]===pass[0]&&r[7]!=='취소').length;
  if(used>=Number(pass[5]))throw new Error('잔여 횟수가 없습니다. 새로고침 후 수강권을 확인하세요.');
  const end=d.endTime===undefined?clock_(Math.min(1440,minutes_(time)+(pass[4]==='1일클래스'?60:120))):endClock_(d.endTime);
  if(minutes_(time)%30||minutes_(end)%30||minutes_(end)<=minutes_(time))throw new Error('시작·종료를 30분 단위로 선택하세요. 종료는 시작 이후여야 합니다.');
  const schedule=schedule_(),day=new Date(date+'T00:00:00Z').getUTCDay(),slots=schedule.slots.filter(t=>t.day===day);
  if(schedule.slots.length&&!slots.some(t=>pass[4]==='1일클래스'?time>=t.start&&end<=t.end:time===t.start&&end===t.end))throw new Error('해당 요일의 수업 타임을 선택하세요. 1일 클래스는 한 타임 안에서 30분 단위로 예약할 수 있습니다.');
  if(all.some(r=>r[1]===date&&r[3]===s[0]&&r[7]!=='취소'&&minutes_(r[2])<minutes_(end)&&minutes_(endTime_(r))>minutes_(time)))throw new Error('같은 수강생의 시간이 겹치는 예약이 이미 있습니다.');
  const row=[id,date,time,s[0],s[1],pass[0],pass[4],'예약',note,1,now_(),u.name,end];append_('예약',row);return booking_(row.map(String));
}
function changeBooking_(u,d){
  const all=rows_('예약'),idx=all.findIndex(r=>r[0]===d.id);if(idx<0)throw new Error('예약을 찾을 수 없습니다.');
  const row=all[idx],status=text_(d.status,20,true);
  if(!['예약','수강완료','취소'].includes(status))throw new Error('예약 상태를 확인하세요.');
  if(Number(row[9])!==d.version)throw new Error('다른 사용자가 예약을 변경했습니다. 새로고침 후 다시 시도하세요.');
  if(row[7]==='취소')throw new Error('취소한 예약은 복구하지 않습니다. 새 예약을 등록하세요.');
  if(row[7]===status)return booking_(row);
  if(status==='수강완료'&&row[1]>Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd'))throw new Error('미래 예약은 수강완료로 표시할 수 없습니다.');
  // 상태만 바꾸므로 완료는 추가 차감이 없고 취소하면 자동으로 잔여가 복구됩니다.
  row[7]=status;row[9]=String(Number(row[9])+1);row[10]=now_();row[11]=u.name;write_('예약',idx+2,row);return booking_(row);
}
const WEEKDAYS_=['일요일','월요일','화요일','수요일','목요일','금요일','토요일'];
function closures_(){
  const rows=rows_('휴무설정'),versionRow=rows.find(r=>r[0]==='설정');
  if(!versionRow)throw new Error('휴무설정의 버전 행이 없습니다. 원본 시트를 확인하세요.');
  return {version:Number(versionRow[6]),weekdays:rows.filter(r=>r[1]==='매주').map(r=>WEEKDAYS_.indexOf(r[2])),
    ranges:rows.filter(r=>r[1]==='기간').map(r=>({id:r[0],start:r[3],end:r[4],reason:r[5]}))};
}
function closed_(date,settings){
  const match=settings.ranges.find(r=>date>=r.start&&date<=r.end);if(match)return match.reason||'임시 휴무';
  const day=new Date(date+'T00:00:00Z').getUTCDay();return settings.weekdays.includes(day)?WEEKDAYS_[day]+' 정기 휴무':'';
}
function saveClosures_(u,d){
  admin_(u);const current=closures_();if(d.version!==current.version)throw new Error('다른 사용자가 휴무 설정을 바꿨습니다. 새로고침하세요.');
  if(!Array.isArray(d.weekdays)||d.weekdays.length>7||!Array.isArray(d.ranges)||d.ranges.length>100)throw new Error('휴무 설정 형식을 확인하세요.');
  const weekdays=[...new Set(d.weekdays.map(v=>int_(v,0,6)))];
  const ranges=d.ranges.map(r=>({id:id_(r.id),start:date_(r.start),end:date_(r.end),reason:text_(r.reason,80,false)}));
  if(ranges.some(r=>r.start>r.end))throw new Error('휴무 종료일은 시작일보다 빠를 수 없습니다.');
  if(new Set(ranges.map(r=>r.id)).size!==ranges.length)throw new Error('중복된 휴무 규칙 ID입니다.');
  const next={version:current.version+1,weekdays,ranges},today=Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd');
  const conflicts=rows_('예약').filter(r=>r[1]>=today&&r[7]!=='취소'&&closed_(r[1],next));
  if(conflicts.length)throw new Error('휴무일에 기존 예약 '+conflicts.length+'건이 있습니다 ('+conflicts.slice(0,3).map(r=>r[1]+' '+r[4]).join(', ')+'). 먼저 취소하거나 다른 날짜로 다시 예약하세요.');
  const rows=[['설정','버전','','','','',next.version]];
  weekdays.forEach(day=>rows.push(['weekday-'+day,'매주',WEEKDAYS_[day],'','','정기 휴무',next.version]));
  ranges.forEach(r=>rows.push([r.id,'기간','',r.start,r.end,r.reason,next.version]));
  rows.push(...rows_('휴무설정').filter(r=>r[0]&&(r[1]==='수업시간'||r[0]==='시간설정')));
  const length=Math.max(rows.length,lastRow_('휴무설정')-1);
  while(rows.length<length)rows.push(Array(TABLES_['휴무설정'].length).fill(''));
  setRows_('휴무설정',2,rows);
  return next;
}

function endClock_(v){return v==='24:00'?v:time_(v);}
function schedule_(){const r=rows_('휴무설정');return {version:Number(r.find(x=>x[0]==='시간설정')?.[6]||1),slots:r.filter(x=>x[1]==='수업시간').map(x=>({id:x[0],day:WEEKDAYS_.indexOf(x[2]),start:x[3],end:x[4]})).sort((a,b)=>a.day-b.day||a.start.localeCompare(b.start))};}
function saveSchedule_(u,d){
  admin_(u);const current=schedule_();if(d.version!==current.version)throw new Error('다른 사용자가 수업 시간을 바꿨습니다. 새로고침하세요.');
  if(!Array.isArray(d.slots)||d.slots.length>168)throw new Error('수업 시간은 전체 168개까지 등록할 수 있습니다.');
  const slots=d.slots.map(s=>({id:id_(s.id),day:int_(s.day,0,6),start:time_(s.start),end:endClock_(s.end)}));
  if(new Set(slots.map(s=>s.id)).size!==slots.length)throw new Error('중복된 수업 시간 ID입니다.');
  slots.sort((a,b)=>a.day-b.day||a.start.localeCompare(b.start));
  slots.forEach((s,i)=>{if(minutes_(s.start)%30||minutes_(s.end)%30||s.start>=s.end)throw new Error('수업 시작·종료는 30분 단위이며 종료는 시작 이후여야 합니다.');const prev=slots[i-1];if(prev&&prev.day===s.day&&prev.end>s.start)throw new Error(WEEKDAYS_[s.day]+' 수업 시간이 겹칩니다.');});
  const version=current.version+1,rows=rows_('휴무설정').filter(r=>r[0]&&r[0]!=='시간설정'&&r[1]!=='수업시간');
  rows.push(['시간설정','시간버전','','','','',version]);slots.forEach(s=>rows.push([s.id,'수업시간',WEEKDAYS_[s.day],s.start,s.end,'',version]));
  const length=Math.max(rows.length,lastRow_('휴무설정')-1);while(rows.length<length)rows.push(Array(7).fill(''));setRows_('휴무설정',2,rows);
  return {version,slots};
}

  const handlers={saveStudent:saveStudent_,addTransaction:addTransaction_,book:book_,changeBooking:changeBooking_,saveClosures:saveClosures_,saveSchedule:saveSchedule_};
  if(!handlers[event.action])throw new Error('지원하지 않는 작업입니다.');
  const result=handlers[event.action](user,event.data);
  for(const edit of edits)edit.rows.forEach((row,i)=>tables[edit.name][edit.start+i-1]=Array.from({length:TABLES_[edit.name].length},(_,j)=>row[j]??''));
  const target=edits[0]?.name||({saveStudent:'수강생',addTransaction:'수강권납부',book:'예약',changeBooking:'예약',saveClosures:'휴무설정',saveSchedule:'휴무설정'}[event.action]);
  let record=[];
  if(target!=='휴무설정')record=tables[target].find(r=>r[0]===result.id)||[];
  else if(event.action==='saveSchedule')record=['수업시간','설정 변경','','','',''+result.slots.map(s=>WEEKDAYS_[s.day]+' '+s.start+'–'+s.end).join(' / '),result.version];
  else record=['휴무','설정 변경',result.weekdays.map(d=>WEEKDAYS_[d]).join(', '),'','',result.ranges.map(r=>r.start+'–'+r.end+' '+r.reason).join(' / '),result.version];
  return {result,target,record};
}
export const TABLES=TABLES_;
export const SUMMARY_HEADERS=SUMMARY_HEADERS_;
export function emptyTables(){return Object.fromEntries(Object.entries(TABLES).map(([name,header])=>[name,[header.slice(),...(name==='휴무설정'?[['설정','버전','','','','',1]]:[])]]));}
export function replay(base, events){
 const tables=structuredClone(base),outcomes=[],seen=new Map();
 for(const event of events){
  const fingerprint=JSON.stringify({action:event.action,data:event.data,actor:event.actor});
  if(seen.has(event.id)){const first=seen.get(event.id);outcomes.push({id:event.id,status:'중복',result:first.fingerprint===fingerprint?first.outcome.result:null,error:first.fingerprint===fingerprint?'동일 요청 재전송':'중복 ID의 내용이 다릅니다.'});continue;}
  let outcome;
  try{const applied=applyOperation(tables,event);outcome={id:event.id,status:'적용',...applied};}
  catch(e){outcome={id:event.id,status:'거절',error:e.message};}
  seen.set(event.id,{fingerprint,outcome});outcomes.push(outcome);
 }
 return {tables,outcomes};
}
export function tablesToData(tables){
 const rows=n=>tables[n].slice(1).filter(r=>r[0]),r=rows('휴무설정'),v=r.find(x=>x[0]==='설정');
 const dateEnd=b=>{if(b[12])return b[12];const end=Math.min(1440,Number(b[2].slice(0,2))*60+Number(b[2].slice(3))+(b[6]==='1일클래스'?60:120));return String(Math.floor(end/60)).padStart(2,'0')+':'+String(end%60).padStart(2,'0');};
 return {students:rows('수강생').map(r=>({id:r[0],name:r[1],phone:r[2],since:r[3],note:r[4],active:r[5]==='재원',priorCount:Number(r[6]),priorPaid:Number(r[7]),version:Number(r[8])})),transactions:rows('수강권납부').map(r=>({id:r[0],studentId:r[1],studentName:r[2],date:r[3],kind:r[4],credits:Number(r[5]),amount:Number(r[6]),note:r[7],at:r[8],author:r[9]})),bookings:rows('예약').map(r=>({id:r[0],date:r[1],time:r[2],endTime:dateEnd(r),legacyTime:!r[12],studentId:r[3],studentName:r[4],passId:r[5],kind:r[6],status:r[7],note:r[8],version:Number(r[9]),at:r[10],author:r[11]})),closures:{version:Number(v?.[6]||1),weekdays:r.filter(x=>x[1]==='매주').map(x=>WEEKDAYS_[x[2]]),ranges:r.filter(x=>x[1]==='기간').map(x=>({id:x[0],start:x[3],end:x[4],reason:x[5]}))},schedule:{version:Number(r.find(x=>x[0]==='시간설정')?.[6]||1),slots:r.filter(x=>x[1]==='수업시간').map(x=>({id:x[0],day:WEEKDAYS_[x[2]],start:x[3],end:x[4]}))}};
}
const WEEKDAYS_=Object.fromEntries(['일요일','월요일','화요일','수요일','목요일','금요일','토요일'].map((v,i)=>[v,i]));

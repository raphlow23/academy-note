import {TABLES,tablesToData,replay} from './domain.js?v=20261104-closure1';

export const INPUT_NAMES=['수강생','수강권납부','예약'];
export const INPUT_TITLE=name=>'입력_'+name;
export const INPUT_EXTRA=['반영상태','반영메시지','반영확인값'];
export const inputHeaders=name=>[...TABLES[name],...INPUT_EXTRA];
const text=v=>String(v??'').trim();
export async function fingerprint(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(n=>n.toString(16).padStart(2,'0')).join('');}
const rowValues=(row,width)=>Array.from({length:width},(_,i)=>text(row[i]));
export const inputHash=(row,width)=>fingerprint(rowValues(row,width));
async function recordId(workspace,title,row){const h=await fingerprint([workspace,title,row]);return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32);}
function date(v){if(typeof v==='number'&&v>1)return new Date(Date.UTC(1899,11,30)+Math.floor(v)*86400000).toISOString().slice(0,10);const s=text(v);const m=s.match(/^(\d{4})[.\/-]\s*(\d{1,2})[.\/-]\s*(\d{1,2})\.?$/);return m?`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`:s;}
function time(v){if(typeof v==='number'&&v>=0&&v<=1){const n=Math.round(v*1440);return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');}const m=text(v).match(/^(\d{1,2}):(\d{2})(?::00)?$/);return m?m[1].padStart(2,'0')+':'+m[2]:text(v);}
function number(v,required=false){if(text(v)===''&&required)throw Error('횟수·금액을 입력하세요. 0원도 숫자 0으로 적어주세요.');const s=text(v).replaceAll(',','');if(!/^\d+$/.test(s||'0'))throw Error('금액·횟수는 0 이상의 정수로 입력하세요.');return Number(s||0);}
function student(data,id,name){const matches=data.students.filter(s=>id?s.id===id:s.name===name);if(matches.length!==1)throw Error(matches.length?'동명이인입니다. 수강생ID를 함께 입력하세요.':'수강생을 찾을 수 없습니다. 입력_수강생에서 먼저 등록하세요.');return matches[0];}
const fieldsEqual=(a,b,keys)=>keys.every(k=>a[k]===b[k]);

// Plan append-only commands. Existing records and event ordering remain intact.
// A receipt is not trusted for data; every command is validated by domain replay.
export async function planSheetInputs(snapshot,groups,actor,at,workspace){
 let tables=snapshot.tables;const events=[],receipts=[];
 for(const name of INPUT_NAMES){
  const rows=groups[name]||[],width=TABLES[name].length;
  if(JSON.stringify(rows[0])!==JSON.stringify(inputHeaders(name)))throw Error(INPUT_TITLE(name)+' 머리글이 다릅니다. 머리글을 원래대로 복구하세요.');
  for(let i=1;i<rows.length;i++){
   const original=rows[i],r=rowValues(original,width);if(!r.some(Boolean))continue;
   const hash=await inputHash(original,width);if(original[width]==='반영 완료'&&original[width+2]===hash)continue;
   const receipt={name,row:i+1,hash,values:r.slice(),status:'반영 완료',message:'앱과 원본 표에 반영했습니다.'};receipts.push(receipt);
   const eventId='sheet-input:'+await fingerprint([workspace,name,i+1,hash]);receipt.eventId=eventId;
   const previous=snapshot.events.findIndex(e=>e.id===eventId);
   if(previous>=0){const outcome=snapshot.outcomes[previous];if(outcome.status==='거절'){receipt.status='확인 필요';receipt.message=outcome.error;}else if(outcome.record?.length){receipt.values=outcome.record.map(String);}else if(outcome.result){receipt.values[0]=outcome.result.id;if(name==='수강생')receipt.values[8]=String(outcome.result.version);if(name==='예약')receipt.values[9]=String(outcome.result.version);}continue;}
   try{
    const data=tablesToData(tables),id=r[0]||await recordId(workspace,name,i+1);let action,payload;
    if(name==='수강생'){
     if(r[5]&&!['재원','퇴원'].includes(r[5]))throw Error('재원상태는 재원 또는 퇴원으로 입력하세요.');
     payload={id,name:r[1],phone:r[2],since:date(original[3]),note:r[4],active:r[5]!=='퇴원',priorCount:number(r[6]),priorPaid:number(r[7]),version:number(r[8])};
     const old=data.students.find(s=>s.id===id);action='saveStudent';
     if(old&&fieldsEqual(old,payload,['name','phone','since','note','active','priorCount','priorPaid'])){receipt.values[0]=id;receipt.values[8]=String(old.version);continue;}
    }else if(name==='수강권납부'){
     const s=student(data,r[1],r[2]);action='addTransaction';payload={id,studentId:s.id,date:date(original[3]),kind:r[4]||'정규권',credits:number(r[5],true),amount:number(r[6],true),note:r[7]};receipt.values[1]=s.id;receipt.values[2]=s.name;
    }else{
     const s=student(data,r[3],r[4]),old=data.bookings.find(b=>b.id===id),status=r[7]||'예약';receipt.values[3]=s.id;receipt.values[4]=s.name;
     if(old){
      if(!fieldsEqual(old,{date:date(original[1]),time:time(original[2]),studentId:s.id,passId:r[5]||old.passId,endTime:time(original[12])||old.endTime,note:r[8]},['date','time','studentId','passId','endTime','note']))throw Error('기존 예약의 날짜·시간을 바꾸려면 기존 예약을 취소하고 새 행에 예약하세요.');
      if(!['예약','수강완료','취소'].includes(status))throw Error('상태는 예약·수강완료·취소 중 하나로 입력하세요.');
      if(old.status===status){receipt.values[0]=id;receipt.values[9]=String(old.version);continue;}
      action='changeBooking';payload={id,version:number(r[9],true),status};
     }else{
      if(status!=='예약'&&status!=='수강완료')throw Error('새 예약은 예약 또는 시작 시간이 지난 수강완료로 입력하세요.');
      const day=date(original[1]),start=time(original[2]),end=time(original[12]);
      if(status==='수강완료'&&`${day} ${start}`>at.slice(0,16))throw Error('아직 시작하지 않은 수업은 수강완료로 입력할 수 없습니다.');
      const passes=data.transactions.filter(p=>p.studentId===s.id&&p.credits>0&&(!r[5]||p.id===r[5])&&(!r[6]||p.kind===r[6])&&p.date<=day&&p.credits>data.bookings.filter(b=>b.passId===p.id&&b.status!=='취소').length);
      if(passes.length!==1)throw Error(passes.length?'사용 가능한 수강권이 여러 개입니다. 수강권거래ID를 적어주세요.':'사용 가능한 잔여 수강권이 없습니다.');
      action='book';payload={id,studentId:s.id,passId:passes[0].id,date:day,time:start,endTime:end,note:r[8]};receipt.values[5]=passes[0].id;receipt.values[6]=passes[0].kind;receipt.values[7]='예약';
     }
    }
    const event={id:eventId,action,data:payload,actor,at},checked=replay(tables,[event]),outcome=checked.outcomes[0];
    if(outcome.status==='거절')throw Error(outcome.error);
    tables=checked.tables;events.push(event);receipt.values[0]=outcome.result.id;
    if(name==='수강생')receipt.values[8]=String(outcome.result.version);
    if(name==='예약')receipt.values[9]=String(outcome.result.version);
   }catch(e){receipt.status='확인 필요';receipt.message=e.message;}
  }
 }
 return {events,receipts,tables};
}

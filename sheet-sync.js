import {TABLES} from './domain.js?v=20261104-closure1';
import {range,LOG} from './workbook.js?v=20261104-closure1';
import {INPUT_NAMES,INPUT_TITLE,inputHeaders,inputHash,planSheetInputs} from './sheet-input.js?v=20261106-sheets1';
const API='https://sheets.googleapis.com/v4/spreadsheets/';
const guide=[['구글 시트 직접 입력','이 파일의 입력_수강생 → 입력_수강권납부 → 입력_예약 탭에 한 행씩 작성하세요.'],['반영 시점','Google 시트는 입력을 자동 저장합니다. 수봉화실을 열거나 새로고침하면 입력을 검증해 앱과 원본 표에 반영합니다.'],['기존 기록','수강생·수강권납부·예약·수강현황은 전체 기록 조회용입니다. 조회용 표의 수식이나 작업기록·이관_ 탭을 직접 바꾸지 마세요.'],['수강생','이름·최초등록일(YYYY-MM-DD)을 입력하세요. 재원상태는 재원/퇴원입니다. 새 수강생ID는 비워두면 자동 발급합니다. 연락처는 0을 포함해 적으세요.'],['납부','수강생이름·거래일·종류(정규권/1일클래스/추가납부)·충전횟수·납부금액을 입력하세요. 0원도 숫자 0을 적습니다. 동명이인은 수강생ID를 지정합니다.'],['예약','예약일·시간·종료시간(HH:mm)·수강생이름을 적습니다. 수강권이 하나면 자동 선택하고 여러 개면 수강권거래ID를 지정합니다.'],['수정','수강생을 수정하려면 조회용 행을 입력_수강생에 복사하고 수정버전을 유지하세요. 납부는 새 거래만 추가합니다.'],['예약 취소','조회용 예약 행을 입력_예약에 복사하고 상태를 취소로 바꾸면 반영 시 1회가 복구됩니다. 날짜·시간 변경은 기존 예약 취소 후 새 행에 등록합니다.'],['반영상태','반영 완료/확인 필요를 확인하세요. 오류 행은 메시지를 보고 고치면 다음 앱 접속 때 다시 검증합니다. 완료된 입력 행은 기록으로 남겨두세요.'],['백업','파일 → 다운로드 → Microsoft Excel(.xlsx)로 전체 탭과 작업 이력을 함께 내려받을 수 있습니다.'],['보호','ID·수정버전·반영확인값·머리글은 임의로 변경하지 마세요. 반영 중에는 입력 행을 정렬·이동하지 마세요.']];
export async function ensureInputSheets(store,id){
 store.inputSheetReady??=new Set();if(store.inputSheetReady.has(id))return;
 const meta=await store.http(API+id+'?fields=sheets(properties(sheetId,title))'),sheets=meta.sheets||[],titles=new Set(sheets.map(s=>s.properties.title));
 let next=Math.max(0,...sheets.map(s=>s.properties.sheetId))+1;const requests=[];
 for(const title of [...INPUT_NAMES.map(INPUT_TITLE),'시트입력안내']){
  if(titles.has(title))continue;const sheetId=next++,name=INPUT_NAMES.find(n=>INPUT_TITLE(n)===title),rows=name?[inputHeaders(name)]:guide;
  requests.push({addSheet:{properties:{sheetId,title,gridProperties:{rowCount:1000,columnCount:22,frozenRowCount:1}}}});
  if(name)requests.push({repeatCell:{range:{sheetId},cell:{userEnteredFormat:{numberFormat:{type:'TEXT'}}},fields:'userEnteredFormat.numberFormat'}});
  requests.push({updateCells:{start:{sheetId,rowIndex:0,columnIndex:0},rows:rows.map(row=>({values:row.map(v=>({userEnteredValue:{stringValue:v}}))})),fields:'userEnteredValue'}});
  requests.push({repeatCell:{range:{sheetId,startRowIndex:0,endRowIndex:1},cell:{userEnteredFormat:{backgroundColor:{red:.86,green:.91,blue:1},textFormat:{bold:true}}},fields:'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat'}});
 }
 if(requests.length){try{await store.http(API+id+':batchUpdate',{method:'POST',body:{requests}});}catch(e){if(e.status!==400)throw e;const check=await store.http(API+id+'?fields=sheets(properties(title))');if(![...INPUT_NAMES.map(INPUT_TITLE),'시트입력안내'].every(t=>check.sheets?.some(s=>s.properties.title===t)))throw e;}}
 store.inputSheetReady.add(id);
}
async function readInputs(store,id){const p=new URLSearchParams();INPUT_NAMES.forEach(n=>p.append('ranges',range(INPUT_TITLE(n))));p.set('valueRenderOption','UNFORMATTED_VALUE');const result=await store.http(API+id+'/values:batchGet?'+p);return Object.fromEntries(INPUT_NAMES.map((n,i)=>[n,result.valueRanges?.[i]?.values||[]]));}
export async function syncSheetInputs(store,id){
 if(store.authPreview)throw Error('읽기 전용 화면에서는 시트 입력을 반영하지 않습니다.');
 const sub=store.user?.sub,epoch=store.epoch;await ensureInputSheets(store,id);const groups=await readInputs(store,id);
 let pending=false;
 for(const name of INPUT_NAMES){const rows=groups[name],w=TABLES[name].length;if(JSON.stringify(rows[0])!==JSON.stringify(inputHeaders(name)))throw Error(INPUT_TITLE(name)+' 머리글을 원래대로 복구하세요.');for(const row of rows.slice(1))if(row.slice(0,w).some(v=>String(v??'').trim())&&(row[w]!=='반영 완료'||row[w+2]!==await inputHash(row,w))){pending=true;break;}}
 if(!pending)return {changed:false,errors:0};
 let snapshot=await store.snapshot(id);const at=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date());
 const plan=await planSheetInputs(snapshot,groups,store.user.email,at,id);
 if(epoch!==store.epoch||sub!==store.user?.sub)throw Error('계정이 변경되었습니다.');
 if(plan.events.length){await store.http(API+id+'/values/'+encodeURIComponent(range(LOG,'A:V'))+':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',{method:'POST',body:{values:plan.events.map(e=>[e.id,e.action,e.actor,e.at,JSON.stringify(e.data),'처리 대기','','','',...Array(13).fill('')])}});snapshot=await store.snapshot(id,snapshot.meta);await store.settle(id,snapshot);}
 // Check the user's row again before filling IDs or receipts; do not overwrite
 // a row that was edited while the network request was in flight.
 const current=await readInputs(store,id),data=[];let errors=0;
 for(const receipt of plan.receipts){const w=TABLES[receipt.name].length,row=current[receipt.name][receipt.row-1];if(!row||await inputHash(row,w)!==receipt.hash)continue;
  const outcome=snapshot.outcomes[snapshot.events.findIndex(e=>e.id===receipt.eventId)];
  const rejected=outcome?.status==='거절'?outcome:null;
  if(rejected){receipt.status='확인 필요';receipt.message=rejected.error;receipt.values=Array.from({length:w},(_,i)=>String(row[i]??'').trim());}
  if(receipt.status==='확인 필요')errors++;
  const system=receipt.status==='반영 완료'?(receipt.name==='수강생'?[0,8]:receipt.name==='수강권납부'?[0,1,2]:[0,3,4,5,6,7,9]):[];
  const final=row.slice(0,w);while(final.length<w)final.push('');
  for(const col of system){const value=receipt.values[col]??'';if(String(final[col]??'')===String(value))continue;if(col!==0&&col!==8&&col!==9&&String(final[col]??'').trim())continue;final[col]=value;data.push({range:range(INPUT_TITLE(receipt.name),String.fromCharCode(65+col)+receipt.row),values:[[value]]});}
  const values=[receipt.status,receipt.message,await inputHash(final,w)];if(JSON.stringify(Array.from({length:3},(_,j)=>row[w+j]??''))!==JSON.stringify(values))data.push({range:range(INPUT_TITLE(receipt.name),String.fromCharCode(65+w)+receipt.row+':'+String.fromCharCode(67+w)+receipt.row),values:[values]});
 }
 if(data.length)await store.http(API+id+'/values:batchUpdate',{method:'POST',body:{valueInputOption:'RAW',data}});
 return {changed:plan.events.length>0,errors};
}

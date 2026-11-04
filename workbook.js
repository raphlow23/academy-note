import {TABLES, SUMMARY_HEADERS, emptyTables, tablesToData} from './domain.js?v=20261104-closure1';

export const LOG='작업기록';
export const LOG_HEADERS=['작업ID','요청종류','기록계정','기록일시','요청데이터(JSON)','처리상태','처리메시지','대상표','대상ID',...Array.from({length:13},(_,i)=>'결과'+(i+1))];
export const BASE=n=>'이관_'+n;
const quote=n=>"'"+n.replaceAll("'","''")+"'";
export const range=(name,cells='')=>quote(name)+(cells?'!'+cells:'');

function currentView(name){
 const width=TABLES[name].length,end=String.fromCharCode(64+width),logEnd=String.fromCharCode(73+width);
 return `=IFERROR(LET(d,VSTACK(${range(name==='휴무설정'?'초기설정요약':BASE(name),'A2:'+end)},IFERROR(FILTER(${range(LOG,'J2:'+logEnd)},${range(LOG,'F2:F')}="적용",${range(LOG,'H2:H')}="${name}"),MAKEARRAY(1,${width},LAMBDA(r,c,"")))),f,FILTER(d,INDEX(d,,1)<>""),r,SORT(HSTACK(f,SEQUENCE(ROWS(f))),${width+1},FALSE),ids,UNIQUE(INDEX(f,,1)),ARRAYFORMULA(VLOOKUP(ids,r,SEQUENCE(1,${width}),FALSE))),"")`;
}

export function initialSettingsRows(base){const d=tablesToData(base),days=['일','월','화','수','목','금','토'],describe=slots=>slots.map(s=>days[s.day]+'요일 '+s.start+'–'+s.end).join(' / ');return [TABLES['휴무설정'],['휴무','설정 변경',d.closures.weekdays.map(n=>days[n]).join(', '),'','',d.closures.ranges.map(r=>r.start+'–'+r.end+' '+r.reason).join(' / '),d.closures.version],...(d.schedule.history.length?d.schedule.history.map(h=>['수업시간-'+h.version,'설정 변경','',h.effectiveFrom,'',describe(h.slots),h.version]):[['수업시간','설정 변경','','','',describe(d.schedule.slots),d.schedule.version]])];}

export function workbookResource(base=emptyTables()){
 const header=v=>({userEnteredValue:{stringValue:v},userEnteredFormat:{backgroundColor:{red:.07,green:.43,blue:.36},textFormat:{bold:true,foregroundColor:{red:1,green:1,blue:1}}}});
 const cell=v=>({userEnteredValue:typeof v==='number'?{numberValue:v}:{stringValue:String(v??'')}});
 const sheets=[];
 function add(name,rows,width,hidden=false,formula){
  sheets.push({properties:{sheetId:sheets.length,title:name,hidden,gridProperties:{rowCount:Math.max(1000,rows.length+20),columnCount:Math.max(width,22),frozenRowCount:1}},data:[{startRow:0,startColumn:0,rowData:rows.map((r,i)=>({values:r.map(v=>i===0?header(String(v)):cell(v))}))},...(formula?[{startRow:1,startColumn:0,rowData:[{values:[{userEnteredValue:{formulaValue:formula}}]}]}]:[])]});
 }
 add('사용안내',[
  ['수봉화실 · 내 구글 계정 소유','웹앱 없이도 이 파일을 직접 조회·출력·엑셀 다운로드할 수 있습니다.'],
  ['현재 자료','수강생·수강권납부·예약은 아래 작업기록의 적용된 결과를 수식으로 표시합니다.'],
  ['공유','기본 비공개. 소유자가 명시적으로 허용한 구글 계정만 함께 관리합니다.'],
  ['작업기록','추가된 순서가 기준입니다. 처리 대기인 작업은 다음 앱 연결 때 검증·반영됩니다.'],
  ['백업','파일 → 다운로드 → Microsoft Excel. 앱에서는 CSV·JSON·오프라인 열람본을 받을 수 있습니다.'],
  ['직접 수정','작업기록·조회용 표·숨겨진 이관 원본을 수정하거나 행을 정렬하지 마세요. 먼저 복사본을 만드세요.'],
  ['기존 자료','이관_ 탭은 연결한 기존 자료의 보존 사본입니다. 원래 파일은 수정하지 않습니다.'],
  ['횟수','예약 1건은 1회 차감. 취소는 복구, 수강완료는 추가 차감 없음. 금액 차감 없음.'],
  ['휴무설정','이 표는 설정 변경의 읽기 쉬운 요약입니다. 정확한 전체 설정은 작업기록의 JSON과 앱의 전체 백업에 포함됩니다.'],
  ['보존','앱이 중단돼도 이 시트와 직접 내려받은 백업은 남습니다. 파일·계정 삭제까지 보호되는 것은 아닙니다.'],
  ['미반영 작업 확인','처리 대기가 있으면 앱을 연결하거나 작업기록을 확인하세요.']
 ],2);
 add(LOG,[LOG_HEADERS],22);
 for(const name of Object.keys(TABLES))add(BASE(name),base[name],TABLES[name].length,true);
 add('초기설정요약',initialSettingsRows(base),7,true);
 for(const name of Object.keys(TABLES))add(name,[TABLES[name]],TABLES[name].length,false,currentView(name));
 add('수강현황',[SUMMARY_HEADERS],SUMMARY_HEADERS.length);
 return {properties:{title:'수봉화실 · 나의 수강생과 예약',locale:'ko_KR',timeZone:'Asia/Seoul'},sheets};
}

export function summaryRequests(sheetId){
 const source=col=>`=ARRAYFORMULA(IF('수강생'!A2:A="","",'수강생'!${col}2:${col}))`;
 const map=f=>`=MAP(A2:A,LAMBDA(id,IF(id="","",${f})))`;
 const formulas=[source('A'),source('B'),source('C'),source('D'),
  '=MAP(D2:D,LAMBDA(d,IF(d="","",IF(DATEVALUE(d)>TODAY(),"등록 예정",DATEDIF(DATEVALUE(d),TODAY(),"Y")&"년 "&MOD(DATEDIF(DATEVALUE(d),TODAY(),"M"),12)&"개월"))))',source('F'),
  map("SUMIF('수강권납부'!B2:B,id,'수강권납부'!F2:F)"),
  map("COUNTIFS('예약'!D2:D,id,'예약'!H2:H,\"<>취소\")"),
  '=ARRAYFORMULA(IF(A2:A="","",G2:G-H2:H))',
  map("SUMIF('수강생'!A2:A,id,'수강생'!G2:G)+COUNTIFS('예약'!D2:D,id,'예약'!H2:H,\"수강완료\")"),
  map("SUMIF('수강생'!A2:A,id,'수강생'!H2:H)+SUMIF('수강권납부'!B2:B,id,'수강권납부'!G2:G)")];
 return formulas.map((formula,i)=>({updateCells:{start:{sheetId,rowIndex:1,columnIndex:i},rows:[{values:[{userEnteredValue:{formulaValue:formula}}]}],fields:'userEnteredValue'}}));
}

export function parseBase(valueRanges){
 const base={};
 Object.entries(TABLES).forEach(([name,headers],i)=>{
  const rows=valueRanges[i]?.values||[];
  const legacy=name==='예약'&&JSON.stringify(rows[0])===JSON.stringify(headers.slice(0,12));
  if(!legacy&&JSON.stringify(rows[0])!==JSON.stringify(headers))throw new Error(name+' 머리글이 맞지 않습니다. 수봉화실에서 만든 원본 파일을 선택하세요.');
  base[name]=[headers.slice(),...rows.slice(1).filter(r=>r[0]).map(r=>Array.from({length:headers.length},(_,j)=>r[j]??''))];
 });
 return base;
}

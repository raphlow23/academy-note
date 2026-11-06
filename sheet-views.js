import {SUMMARY_HEADERS,tablesToData} from './domain.js?v=20261104-closure1';

function tenure(since,asOf){const a=new Date(since+'T00:00:00Z'),b=new Date(asOf+'T00:00:00Z');if(a>b)return '등록 예정';let m=(b.getUTCFullYear()-a.getUTCFullYear())*12+b.getUTCMonth()-a.getUTCMonth();if(b.getUTCDate()<a.getUTCDate())m--;m=Math.max(m,0);return m===0?'1개월 미만':`${Math.floor(m/12)?Math.floor(m/12)+'년 ':''}${m%12?m%12+'개월':''}`.trim();}
export function viewTables(tables,asOf){
 const data=tablesToData(tables),summary=[SUMMARY_HEADERS.slice()];
 for(const s of data.students){const passes=data.transactions.filter(t=>t.studentId===s.id),bookings=data.bookings.filter(b=>b.studentId===s.id),granted=passes.reduce((n,t)=>n+t.credits,0),used=bookings.filter(b=>b.status!=='취소').length;
  summary.push([s.id,s.name,s.phone,s.since,tenure(s.since,asOf),s.active?'재원':'퇴원',granted,used,granted-used,s.priorCount+bookings.filter(b=>b.status==='수강완료').length,s.priorPaid+passes.reduce((n,t)=>n+t.amount,0)]);
 }
 return {...structuredClone(tables),'수강현황':summary};
}
export function normalizeView(rows,width){const result=(rows||[]).map(r=>Array.from({length:width},(_,i)=>r[i]??''));while(result.length&&result.at(-1).every(v=>v===''))result.pop();return result;}
export function changedViews(tables,views,asOf){return Object.entries(viewTables(tables,asOf)).filter(([name,rows])=>JSON.stringify(normalizeView(views?.[name],rows[0].length))!==JSON.stringify(normalizeView(rows,rows[0].length)));}
export function viewWriteRequest(properties,rows){
 const width=rows[0].length;
 return {updateCells:{range:{sheetId:properties.sheetId,startRowIndex:0,endRowIndex:properties.gridProperties.rowCount,startColumnIndex:0,endColumnIndex:width},rows:rows.map(row=>({values:row.map(v=>({userEnteredValue:typeof v==='number'?{numberValue:v}:{stringValue:String(v??'')}}))})),fields:'userEnteredValue'}};
}

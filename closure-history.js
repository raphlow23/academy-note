import {BASELINE_DATE} from './schedule-history.js?v=20261104-history1';
const DAYS=['일요일','월요일','화요일','수요일','목요일','금요일','토요일'];
export function closureFromRows(rows){
 const history=rows.filter(r=>r[1]==='정기휴무이력').map(r=>{
  let weekdays;try{weekdays=JSON.parse(r[5]);}catch{throw new Error('정기 휴무 이력을 읽을 수 없습니다. 원본을 확인하세요.');}
  if(!Array.isArray(weekdays)||weekdays.some(d=>!Number.isInteger(d)||d<0||d>6)||!/^\d{4}-\d{2}-\d{2}$/.test(r[3]))throw new Error('정기 휴무 이력 형식을 확인하세요.');
  return {effectiveFrom:r[3],weekdays,version:Number(r[6])};
 }).sort((a,b)=>a.effectiveFrom.localeCompare(b.effectiveFrom)||a.version-b.version);
 return {version:Number(rows.find(r=>r[0]==='설정')?.[6]||1),weekdays:rows.filter(r=>r[1]==='매주').map(r=>DAYS.indexOf(r[2])),ranges:rows.filter(r=>r[1]==='기간').map(r=>({id:r[0],start:r[3],end:r[4],reason:r[5]})),history};
}
export function weeklyClosureAtDate(closures,date){
 return (closures?.history||[]).filter(h=>h.effectiveFrom<=date).sort((a,b)=>a.effectiveFrom.localeCompare(b.effectiveFrom)||a.version-b.version).at(-1)||{effectiveFrom:BASELINE_DATE,version:closures?.version||1,weekdays:closures?.weekdays||[]};
}
export function closureReason(date,closures){
 const match=(closures.ranges||[]).find(r=>date>=r.start&&date<=r.end);if(match)return match.reason||'임시 휴무';
 return weeklyClosureAtDate(closures,date).weekdays.includes(new Date(date+'T00:00:00Z').getUTCDay())?'정기 휴무':'';
}

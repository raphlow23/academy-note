const DAYS=['일요일','월요일','화요일','수요일','목요일','금요일','토요일'];
export const BASELINE_DATE='0001-01-01';
export function nextDate(date){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);}
export function scheduleFromRows(rows){
 const version=Number(rows.find(r=>r[0]==='시간설정')?.[6]||1);
 const slots=rows.filter(r=>r[1]==='수업시간').map(r=>({id:r[0],day:DAYS.indexOf(r[2]),start:r[3],end:r[4]}));
 const history=rows.filter(r=>r[1]==='시간표이력').map(r=>{
  let saved;try{saved=JSON.parse(r[5]);}catch{throw new Error('수업 시간 이력을 읽을 수 없습니다. 원본을 확인하세요.');}
  if(!Array.isArray(saved)||!/^\d{4}-\d{2}-\d{2}$/.test(r[3]))throw new Error('수업 시간 이력 형식을 확인하세요.');
  return {effectiveFrom:r[3],version:Number(r[6]),slots:saved};
 }).sort((a,b)=>a.effectiveFrom.localeCompare(b.effectiveFrom)||a.version-b.version);
 return {version,slots,history};
}
export function scheduleAtDate(schedule,date){
 const matched=(schedule?.history||[]).filter(h=>h.effectiveFrom<=date).sort((a,b)=>a.effectiveFrom.localeCompare(b.effectiveFrom)||a.version-b.version).at(-1);
 return matched||{effectiveFrom:BASELINE_DATE,version:schedule?.version||1,slots:schedule?.slots||[]};
}

/** Today's class is ready for rebooking. Only bookings after today count as future. */
export function orderedStudentGroups(students,bookings,today,query='',includeFormer=true){
 const future=new Set(bookings.filter(b=>b.status==='예약'&&b.date>today).map(b=>b.studentId));
 const matches=s=>!query||(s.name+' '+s.phone).toLocaleLowerCase('ko-KR').includes(query);
 const sort=(a,b)=>a.name.localeCompare(b.name,'ko')||a.id.localeCompare(b.id);
 return [
  {title:'재예약 대상 · 다음 예약 없음',students:students.filter(s=>s.active&&!future.has(s.id)&&matches(s)).sort(sort)},
  {title:'재원 · 다음 예약 있음',students:students.filter(s=>s.active&&future.has(s.id)&&matches(s)).sort(sort)},
  {title:'예전 수강생 · 기록 보관',students:includeFormer?students.filter(s=>!s.active&&matches(s)).sort(sort):[]}
 ].filter(g=>g.students.length);
}

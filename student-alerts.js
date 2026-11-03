export function studentCreditState(studentId,data){
 const passes=data.transactions.filter(t=>t.studentId===studentId);
 const granted=passes.reduce((n,t)=>n+Number(t.credits||0),0);
 const consumed=data.bookings.filter(b=>b.studentId===studentId&&b.status!=='취소');
 const remaining=granted-consumed.length;
 const exhausted=granted>0&&remaining<=0;
 const last=exhausted?consumed.slice().sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time)||a.id.localeCompare(b.id)).at(-1):null;
 return {remaining,exhausted,lastBookingId:last?.id||null};
}

export function isLastLesson(booking,data){return booking.status!=='취소'&&studentCreditState(booking.studentId,data).lastBookingId===booking.id;}

export function creditTone(studentId,data,booking){
 const state=studentCreditState(studentId,data);
 if(booking?.status==='취소')return 'credit-default';
 if(booking?isLastLesson(booking,data):state.exhausted)return 'credit-last';
 return state.remaining===1?'credit-one':'credit-default';
}

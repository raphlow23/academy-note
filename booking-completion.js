// Booking timestamps are Korean local time, independent of the device timezone.
export function bookingHasEnded(booking, now=Date.now()){
 const start=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(booking.time||'');
 if(!start||!/^\d{4}-\d{2}-\d{2}$/.test(booking.date||''))return false;
 const fallback=Math.min(1440,Number(start[1])*60+Number(start[2])+(booking.kind==='1일클래스'?60:120));
 const end=booking.endTime||String(Math.floor(fallback/60)).padStart(2,'0')+':'+String(fallback%60).padStart(2,'0');
 if(!/^(?:([01]\d|2[0-3]):[0-5]\d|24:00)$/.test(end))return false;
 const midnight=Date.parse(booking.date+'T00:00:00+09:00'),[h,m]=end.split(':').map(Number);
 return Number.isFinite(midnight)&&midnight+(h*60+m)*60000<=Number(now);
}
export const needsCompletion=(booking,now=Date.now())=>booking.status==='예약'&&bookingHasEnded(booking,now);

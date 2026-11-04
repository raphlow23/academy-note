// Booking timestamps are Korean local time, independent of the device timezone.
export function bookingHasStarted(booking, now=Date.now()){
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(booking.time||'')||!/^\d{4}-\d{2}-\d{2}$/.test(booking.date||''))return false;
 const start=Date.parse(booking.date+'T'+booking.time+':00+09:00');
 return Number.isFinite(start)&&start<=Number(now);
}
// Keep older cached modules loadable while the release updates.
export const bookingHasEnded=bookingHasStarted;
export const needsCompletion=(booking,now=Date.now())=>booking.status==='예약'&&bookingHasStarted(booking,now);

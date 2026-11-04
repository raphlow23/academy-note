import test from 'node:test';
import assert from 'node:assert/strict';
import {bookingHasEnded,needsCompletion} from '../booking-completion.js';
const b={date:'2026-11-04',time:'11:00',endTime:'13:00',kind:'정규권',status:'예약'};
test('한국시간 종료 직전에는 예약, 종료 시각부터 완료 대상으로 계산한다',()=>{
 assert.equal(needsCompletion(b,Date.parse('2026-11-04T03:59:59Z')),false);
 assert.equal(needsCompletion(b,Date.parse('2026-11-04T04:00:00Z')),true);
 assert.equal(needsCompletion({...b,status:'취소'},Date.parse('2026-11-05T00:00:00Z')),false);
 assert.equal(needsCompletion({...b,status:'수강완료'},Date.parse('2026-11-05T00:00:00Z')),false);
});
test('24시 종료와 1일클래스의 실제 종료시간을 사용하고 기존 종료 누락은 이전 규칙으로 추정한다',()=>{
 assert.equal(bookingHasEnded({...b,endTime:'24:00'},Date.parse('2026-11-04T14:59:59Z')),false);
 assert.equal(bookingHasEnded({...b,endTime:'24:00'},Date.parse('2026-11-04T15:00:00Z')),true);
 assert.equal(bookingHasEnded({...b,kind:'1일클래스',endTime:'11:30'},Date.parse('2026-11-04T02:30:00Z')),true);
 assert.equal(bookingHasEnded({...b,endTime:''},Date.parse('2026-11-04T03:59:59Z')),false);
 assert.equal(bookingHasEnded({...b,kind:'1일클래스',endTime:''},Date.parse('2026-11-04T03:00:00Z')),true);
});

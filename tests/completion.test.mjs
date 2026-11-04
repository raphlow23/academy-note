import test from 'node:test';
import assert from 'node:assert/strict';
import {bookingHasStarted,needsCompletion} from '../booking-completion.js';
const b={date:'2026-11-04',time:'11:00',endTime:'13:00',kind:'정규권',status:'예약'};
test('한국시간 시작 직전에는 예약이고 시작 시각부터 완료 대상이다',()=>{
 assert.equal(needsCompletion(b,Date.parse('2026-11-04T01:59:59Z')),false);
 assert.equal(needsCompletion(b,Date.parse('2026-11-04T02:00:00Z')),true);
 assert.equal(needsCompletion({...b,status:'취소'},Date.parse('2026-11-04T02:00:00Z')),false);
 assert.equal(needsCompletion({...b,status:'수강완료'},Date.parse('2026-11-04T02:00:00Z')),false);
});
test('수강권 종류와 종료시간에 관계없이 저장된 실제 시작시간을 사용한다',()=>{
 for(const x of [{...b,endTime:'24:00'},{...b,endTime:''},{...b,kind:'1일클래스',endTime:'11:30'}]){
  assert.equal(bookingHasStarted(x,Date.parse('2026-11-04T01:59:59Z')),false);
  assert.equal(bookingHasStarted(x,Date.parse('2026-11-04T02:00:00Z')),true);
 }
 assert.equal(needsCompletion({...b,time:'13:30'},Date.parse('2026-11-04T04:29:59Z')),false);
 assert.equal(needsCompletion({...b,time:'13:30'},Date.parse('2026-11-04T04:30:00Z')),true);
});

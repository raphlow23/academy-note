import test from 'node:test';
import assert from 'node:assert/strict';
import {AutoCommit} from '../form-autosave.js';
function fixture(){let next=1,busy=false,valid=true;const timers=new Map(),calls=[];const auto=new AutoCommit({ready:(id,touched)=>valid&&touched.has('amount'),busy:()=>busy,submit:id=>calls.push(id),setTimer:f=>{const id=next++;timers.set(id,f);return id;},clearTimer:id=>timers.delete(id)});return {auto,calls,timers,busy:v=>busy=v,valid:v=>valid=v,tick(){const jobs=[...timers.values()];timers.clear();jobs.forEach(f=>f());}};}
test('계속 입력하는 동안 저장을 미루고 완성된 입력만 한 번 확정한다',()=>{const f=fixture();f.auto.change('payment','amount');f.auto.change('payment','note');assert.equal(f.timers.size,1);f.tick();assert.deepEqual(f.calls,['payment']);});
test('필수 입력 미완성과 한글 조합 중에는 자동 확정하지 않는다',()=>{const f=fixture();f.auto.change('payment','note');f.tick();assert.equal(f.calls.length,0);f.auto.change('payment','amount');f.auto.composition('payment',true);f.tick();assert.equal(f.calls.length,0);f.auto.composition('payment',false);f.tick();assert.equal(f.calls.length,1);});
test('홈으로 나갈 때 대기 타이머를 기다리지 않고 완성된 입력을 제출한다',()=>{const f=fixture();f.auto.change('booking','amount');f.auto.flush();assert.deepEqual(f.calls,['booking']);assert.equal(f.timers.size,0);});
test('다른 저장 중에는 기다리고 완료·취소 후 남은 타이머가 재등록하지 않는다',()=>{const f=fixture();f.auto.change('payment','amount');f.busy(true);f.tick();assert.equal(f.calls.length,0);assert.equal(f.timers.size,1);f.auto.reset('payment');f.busy(false);f.tick();assert.equal(f.calls.length,0);});

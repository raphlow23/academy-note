import test from 'node:test';
import assert from 'node:assert/strict';
import {installMenuSwipe,swipeStep} from '../menu-swipe.js';
function setup(){
 const listeners={},moves=[];let time=0,allowed=true;
 const root={addEventListener:(name,fn)=>listeners[name]=fn},target={closest:()=>null,parentElement:root};
 installMenuSwipe(root,{canNavigate:()=>allowed,onNavigate:n=>moves.push(n),viewportWidth:()=>390,now:()=>time});
 const touch=(x,y)=>({identifier:1,clientX:x,clientY:y});
 return {moves,target,listeners,advance:n=>time+=n,allow:v=>allowed=v,start:(x=250,y=200,t=target)=>listeners.touchstart({target:t,touches:[touch(x,y)]}),move:(x,y)=>listeners.touchmove({touches:[touch(x,y)]}),end:(x=120,y=200,elapsed=200)=>{time+=elapsed;listeners.touchend({changedTouches:[touch(x,y)]});}};
}
test('왼쪽은 다음 메뉴, 오른쪽은 이전 메뉴이며 짧은 터치·지나치게 느린 드래그·세로 방향은 제외한다',()=>{
 assert.equal(swipeStep({dx:-100,dy:8,vertical:8,elapsed:200}),1);
 assert.equal(swipeStep({dx:100,dy:8,vertical:8,elapsed:200}),-1);
 for(const v of [{dx:20,dy:1,elapsed:100},{dx:100,dy:90,elapsed:100},{dx:100,dy:1,elapsed:1900}])assert.equal(swipeStep(v),0);
});
test('스크롤하다 방향을 바꿔도 메뉴로 넘어가지 않으며 정상 가로 스와이프만 한 번 처리한다',()=>{
 const a=setup();a.start();a.move(245,260);a.end(120,200);assert.deepEqual(a.moves,[]);
 a.start();a.move(180,205);a.end(120,205);assert.deepEqual(a.moves,[1]);
});
test('화면 가장자리 뒤로가기·멀티터치·중단 제스처는 메뉴를 바꾸지 않는다',()=>{
 const a=setup();a.start(10);a.end(150);a.start(380);a.end(200);assert.deepEqual(a.moves,[]);
 a.start();a.listeners.touchmove({touches:[{identifier:1},{identifier:2}]});a.end();assert.deepEqual(a.moves,[]);
 a.start();a.listeners.touchcancel();a.end();assert.deepEqual(a.moves,[]);
});
test('입력·작은창·저장 중에는 이동하지 않고 수강생 행은 스와이프할 수 있다',()=>{
 const a=setup();a.start(250,200,{closest:()=>({})});a.end();assert.deepEqual(a.moves,[]);
 a.allow(false);a.start();a.end();assert.deepEqual(a.moves,[]);
 a.allow(true);a.start();a.allow(false);a.end();assert.deepEqual(a.moves,[]);
 a.allow(true);const button={matches:()=>true};a.start(250,200,{closest:s=>s==='button'?button:null,parentElement:a.target.parentElement});a.end();assert.deepEqual(a.moves,[1]);
});
test('스와이프 직후 남은 터치 클릭이 달력이나 학생 창을 열지 않게 막는다',()=>{
 const a=setup();a.start();a.end();let blocked=0;a.listeners.click({detail:1,preventDefault:()=>blocked++,stopImmediatePropagation:()=>blocked++});assert.equal(blocked,2);
 a.listeners.click({detail:0,preventDefault:()=>blocked++,stopImmediatePropagation:()=>blocked++});assert.equal(blocked,2);
});
const pointer=(a,type='mouse',x=250,y=200)=>({target:a.target,pointerId:1,pointerType:type,button:0,isPrimary:true,clientX:x,clientY:y,cancelable:true,preventDefault(){}});
test('PC 크롬의 마우스 왼쪽 드래그를 처리하고 일반 클릭은 그대로 둔다',()=>{
 const a=setup();a.listeners.pointerdown(pointer(a));a.advance(1000);a.listeners.pointermove(pointer(a,'mouse',150));a.listeners.pointerup(pointer(a,'mouse',100));assert.deepEqual(a.moves,[1]);
 const b=setup();b.listeners.pointerdown(pointer(b));b.listeners.pointerup(pointer(b));let blocked=false;b.listeners.click({detail:1,preventDefault:()=>blocked=true,stopImmediatePropagation(){}});assert.equal(blocked,false);assert.deepEqual(b.moves,[]);
});
test('터치 포인터만 있는 크롬도 지원하고 touch 이벤트와 포인터가 같이 오면 중복 이동하지 않는다',()=>{
 const a=setup();a.listeners.pointerdown(pointer(a,'touch'));a.listeners.pointerup(pointer(a,'touch',100));assert.deepEqual(a.moves,[1]);
 const b=setup();b.listeners.pointerdown(pointer(b,'touch'));b.start();b.listeners.pointerup(pointer(b,'touch',100));b.end();assert.deepEqual(b.moves,[1]);
});
test('트랙패드 가로 이동은 누적해 한 번만 넘기고 관성 이벤트로 여러 메뉴를 건너뛰지 않는다',()=>{
 const a=setup();const wheel=x=>({target:a.target,deltaX:x,deltaY:0,deltaMode:0,cancelable:true,preventDefault(){}});
 a.listeners.wheel(wheel(45));a.listeners.wheel(wheel(45));a.listeners.wheel(wheel(200));assert.deepEqual(a.moves,[1]);
 a.advance(800);a.listeners.wheel(wheel(-100));assert.deepEqual(a.moves,[1,-1]);
});
test('세로 마우스 휠과 트랙패드 확대는 메뉴 이동으로 소비하지 않는다',()=>{
 const a=setup();let blocked=0;const e={target:a.target,deltaX:0,deltaY:100,cancelable:true,preventDefault:()=>blocked++};a.listeners.wheel(e);a.listeners.wheel({...e,deltaX:200,deltaY:0,ctrlKey:true});assert.deepEqual(a.moves,[]);assert.equal(blocked,0);
});
test('오른쪽 버튼 드래그와 저장 중 포인터 이동은 메뉴를 바꾸지 않는다',()=>{
 const a=setup();a.listeners.pointerdown({...pointer(a),button:2});a.listeners.pointerup(pointer(a,'mouse',100));assert.deepEqual(a.moves,[]);
 a.listeners.pointerdown(pointer(a));a.allow(false);a.listeners.pointerup(pointer(a,'mouse',100));assert.deepEqual(a.moves,[]);
});


test('40px의 짧고 천천한 밀기와 빠른 28px 밀기를 인식하지만 작은 손떨림은 제외한다',()=>{
 assert.equal(swipeStep({dx:-40,dy:8,vertical:8,elapsed:1100}),1);
 assert.equal(swipeStep({dx:28,dy:4,vertical:4,elapsed:90}),-1);
 assert.equal(swipeStep({dx:28,dy:4,vertical:4,elapsed:400}),0);
 assert.equal(swipeStep({dx:15,dy:2,elapsed:20}),0);
});
test('35px 이상 대각선 흔들림도 가로 방향이 우세하면 이동한다',()=>{
 const a=setup();a.start();a.move(225,210);a.move(180,242);a.end(150,248,600);
 assert.deepEqual(a.moves,[1]);
});
test('처음 세로로 스크롤한 뒤 옆으로 방향을 바꿔도 메뉴가 갑자기 이동하지 않는다',()=>{
 const a=setup();a.start();a.move(247,220);a.move(190,215);a.end(150,205);
 assert.deepEqual(a.moves,[]);
});
test('가로 방향을 잡은 터치는 브라우저 기본 가로 이동을 막고 세로는 그대로 둔다',()=>{
 const a=setup();let prevented=0;
 a.start();a.listeners.touchmove({touches:[{identifier:1,clientX:235,clientY:203}],cancelable:true,preventDefault:()=>prevented++});
 assert.equal(prevented,1);a.end(205,207);assert.deepEqual(a.moves,[1]);
 const b=setup();b.start();b.listeners.touchmove({touches:[{identifier:1,clientX:247,clientY:220}],cancelable:true,preventDefault:()=>prevented++});
 assert.equal(prevented,1);
});
test('일반 버튼 위에서도 가로 밀기는 이동하고 버튼의 후속 클릭은 실행하지 않는다',()=>{
 const a=setup(),button={matches:()=>false},target={closest:q=>q==='button'?button:null,parentElement:a.target.parentElement};
 a.start(250,200,target);a.move(230,203);a.end(205,205);assert.deepEqual(a.moves,[1]);
 let blocked=0;a.listeners.click({detail:1,preventDefault:()=>blocked++,stopImmediatePropagation:()=>blocked++});assert.equal(blocked,2);
});
test('연속된 짧은 두 번 밀기는 각각 한 메뉴씩 이동한다',()=>{
 const a=setup();a.start();a.move(235,203);a.end(205,205,180);
 a.start();a.move(235,203);a.end(205,205,180);assert.deepEqual(a.moves,[1,1]);
});


test('감도를 한 단계 높여 34px 밀기와 빠른 22px 밀기를 처리하고 작은 손떨림은 계속 제외한다',()=>{
 assert.equal(swipeStep({dx:-34,dy:6,vertical:6,elapsed:850}),1);
 assert.equal(swipeStep({dx:22,dy:3,vertical:3,elapsed:100}),-1);
 assert.equal(swipeStep({dx:22,dy:3,elapsed:300}),0);
 assert.equal(swipeStep({dx:20,dy:2,elapsed:30}),0);
 assert.equal(swipeStep({dx:40,dy:34,vertical:34,elapsed:350}),-1);
 assert.equal(swipeStep({dx:40,dy:34,elapsed:350,axis:'vertical'}),0);
 const a=setup();a.start();a.move(238,202);a.end(216,206,500);assert.deepEqual(a.moves,[1]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {installMenuSwipe,swipeStep} from '../menu-swipe.js';
function setup(){
 const listeners={},moves=[];let time=0,allowed=true;
 const root={addEventListener:(name,fn)=>listeners[name]=fn},target={closest:()=>null,parentElement:root};
 installMenuSwipe(root,{canNavigate:()=>allowed,onNavigate:n=>moves.push(n),viewportWidth:()=>390,now:()=>time});
 const touch=(x,y)=>({identifier:1,clientX:x,clientY:y});
 return {moves,target,listeners,allow:v=>allowed=v,start:(x=250,y=200,t=target)=>listeners.touchstart({target:t,touches:[touch(x,y)]}),move:(x,y)=>listeners.touchmove({touches:[touch(x,y)]}),end:(x=120,y=200,elapsed=200)=>{time+=elapsed;listeners.touchend({changedTouches:[touch(x,y)]});}};
}
test('왼쪽은 다음 메뉴, 오른쪽은 이전 메뉴이며 짧은 터치·느린 드래그·대각선은 제외한다',()=>{
 assert.equal(swipeStep({dx:-100,dy:8,vertical:8,elapsed:200}),1);
 assert.equal(swipeStep({dx:100,dy:8,vertical:8,elapsed:200}),-1);
 for(const v of [{dx:25,dy:1,elapsed:100},{dx:100,dy:70,elapsed:100},{dx:100,dy:1,elapsed:900}])assert.equal(swipeStep(v),0);
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
test('입력·일반 버튼·작은창·저장 중에는 이동하지 않고 수강생 행은 스와이프할 수 있다',()=>{
 const a=setup();a.start(250,200,{closest:()=>({})});a.end();assert.deepEqual(a.moves,[]);
 a.allow(false);a.start();a.end();assert.deepEqual(a.moves,[]);
 a.allow(true);a.start();a.allow(false);a.end();assert.deepEqual(a.moves,[]);
 a.allow(true);const button={matches:()=>true};a.start(250,200,{closest:s=>s==='button'?button:null,parentElement:a.target.parentElement});a.end();assert.deepEqual(a.moves,[1]);
});
test('스와이프 직후 남은 터치 클릭이 달력이나 학생 창을 열지 않게 막는다',()=>{
 const a=setup();a.start();a.end();let blocked=0;a.listeners.click({detail:1,preventDefault:()=>blocked++,stopImmediatePropagation:()=>blocked++});assert.equal(blocked,2);
 a.listeners.click({detail:0,preventDefault:()=>blocked++,stopImmediatePropagation:()=>blocked++});assert.equal(blocked,2);
});

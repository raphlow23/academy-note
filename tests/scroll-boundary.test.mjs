import test from 'node:test';
import assert from 'node:assert/strict';
import {canMoveVertically,canScrollFrom,installScrollBoundary} from '../scroll-boundary.js';
const box=(height=1000,client=500,top=0)=>({scrollHeight:height,clientHeight:client,scrollTop:top,tagName:'DIV',css:{overflowY:'auto',overscrollBehaviorY:'auto'}});
test('내용이 화면에 맞으면 위아래 모두 고정하고 긴 목록은 남은 방향으로 스크롤한다',()=>{
 assert.equal(canMoveVertically(box(500,500),-20),false);assert.equal(canMoveVertically(box(500,500),20),false);
 assert.equal(canMoveVertically(box(1000,500,0),-20),true);assert.equal(canMoveVertically(box(1000,500,0),20),false);
 assert.equal(canMoveVertically(box(1000,500,500),-20),false);assert.equal(canMoveVertically(box(1000,500,500),20),true);
});
test('작은창 내부와 날짜 칸의 긴 내용은 스크롤하고 경계에서는 배경으로 전달하지 않는다',()=>{
 const root=box(2000,800,200),inside=box(1000,300,100);inside.parentElement=root;inside.css.overscrollBehaviorY='contain';
 const env={root,modalOpen:true,style:e=>e.css};assert.equal(canScrollFrom(inside,-20,env),true);
 inside.scrollTop=700;assert.equal(canScrollFrom(inside,-20,env),false);
 assert.equal(canScrollFrom(root,-20,env),false);
});
test('긴 페이지의 일반 내부 영역에서는 페이지 스크롤을 계속 허용한다',()=>{
 const root=box(2000,800,200),inside=box(200,200);inside.parentElement=root;
 assert.equal(canScrollFrom(inside,-20,{root,style:e=>e.css}),true);
});
function fixture(height=500,modal=false){
 const root={...box(height,500),tagName:'HTML',closest:()=>null},listeners={},options={};
 const doc={scrollingElement:root,defaultView:{innerWidth:390},querySelector:()=>modal?{}:null,addEventListener:(type,fn,o)=>{listeners[type]=fn;options[type]=o;}};
 installScrollBoundary(doc);const touch=(x,y)=>({identifier:1,clientX:x,clientY:y});
 return {root,doc,listeners,options,start:(x=200,y=200)=>listeners.touchstart({target:root,touches:[touch(x,y)]}),move:(x,y)=>{let prevented=false;listeners.touchmove({target:root,touches:[touch(x,y)],cancelable:true,preventDefault:()=>prevented=true});return prevented;}};
}
test('스크롤 없는 화면의 세로 끌기만 막고 좌우 메뉴 스와이프는 유지한다',()=>{
 const a=fixture();a.start();assert.equal(a.move(202,180),true);a.start();assert.equal(a.move(100,205),false);assert.equal(a.options.touchmove.passive,false);
});
test('긴 목록은 스크롤하며 짧은 창이 열리면 배경만 움직이는 것을 막는다',()=>{
 const a=fixture(2000);a.start();assert.equal(a.move(200,180),false);
 const b=fixture(2000,true);b.start();assert.equal(b.move(200,180),true);
});
test('화면 가장자리와 다중 손가락은 가로 뒤로가기와 핀치를 위해 그대로 둔다',()=>{
 const a=fixture();a.start(10);assert.equal(a.move(15,180),false);a.start();a.listeners.touchmove({touches:[{},{}]});assert.equal(a.move(200,180),false);
});
test('확대한 화면에서는 한 손가락으로 확대 영역을 이동할 수 있다',()=>{
 const a=fixture();a.doc.defaultView.visualViewport={scale:2};a.start();assert.equal(a.move(200,180),false);
});

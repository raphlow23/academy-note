import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const source=app.slice(app.indexOf('function switchView(view){'),app.indexOf('function canReloadApp(){'));
function fixture(){
 const animations=[],applied=[],state={view:'calendar',data:{user:{role:'admin'}},pending:0};
 const context={state,pages:{calendar:[],students:[],closures:[],backup:[],users:[]},matchMedia:()=>({matches:false}),menuGeneration:0,menuAnimating:false,menuTransition:null,menuAnimation:null,toast(){},fitCalendar(){},requestAnimationFrame:fn=>fn(),window:{scrollTo(){}},document:{documentElement:{dataset:{}},startViewTransition(){throw Error('snapshot overlay must not be used');}},applyView:view=>{state.view=view;applied.push(view);},$:()=>({animate(){let resolve,reject;const finished=new Promise((ok,no)=>{resolve=ok;reject=no;});const animation={finished,cancelled:false,cancel(){this.cancelled=true;reject(Error('cancelled'));},resolve};animations.push(animation);return animation;}})};
 vm.createContext(context);vm.runInContext(source,context);return {context,state,animations,applied,go:view=>context.switchView(view)};
}
test('슬라이드가 끝나기 전에도 실제 메뉴 상태를 즉시 갱신한다',()=>{
 const f=fixture();f.go('students');assert.equal(f.state.view,'students');assert.equal(f.context.menuAnimating,true);assert.equal(f.animations.length,1);
});
test('전환 중 연속 이동은 다음 메뉴로 진행하고 예전 애니메이션 완료가 현재 상태를 덮지 않는다',async()=>{
 const f=fixture();f.go('students');f.go('closures');f.go('backup');
 assert.deepEqual(f.applied,['students','closures','backup']);assert.equal(f.animations[0].cancelled,true);assert.equal(f.animations[1].cancelled,true);
 await Promise.resolve();assert.equal(f.context.menuAnimating,true);assert.equal(f.state.view,'backup');
 f.animations[2].resolve();await Promise.resolve();assert.equal(f.context.menuAnimating,false);
});
test('저장 중 메뉴 이동은 계속 차단한다',()=>{
 const f=fixture();f.state.pending=1;f.go('students');assert.equal(f.state.view,'calendar');assert.equal(f.animations.length,0);
});

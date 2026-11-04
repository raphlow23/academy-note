export function canMoveVertically(element,fingerDelta){
 const max=element.scrollHeight-element.clientHeight;
 if(max<=2)return false;
 return fingerDelta>0?element.scrollTop>1:element.scrollTop<max-1;
}
export function canScrollFrom(target,dy,{root,modalOpen=false,style=e=>getComputedStyle(e)}={}){
 for(let e=target;e&&e!==root&&e.tagName!=='BODY'&&e.tagName!=='HTML';e=e.parentElement){
  const css=style(e);
  if(['auto','scroll'].includes(css.overflowY)&&e.scrollHeight>e.clientHeight+2){
   if(canMoveVertically(e,dy))return true;
   if(['contain','none'].includes(css.overscrollBehaviorY))return false;
  }
 }
 return !modalOpen&&!!root&&canMoveVertically(root,dy);
}
export function installScrollBoundary(doc){
 let touch=null;
 doc.addEventListener('touchstart',e=>{
  touch=null;if(doc.defaultView?.visualViewport?.scale>1.01||e.touches.length!==1||e.target.closest?.('input:not([type=checkbox]):not([type=radio]),select,[contenteditable="true"]'))return;
  const t=e.touches[0],width=doc.defaultView?.innerWidth||doc.documentElement?.clientWidth||Infinity;
  if(t.clientX<28||t.clientX>width-28)return;
  touch={id:t.identifier,x:t.clientX,y:t.clientY,lastY:t.clientY};
 },{passive:true,capture:true});
 doc.addEventListener('touchmove',e=>{
  if(!touch)return;if(e.touches.length!==1){touch=null;return;}
  const t=[...e.touches].find(t=>t.identifier===touch.id);if(!t){touch=null;return;}
  const dx=t.clientX-touch.x,dy=t.clientY-touch.y,step=t.clientY-touch.lastY;touch.lastY=t.clientY;
  if(Math.abs(dy)<3||Math.abs(dx)>=Math.abs(dy)||!step||!e.cancelable)return;
  if(!canScrollFrom(e.target,step,{root:doc.scrollingElement,modalOpen:!!doc.querySelector('dialog[open]')}))e.preventDefault();
 },{passive:false,capture:true});
 for(const type of ['touchend','touchcancel'])doc.addEventListener(type,()=>{touch=null;},{passive:true,capture:true});
}

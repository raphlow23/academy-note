export function swipeStep({dx,dy,vertical=0,elapsed}){
 if(elapsed<0||elapsed>800||Math.abs(dx)<70||Math.abs(dx)<Math.abs(dy)*1.8||vertical>35)return 0;
 return dx<0?1:-1;
}
export function installMenuSwipe(root,{canNavigate,onNavigate,viewportWidth=()=>window.innerWidth,now=()=>Date.now()}){
 let gesture=null,suppressClickUntil=0;
 const ignored=target=>{
  if(target.closest?.('input,textarea,select,label,summary,a,[contenteditable="true"],[data-no-swipe],dialog'))return true;
  const button=target.closest?.('button');
  if(button&&!button.matches('.day,.studentrow,.slotperson'))return true;
  for(let e=target;e&&e!==root;e=e.parentElement)if(e.scrollWidth>e.clientWidth+2&&['auto','scroll'].includes(getComputedStyle(e).overflowX))return true;
  return false;
 };
 root.addEventListener('touchstart',e=>{
  gesture=null;if(e.touches.length!==1||!canNavigate()||ignored(e.target))return;
  const t=e.touches[0];if(t.clientX<28||t.clientX>viewportWidth()-28)return;
  gesture={id:t.identifier,x:t.clientX,y:t.clientY,vertical:0,at:now()};
 },{passive:true});
 root.addEventListener('touchmove',e=>{
  if(!gesture)return;if(e.touches.length!==1){gesture=null;return;}
  const t=[...e.touches].find(t=>t.identifier===gesture.id);if(!t){gesture=null;return;}
  gesture.vertical=Math.max(gesture.vertical,Math.abs(t.clientY-gesture.y));
 },{passive:true});
 root.addEventListener('touchcancel',()=>{gesture=null;},{passive:true});
 root.addEventListener('touchend',e=>{
  const g=gesture;gesture=null;if(!g||!canNavigate())return;
  const t=[...e.changedTouches].find(t=>t.identifier===g.id);if(!t)return;
  const step=swipeStep({dx:t.clientX-g.x,dy:t.clientY-g.y,vertical:g.vertical,elapsed:now()-g.at});
  if(!step)return;suppressClickUntil=now()+400;onNavigate(step);
 },{passive:true});
 root.addEventListener('click',e=>{if(e.detail!==0&&now()<suppressClickUntil){suppressClickUntil=0;e.preventDefault();e.stopImmediatePropagation();}},true);
}

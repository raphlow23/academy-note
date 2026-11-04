export function swipeStep({dx,dy,vertical=0,elapsed,maxDuration=1800,axis=null}){
 const distance=Math.abs(dx),drift=Math.max(Math.abs(dy),vertical);
 if(elapsed<0||elapsed>maxDuration||axis==='vertical'||distance<22||distance<drift*1.15)return 0;
 if(distance<34&&(elapsed<=0||distance/elapsed<0.20))return 0;
 return dx<0?1:-1;
}
function trackAxis(g,dx,dy){
 g.vertical=Math.max(g.vertical,Math.abs(dy));
 if(!g.axis){
  if(Math.abs(dx)>=10&&Math.abs(dx)>Math.abs(dy)*1.2)g.axis='horizontal';
  else if(Math.abs(dy)>=10&&Math.abs(dy)>Math.abs(dx)*1.2)g.axis='vertical';
 }
 return g.axis==='horizontal';
}
export function installMenuSwipe(root,{canNavigate,onNavigate,viewportWidth=()=>window.innerWidth,now=()=>Date.now()}){
 let gesture=null,pointer=null,suppressClickUntil=0,wheelTotal=0,lastWheel=0,wheelLockUntil=0;
 const ignored=target=>{
  if(target.closest?.('input,textarea,select,label,summary,a,[contenteditable="true"],[data-no-swipe],dialog'))return true;
  for(let e=target;e&&e!==root;e=e.parentElement)if(e.scrollWidth>e.clientWidth+2&&['auto','scroll'].includes(getComputedStyle(e).overflowX))return true;
  return false;
 };
 root.addEventListener('touchstart',e=>{
  pointer=null;root.classList?.remove('menu-dragging');
  gesture=null;if(e.touches.length!==1||!canNavigate()||ignored(e.target))return;
  const t=e.touches[0];if(t.clientX<28||t.clientX>viewportWidth()-28)return;
  gesture={id:t.identifier,x:t.clientX,y:t.clientY,vertical:0,axis:null,at:now()};
 },{passive:true});
 const clearPointer=()=>{if(pointer)try{root.releasePointerCapture?.(pointer.id);}catch{}pointer=null;root.classList?.remove('menu-dragging');};
 root.addEventListener('pointerdown',e=>{
  clearPointer();if(e.isPrimary===false||e.button!==0||!canNavigate()||ignored(e.target))return;
  if(e.clientX<28||e.clientX>viewportWidth()-28)return;
  pointer={id:e.pointerId,type:e.pointerType,x:e.clientX,y:e.clientY,vertical:0,axis:null,at:now(),dragging:false};
 });
 root.addEventListener('pointermove',e=>{
  if(!pointer||e.pointerId!==pointer.id)return;
  const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;
  if(trackAxis(pointer,dx,dy)){pointer.dragging=true;root.classList?.add('menu-dragging');try{root.setPointerCapture?.(e.pointerId);}catch{}if(e.cancelable)e.preventDefault();}
 });
 root.addEventListener('pointerup',e=>{
  if(!pointer||e.pointerId!==pointer.id)return;const g=pointer;clearPointer();if(!canNavigate())return;
  const step=swipeStep({dx:e.clientX-g.x,dy:e.clientY-g.y,vertical:g.vertical,axis:g.axis,elapsed:now()-g.at});
  if(!step)return;gesture=null;suppressClickUntil=now()+400;onNavigate(step);
 });
 root.addEventListener('pointercancel',clearPointer);root.addEventListener('lostpointercapture',()=>{pointer=null;root.classList?.remove('menu-dragging');});
 root.addEventListener('dragstart',e=>{if(pointer?.dragging)e.preventDefault();});
 root.addEventListener('wheel',e=>{
  if(e.ctrlKey||ignored(e.target))return;
  const scale=e.deltaMode===1?16:e.deltaMode===2?viewportWidth():1,dx=(e.deltaX||(e.shiftKey?e.deltaY:0))*scale,dy=e.shiftKey?0:e.deltaY*scale;
  if(!dx||Math.abs(dx)<Math.abs(dy)*1.8)return;
  if(now()<wheelLockUntil){if(e.cancelable)e.preventDefault();return;}
  if(!canNavigate())return;if(e.cancelable)e.preventDefault();
  if(now()-lastWheel>300||Math.sign(wheelTotal)!==Math.sign(dx))wheelTotal=0;
  wheelTotal+=dx;lastWheel=now();if(Math.abs(wheelTotal)<90)return;
  const step=wheelTotal>0?1:-1;wheelTotal=0;wheelLockUntil=now()+700;onNavigate(step);
 },{passive:false});
 root.addEventListener('touchmove',e=>{
  if(!gesture)return;if(e.touches.length!==1){gesture=null;return;}
  const t=[...e.touches].find(t=>t.identifier===gesture.id);if(!t){gesture=null;return;}
  if(trackAxis(gesture,t.clientX-gesture.x,t.clientY-gesture.y)&&e.cancelable)e.preventDefault();
 },{passive:false});
 root.addEventListener('touchcancel',()=>{gesture=null;},{passive:true});
 root.addEventListener('touchend',e=>{
  const g=gesture;gesture=null;if(!g||!canNavigate())return;
  const t=[...e.changedTouches].find(t=>t.identifier===g.id);if(!t)return;
  const step=swipeStep({dx:t.clientX-g.x,dy:t.clientY-g.y,vertical:g.vertical,axis:g.axis,elapsed:now()-g.at});
  if(!step)return;suppressClickUntil=now()+400;onNavigate(step);
 },{passive:true});
 root.addEventListener('click',e=>{if(e.detail!==0&&now()<suppressClickUntil){suppressClickUntil=0;e.preventDefault();e.stopImmediatePropagation();}},true);
}

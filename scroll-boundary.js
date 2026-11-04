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
export function edgePullOffset(distance){return Math.sign(distance)*10*(1-Math.exp(-Math.abs(distance)/55));}
export function installScrollBoundary(doc,{onPull=()=>{},canRefresh=()=>false,onRefresh=()=>{},onRefreshHint=()=>{}}={}){
 let touch=null,pull=0,refreshEligible=false,suppressClickUntil=0;
 const release=()=>{touch=null;pull=0;refreshEligible=false;onPull(0,false);onRefreshHint(false,false);};
 doc.addEventListener('touchstart',e=>{
  release();if(doc.defaultView?.visualViewport?.scale>1.01||e.touches.length!==1||e.target.closest?.('input:not([type=checkbox]):not([type=radio]),select,[contenteditable="true"]'))return;
  const t=e.touches[0],width=doc.defaultView?.innerWidth||doc.documentElement?.clientWidth||Infinity;
  if(t.clientX<28||t.clientX>width-28)return;
  refreshEligible=(doc.scrollingElement?.scrollTop||0)<=1&&!doc.querySelector('dialog[open]')&&canRefresh();
  for(let el=e.target;el&&el!==doc.scrollingElement&&el.tagName!=='BODY'&&el.tagName!=='HTML';el=el.parentElement)if(el.scrollHeight>el.clientHeight+2&&['auto','scroll'].includes(getComputedStyle(el).overflowY))refreshEligible=false;
  touch={id:t.identifier,x:t.clientX,y:t.clientY,lastY:t.clientY};
 },{passive:true,capture:true});
 doc.addEventListener('touchmove',e=>{
  if(!touch)return;if(e.touches.length!==1){release();return;}
  const t=[...e.touches].find(t=>t.identifier===touch.id);if(!t){release();return;}
  const dx=t.clientX-touch.x,dy=t.clientY-touch.y,step=t.clientY-touch.lastY;touch.lastY=t.clientY;
  if(Math.abs(dx)>=Math.abs(dy)){pull=0;refreshEligible=false;onPull(0,false);onRefreshHint(false,false);return;}
  if(Math.abs(dy)<3||!step||!e.cancelable)return;
  const modalOpen=!!doc.querySelector('dialog[open]');
  if(!canScrollFrom(e.target,step,{root:doc.scrollingElement,modalOpen})){e.preventDefault();if(!modalOpen){pull+=step;if(pull<=0||!canRefresh()||(doc.scrollingElement?.scrollTop||0)>1)refreshEligible=false;onPull(edgePullOffset(pull),true);onRefreshHint(refreshEligible&&pull>=110,refreshEligible&&pull>=24);}}
  else if(pull){pull=0;refreshEligible=false;onPull(0,false);onRefreshHint(false,false);}
 },{passive:false,capture:true});
 doc.addEventListener('touchend',()=>{const refresh=refreshEligible&&pull>=110&&canRefresh()&&!doc.querySelector('dialog[open]')&&(doc.scrollingElement?.scrollTop||0)<=1;release();if(refresh){suppressClickUntil=Date.now()+400;onRefresh();}},{passive:true,capture:true});
 doc.addEventListener('touchcancel',release,{passive:true,capture:true});
 doc.addEventListener('click',e=>{if(e.detail!==0&&Date.now()<suppressClickUntil){suppressClickUntil=0;e.preventDefault();e.stopImmediatePropagation();}},true);
}

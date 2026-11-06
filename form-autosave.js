// Each valid form is a single commit. No timeout is allowed to turn one payment
// or reservation into several commands as the user continues editing.
export class AutoCommit{
 constructor({ready,busy,submit,delay=4000,setTimer=(fn,ms)=>globalThis.setTimeout(fn,ms),clearTimer=id=>globalThis.clearTimeout(id),onState=()=>{}}){Object.assign(this,{ready,busy,submit,delay,setTimer,clearTimer,onState});this.forms=new Map();}
 state(id){if(!this.forms.has(id))this.forms.set(id,{dirty:false,touched:new Set(),composing:false,timer:null});return this.forms.get(id);}
 reset(id){const s=this.state(id);this.clearTimer(s.timer);this.forms.delete(id);this.onState(id,'');}
 change(id,field){const s=this.state(id);s.dirty=true;if(field)s.touched.add(field);this.clearTimer(s.timer);this.onState(id,'입력 중 · 입력을 마친 뒤 4초 후 자동 확정');s.timer=this.setTimer(()=>this.commit(id),this.delay);}
 composition(id,value){this.state(id).composing=value;if(!value)this.change(id);}
 commit(id){const s=this.state(id);this.clearTimer(s.timer);s.timer=null;if(!s.dirty||s.composing)return false;if(this.busy()){s.timer=this.setTimer(()=>this.commit(id),300);return false;}if(!this.ready(id,s.touched)){this.onState(id,'입력 중 · 필수 항목을 마치면 자동 확정');return false;}this.onState(id,'자동 저장 중…');this.submit(id);return true;}
 flush(){for(const [id,s] of this.forms)if(s.dirty)this.commit(id);}
 stop(id){this.clearTimer(this.state(id).timer);}
 fail(id,message){this.stop(id);this.onState(id,'저장 확인 필요 · '+message);}
}

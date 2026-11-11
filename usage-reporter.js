import {SERVER_SESSION_KEY} from './server-auth.js?v=20261111-usage1';
const KEY='subong-usage-pending-v1';
export class UsageReporter{
 constructor({auth,storage,clock=()=>Date.now()}={}){this.auth=auth;this.storage=storage;this.clock=clock;this.memory=[];this.running=null;this.lastVisits=new Map();}
 session(){try{const saved=this.auth?.read(SERVER_SESSION_KEY);return this.auth?.enabled&&saved?.token?saved:null;}catch{return null;}}
 read(){if(!this.storage||this.storageUnavailable)return this.memory;try{const rows=JSON.parse(this.storage?.getItem(KEY)||'[]');return Array.isArray(rows)?rows.filter(r=>r&&typeof r.sub==='string'&&/^[\w-]{16,100}$/.test(r.id||'')&&['visit','save'].includes(r.kind)&&Number.isSafeInteger(r.at)&&r.at>=this.clock()/1000-90*86400).slice(-200):[];}catch{this.storageUnavailable=true;return this.memory;}}
 write(rows){this.memory=rows;try{this.storage?.setItem(KEY,JSON.stringify(rows));}catch{this.storageUnavailable=true;}}
 enqueue(sub,id,kind){const session=this.session();if(session?.sub!==sub)return;const rows=this.storage?this.read():this.memory;if(!rows.some(r=>r.sub===sub&&r.id===id))rows.push({sub,id,kind,at:Math.floor(this.clock()/1000)});this.write(rows.slice(-200));void this.flush();}
 visit(sub){const now=this.clock();if(now-(this.lastVisits.get(sub)||0)<30000)return;this.lastVisits.set(sub,now);this.enqueue(sub,crypto.randomUUID(),'visit');}
 async saved(sub,workspace,eventId){
  if(this.session()?.sub!==sub)return;
  try{const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(workspace+':'+eventId));const id=Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');this.enqueue(sub,id,'save');}catch{}
 }
 async flush(){
  if(this.running)return this.running;
  const session=this.session();if(!session)return;
  const run=async()=>{
   for(let i=0;i<200;i++){
    const row=this.read().find(r=>r.sub===session.sub);if(!row)return;
    if(this.session()?.token!==session.token)return;
    try{const result=await this.auth.api('/usage/event',{id:row.id,kind:row.kind,at:row.at},session.token);if(result?.recorded!==true)return;}catch{return;}
    this.write((this.storage?this.read():this.memory).filter(r=>r.sub!==row.sub||r.id!==row.id));
   }
  };
  this.running=run();try{await this.running;}finally{this.running=null;}
 }
 async status(){const session=this.session();if(!session)throw Error('로그인 후 이용 기록을 확인하세요.');const result=await this.auth.api('/usage/status',{},session.token);if(this.session()?.token!==session.token)throw Error('계정이 변경되었습니다.');return result;}
}

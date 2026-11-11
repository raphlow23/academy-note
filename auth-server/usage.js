// Operational timestamps only. No IPs, devices, sheet IDs, or document content.
export const USAGE_SCHEMA=`
CREATE TABLE IF NOT EXISTS usage_meta(id INTEGER PRIMARY KEY,started_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS usage_summary(sub TEXT PRIMARY KEY,last_visit INTEGER,last_saved INTEGER);
CREATE TABLE IF NOT EXISTS usage_events(sub TEXT NOT NULL,event_id TEXT NOT NULL,kind TEXT NOT NULL,at INTEGER NOT NULL,received_at INTEGER NOT NULL,PRIMARY KEY(sub,event_id));
CREATE INDEX IF NOT EXISTS usage_events_received ON usage_events(received_at);
`;
export function initializeUsageStorage(storage,now=Math.floor(Date.now()/1000)){
 for(const statement of USAGE_SCHEMA.split(';').filter(s=>s.trim()))storage.sql.exec(statement);
 storage.sql.exec('INSERT INTO usage_meta(id,started_at) VALUES(1,?) ON CONFLICT(id) DO NOTHING',now);
}
const failure=(status,code)=>Object.assign(new Error(code),{status,code});
export async function usage(request,env,now,{hash,body,response}){
 const bearer=request.headers.get('Authorization')?.match(/^Bearer ([\w-]{43})$/)?.[1];
 if(!bearer)throw failure(401,'auth_required');
 if(request.headers.get('X-Requested-With')!=='XmlHttpRequest')throw failure(403,'csrf_header_required');
 const identity=await env.DB.prepare('SELECT a.sub,a.email FROM auth_sessions s JOIN auth_accounts a ON a.sub=s.sub WHERE s.session_hash=? AND s.expires_at>?').bind(await hash(bearer),now).first();
 if(!identity)throw failure(401,'auth_required');
 const data=await body(request),path=new URL(request.url).pathname;
 if(!data||typeof data!=='object'||Array.isArray(data))throw failure(400,'invalid_usage_event');
 if(path==='/usage/event'){
  if(Object.keys(data).some(k=>!['id','kind','at'].includes(k))||!/^[\w-]{16,100}$/.test(data.id||'')||!['visit','save'].includes(data.kind)||!Number.isSafeInteger(data.at)||data.at<now-90*86400||data.at>now+300)throw failure(400,'invalid_usage_event');
  await env.DB.prepare('INSERT INTO usage_events(sub,event_id,kind,at,received_at) VALUES(?,?,?,?,?) ON CONFLICT(sub,event_id) DO NOTHING').bind(identity.sub,data.id,data.kind,Math.min(data.at,now),now).run();
  // Re-read the original receipt: retries cannot change its kind or timestamp.
  const event=await env.DB.prepare('SELECT kind,at FROM usage_events WHERE sub=? AND event_id=?').bind(identity.sub,data.id).first();
  await env.DB.prepare('INSERT INTO usage_summary(sub,last_visit,last_saved) VALUES(?,?,?) ON CONFLICT(sub) DO UPDATE SET last_visit=MAX(COALESCE(usage_summary.last_visit,0),COALESCE(excluded.last_visit,0)),last_saved=MAX(COALESCE(usage_summary.last_saved,0),COALESCE(excluded.last_saved,0))').bind(identity.sub,event.kind==='visit'?event.at:null,event.kind==='save'?event.at:null).run();
  await env.DB.prepare('DELETE FROM usage_events WHERE received_at<?').bind(now-90*86400).run();
  return response({recorded:true});
 }
 if(path!=='/usage/status')throw failure(404,'not_found');
 const admin=String(env.USAGE_ADMIN_EMAILS||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean).includes(identity.email.toLowerCase());
 // Each ordinary account can only see itself. The server enforces this filter.
 const result=await env.DB.prepare("SELECT json_group_array(json_object('email',email,'lastVisit',last_visit,'lastSaved',last_saved)) AS accounts FROM (SELECT a.email,u.last_visit,u.last_saved FROM auth_accounts a LEFT JOIN usage_summary u ON u.sub=a.sub WHERE ?=1 OR a.sub=? ORDER BY a.email)").bind(admin?1:0,identity.sub).first();
 const meta=await env.DB.prepare('SELECT started_at FROM usage_meta WHERE id=1').first();
 return response({admin,recordingSince:meta?.started_at||null,accounts:JSON.parse(result.accounts||'[]')});
}

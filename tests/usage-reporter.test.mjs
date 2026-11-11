import test from 'node:test';
import assert from 'node:assert/strict';
import {UsageReporter} from '../usage-reporter.js';
function fixture(){
 const entries=new Map(),calls=[];let now=Date.now(),offline=false,identity={sub:'owner',token:'s'.repeat(43)};
 const storage={getItem:k=>entries.get(k)||null,setItem:(k,v)=>entries.set(k,v)};
 const auth={enabled:true,read:()=>identity,api:async(path,data,token)=>{calls.push({path,data,token});if(offline)throw Error('offline');return {recorded:true};}};
 const reporter=new UsageReporter({auth,storage,clock:()=>now});
 return {reporter,calls,entries,offline:v=>offline=v,advance:ms=>now+=ms,switchUser:()=>identity={sub:'other',token:'o'.repeat(43)}};
}
test('visit and confirmed-save reports contain timestamps and opaque IDs only',async()=>{
 const f=fixture();f.reporter.visit('owner');await f.reporter.flush();
 await f.reporter.saved('owner','private-sheet-id','private-command-id');await f.reporter.flush();
 assert.deepEqual(f.calls.map(x=>x.data.kind),['visit','save']);
 assert(f.calls.every(x=>Object.keys(x.data).sort().join(',')==='at,id,kind'));
 assert(!JSON.stringify(f.calls).includes('private-sheet-id'));assert(!JSON.stringify(f.calls).includes('private-command-id'));
});
test('offline telemetry retries without mixing accounts or inventing later event times',async()=>{
 const f=fixture();f.offline(true);f.reporter.visit('owner');await f.reporter.flush();
 const original=f.calls[0].data.at;f.advance(60000);f.switchUser();f.offline(false);await f.reporter.flush();
 assert.equal(f.calls.length,1);f.reporter.visit('other');await f.reporter.flush();
 assert.equal(f.calls.at(-1).token,'o'.repeat(43));assert.equal(f.reporter.read().filter(r=>r.sub==='owner')[0].at,original);
});
test('short foreground repeats are coalesced and reporting failures never throw into saving',async()=>{
 const f=fixture();f.offline(true);assert.doesNotThrow(()=>f.reporter.visit('owner'));await f.reporter.flush();
 f.reporter.visit('owner');assert.equal(f.reporter.read().length,1);
 await assert.doesNotReject(f.reporter.saved('owner','workspace','operation'));await f.reporter.flush();
 assert.equal(f.reporter.read().length,2);
});
test('unavailable persistent storage still reports from memory',async()=>{
 const f=fixture();f.reporter.storage={getItem:()=>null,setItem:()=>{throw Error('full');}};
 f.reporter.visit('owner');await f.reporter.flush();assert.equal(f.calls.length,1);
});

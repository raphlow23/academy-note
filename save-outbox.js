// Only unconfirmed commands live here. Google Sheets remains the source of truth.
export class SaveOutbox{
 constructor(storage){this.storage=storage;}
 key(sub){return 'subong-unsent-v1:'+sub;}
 read(sub){if(!sub)return [];try{const rows=JSON.parse(this.storage?.getItem(this.key(sub))||'[]');if(!Array.isArray(rows))throw Error();return rows;}catch{throw new Error('미전송 기록을 읽을 수 없습니다. 기기 저장소를 지우지 말고 다시 시도하세요.');}}
 write(sub,rows){try{if(!this.storage)throw Error();if(rows.length)this.storage.setItem(this.key(sub),JSON.stringify(rows));else this.storage.removeItem(this.key(sub));}catch{throw new Error('임시 저장 공간을 사용할 수 없습니다. 저장소 권한·여유 공간을 확인한 뒤 다시 저장하세요.');}}
 add(sub,workspace,action,data,actor,at){const rows=this.read(sub),fingerprint=JSON.stringify([workspace,action,data]),existing=rows.find(r=>r.fingerprint===fingerprint);if(existing)return existing;const row={id:crypto.randomUUID(),workspace,action,data:structuredClone(data),actor,at,fingerprint};this.write(sub,rows.concat(row));return row;}
 remove(sub,id){this.write(sub,this.read(sub).filter(r=>r.id!==id));}
}

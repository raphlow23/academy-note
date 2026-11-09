// Authentication only. This store has no Sheets/Drive data or APIs.
export const AUTH_TABLES={
 oauth_attempts:'state_hash TEXT PRIMARY KEY, challenge TEXT NOT NULL, verifier_cipher TEXT NOT NULL, return_to TEXT NOT NULL, ip_hash TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL',
 auth_accounts:'sub TEXT PRIMARY KEY, email TEXT NOT NULL, refresh_cipher TEXT NOT NULL, access_cipher TEXT NOT NULL, access_expires INTEGER NOT NULL, updated_at INTEGER NOT NULL',
 auth_handoffs:'code_hash TEXT PRIMARY KEY, state_hash TEXT NOT NULL, challenge TEXT NOT NULL, sub TEXT NOT NULL, expires_at INTEGER NOT NULL',
 auth_sessions:'session_hash TEXT PRIMARY KEY, sub TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen INTEGER NOT NULL',
 auth_code_limits:'bucket_key TEXT PRIMARY KEY, n INTEGER NOT NULL, expires_at INTEGER NOT NULL'
};
export function initializeAuthStorage(storage,bootstrap){
 const sql=storage.sql;
 storage.transactionSync(()=>{
  sql.exec('CREATE TABLE IF NOT EXISTS auth_storage_meta (id INTEGER PRIMARY KEY, version INTEGER NOT NULL)');
  if(sql.exec('SELECT version FROM auth_storage_meta WHERE id=1').toArray().length)return;
  if(!bootstrap)throw new Error('auth_storage_not_initialized');
  const data=JSON.parse(bootstrap);
  if(Object.keys(data).length!==Object.keys(AUTH_TABLES).length||Object.keys(data).some(t=>!Object.hasOwn(AUTH_TABLES,t)))throw new Error('invalid_auth_bootstrap');
  for(const [table,definition] of Object.entries(AUTH_TABLES)){
   sql.exec(`CREATE TABLE IF NOT EXISTS ${table} (${definition})`);
   const columns=definition.split(',').map(c=>c.trim().split(' ')[0]);
   if(!Array.isArray(data[table]))throw new Error('invalid_auth_bootstrap');
   for(const row of data[table]){
    if(Object.keys(row).length!==columns.length||columns.some(c=>!Object.hasOwn(row,c)||!['string','number'].includes(typeof row[c])))throw new Error('invalid_auth_bootstrap');
    sql.exec(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`,...columns.map(c=>row[c]));
   }
  }
  for(const [name,table,columns] of [['attempts_rate','oauth_attempts','ip_hash,created_at'],['attempts_expiry','oauth_attempts','expires_at'],['handoffs_expiry','auth_handoffs','expires_at'],['sessions_expiry','auth_sessions','expires_at'],['sessions_account','auth_sessions','sub'],['code_limits_expiry','auth_code_limits','expires_at']])sql.exec(`CREATE INDEX IF NOT EXISTS ${name} ON ${table}(${columns})`);
  sql.exec('INSERT INTO auth_storage_meta(id,version) VALUES(1,1)');
 });
}
export function authDatabase(storage){
 return {
  prepare(query){let values=[];return {bind(...args){values=args;return this;},first(){return storage.sql.exec(query,...values).toArray()[0]||null;},run(){const cursor=storage.sql.exec(query,...values);cursor.toArray();return {success:true,meta:{changes:cursor.rowsWritten}};}};},
  batch(statements){return storage.transactionSync(()=>statements.map(s=>s.run()));}
 };
}

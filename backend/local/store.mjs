import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,writeFileSync,existsSync,unlinkSync} from 'node:fs';
import path from 'node:path';
import {randomUUID,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
const tables=['folders','projects','assets','candidates','tasks','materials','models','receipts','usage','settings'];
export class LocalStore{
 constructor(directory){this.directory=path.resolve(directory);mkdirSync(this.directory,{recursive:true});this.lockPath=path.join(this.directory,'.instance-lock');try{writeFileSync(this.lockPath,String(process.pid),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;const pid=Number(readFileSync(this.lockPath,'utf8'));if(!Number.isInteger(pid)||pid<1)throw Error('本机数据库锁无效，请停止所有工作台后核对。');let alive=true;try{process.kill(pid,0);}catch(error){if(error.code==='ESRCH')alive=false;}if(alive)throw Error('本机数据库已被另一个后台使用，请勿重复启动。');unlinkSync(this.lockPath);writeFileSync(this.lockPath,String(process.pid),{flag:'wx',mode:0o600});}this.files=path.join(this.directory,'images');mkdirSync(this.files,{recursive:true});this.db=new DatabaseSync(path.join(this.directory,'studio.sqlite'));this.db.exec('PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000;');for(const table of tables)this.db.exec(`CREATE TABLE IF NOT EXISTS ${table}(id TEXT PRIMARY KEY, project_id TEXT, data TEXT NOT NULL CHECK(json_valid(data)));CREATE INDEX IF NOT EXISTS ${table}_project ON ${table}(project_id);`);this.version=0;const keyPath=path.join(this.directory,'model-secret.key');if(!existsSync(keyPath))writeFileSync(keyPath,randomBytes(32),{mode:0o600,flag:'wx'});this.key=readFileSync(keyPath);}
 table(table){if(!tables.includes(table))throw Error('Unknown local table');return table;}
 all(table,projectId){const t=this.table(table);return (projectId?this.db.prepare(`SELECT data FROM ${t} WHERE project_id=? ORDER BY rowid DESC`).all(projectId):this.db.prepare(`SELECT data FROM ${t} ORDER BY rowid DESC`).all()).map(r=>JSON.parse(r.data));}
 get(table,id){this.table(table);if(id===undefined||id===null||id==='')return null;const row=this.db.prepare(`SELECT data FROM ${this.table(table)} WHERE id=?`).get(id);return row?JSON.parse(row.data):null;}
 put(table,value){this.db.prepare(`INSERT INTO ${this.table(table)}(id,project_id,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,data=excluded.data`).run(value.id,value.project_id||null,JSON.stringify(value));this.version++;return value;}
 transaction(operation){this.db.exec('BEGIN IMMEDIATE');try{const result=operation();this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 remove(table,id){this.db.prepare(`DELETE FROM ${this.table(table)} WHERE id=?`).run(id);this.version++;}
 file(id){if(!/^[0-9a-f-]{36}$/i.test(id))throw Error('Invalid asset ID');return path.join(this.files,id+'.png');}
 encrypt(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv),bytes=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return [iv.toString('base64'),cipher.getAuthTag().toString('base64'),bytes.toString('base64')].join('.');}
 decrypt(value){const [iv,tag,bytes]=value.split('.'),decipher=createDecipheriv('aes-256-gcm',this.key,Buffer.from(iv,'base64'));decipher.setAuthTag(Buffer.from(tag,'base64'));return Buffer.concat([decipher.update(Buffer.from(bytes,'base64')),decipher.final()]).toString('utf8');}
 close(){if(this.closed)return;this.closed=true;this.db.close();if(existsSync(this.lockPath)&&readFileSync(this.lockPath,'utf8')===String(process.pid))unlinkSync(this.lockPath);}
}
export const localOwner='00000000-0000-4000-8000-000000000001';
export const localWorkspace='00000000-0000-4000-8000-000000000002';
export const newId=randomUUID;

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LocalStore,newId} from '../backend/local/store.mjs';
import {emptyRecycleBin} from '../backend/local/deletion.mjs';
test('empty recycle bin removes deleted project files and records but retains live projects and usage',()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'qmx-trash-')),s=new LocalStore(dir);try{
 const id=newId(),live=newId(),asset=newId();s.put('projects',{id,status:'deleted'});s.put('projects',{id:live,status:'active'});s.put('assets',{id:asset,project_id:id});writeFileSync(s.file(asset),'fixture');s.put('usage',{id:newId(),project_id:id});s.put('tasks',{id:newId(),project_id:id,status:'failed'});
 assert.throws(()=>emptyRecycleBin(s,[id,live]));assert.ok(s.get('projects',id));assert.ok(existsSync(s.file(asset)));
 assert.equal(emptyRecycleBin(s,[id]).deleted,1);assert.equal(s.get('projects',id),null);assert.ok(s.get('projects',live));assert.equal(existsSync(s.file(asset)),false);assert.equal(s.all('usage').length,1);assert.equal(s.all('tasks').length,0);
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});

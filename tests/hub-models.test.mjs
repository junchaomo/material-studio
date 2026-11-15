import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {LocalStore} from '../backend/local/store.mjs';
import {parseHubDescriptor,readHubDescriptor,syncHubModels,pruneHubModels,hubFetcher,hubModelId,hubEnvKey} from '../backend/local/hub-models.mjs';

const descriptor={version:1,source:'jg-hub',proxy:{baseURL:'http://127.0.0.1:4198/v1',token:'a'.repeat(32)},models:[{kind:'recognition',name:'中枢·识别',model:'qwen3.8-max'},{kind:'discovery',name:'中枢·发现',model:'qwen3.8-max'}]};

test('中枢模型描述文件：接受本机回环代理与两种用途',()=>{
 const parsed=parseHubDescriptor(descriptor);
 assert.equal(parsed.baseURL,'http://127.0.0.1:4198/v1');
 assert.deepEqual(parsed.models.map(m=>m.kind),['recognition','discovery']);
});

test('中枢模型描述文件：拒绝非回环代理与缺少识别模型',()=>{
 assert.throws(()=>parseHubDescriptor({...descriptor,proxy:{...descriptor.proxy,baseURL:'http://10.1.2.3:4198/v1'}}),/本机回环/);
 assert.throws(()=>parseHubDescriptor({...descriptor,models:[{kind:'discovery',name:'x',model:'y'}]}),/缺少材质识别/);
 assert.throws(()=>parseHubDescriptor({...descriptor,models:[{kind:'reconstruction',name:'x',model:'y'}]}),/用途仅支持/);
 assert.throws(()=>parseHubDescriptor({...descriptor,source:'other'}),/来源无效/);
});

test('中枢模型描述文件：缺失或损坏时回落单机模式',()=>{
 assert.equal(readHubDescriptor({env:{},read:()=>{throw Error('should not read');}}),null);
 const file=path.join(mkdtempSync(path.join(tmpdir(),'hub-')),'hub.json');
 assert.equal(readHubDescriptor({env:{[hubEnvKey]:file},read:()=>'{bad json'}),null);
});

test('中枢模型同步：写入 model 行并清除过期行',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'hub-store-'));
 const store=new LocalStore(dir);
 try{
  syncHubModels(store,parseHubDescriptor(descriptor));
  const rows=store.all('models').filter(m=>m.source==='jg-hub');
  assert.equal(rows.length,2);
  const recognition=rows.find(m=>m.kind==='recognition');
  assert.equal(recognition.id,hubModelId({kind:'recognition',model:'qwen3.8-max'}));
  assert.equal(recognition.protocol,'openai');
  assert.equal(recognition.baseURL,'http://127.0.0.1:4198/v1');
  assert.equal(store.decrypt(recognition.secret),'a'.repeat(32));
  assert.equal(recognition.disabled,false);
  // 再同步一份换了识别模型的清单：旧识别行必须被移除，避免界面上留下失效模型。
  syncHubModels(store,parseHubDescriptor({...descriptor,models:[{kind:'recognition',name:'中枢·识别 v2',model:'qwen3.8-max-v2'}]}));
  assert.equal(store.all('models').filter(m=>m.source==='jg-hub').length,1);
  assert.equal(store.all('models').find(m=>m.source==='jg-hub').model,'qwen3.8-max-v2');
  assert.equal(pruneHubModels(store),1);
  assert.equal(store.all('models').filter(m=>m.source==='jg-hub').length,0);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('中枢模型取数：只允许打向登记的本地代理',async()=>{
 const model={baseURL:'http://127.0.0.1:4198/v1'};
 const fetcher=hubFetcher(model,{fetchImpl:async()=>new Response('{}')});
 await assert.rejects(()=>fetcher('http://127.0.0.1:4999/v1/chat/completions',{}),/越出了代理地址/);
 await assert.rejects(()=>fetcher('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',{}),/本机回环/);
 const response=await fetcher('http://127.0.0.1:4198/v1/chat/completions',{});
 assert.equal(response.status,200);
});

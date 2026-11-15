import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtempSync,rmSync,writeFileSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {parseHubDescriptor} from '../backend/local/hub-models.mjs';

const proxyScript=path.join(import.meta.dirname,'..','plugin','model-proxy.mjs');

function listen(server){return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));}
function freePort(){return new Promise(resolve=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
async function waitFor(file,ms=8000){const start=Date.now();while(!existsSync(file)){if(Date.now()-start>ms)throw new Error('代理未写出描述文件');await new Promise(r=>setTimeout(r,100));}}

test('中枢模型代理：令牌校验、未登记模型拒绝、正常转发并写出描述文件',async()=>{
 const upstream=createServer((req,res)=>{
  let body='';
  req.on('data',c=>{body+=c;});
  req.on('end',()=>{
   const parsed=JSON.parse(body||'{}');
   res.writeHead(200,{'content-type':'application/json'});
   res.end(JSON.stringify({ok:true,model:parsed.model,auth:req.headers.authorization}));
  });
 });
 const upstreamPort=await listen(upstream);
 const dir=mkdtempSync(path.join(tmpdir(),'proxy-'));
 const port=await freePort();
 const token='t'.repeat(32);
 const configPath=path.join(dir,'proxy.json'),descriptorPath=path.join(dir,'hub-models.json');
 writeFileSync(configPath,JSON.stringify({listen:{host:'127.0.0.1',port},token,upstream:{baseURL:`http://127.0.0.1:${upstreamPort}/v1`,apiKey:'sk-upstream'},models:[{id:'qwen3.8-max',kind:'recognition',display:'中枢·识别'},{id:'qwen3.8-max',kind:'discovery',display:'中枢·发现'}]}));
 const child=spawn(process.execPath,[proxyScript,'--config',configPath,'--descriptor',descriptorPath],{stdio:['ignore','pipe','pipe']});
 try{
  await waitFor(descriptorPath);
  const base=`http://127.0.0.1:${port}/v1`;
  const unauthorized=await fetch(base+'/models');
  assert.equal(unauthorized.status,401);
  const listed=await fetch(base+'/models',{headers:{authorization:'Bearer '+token}});
  assert.equal(listed.status,200);
  assert.deepEqual((await listed.json()).data.map(m=>m.id),['qwen3.8-max','qwen3.8-max']);
  const unknown=await fetch(base+'/chat/completions',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({model:'gpt-4o',messages:[]})});
  assert.equal(unknown.status,403);
  const forwarded=await fetch(base+'/chat/completions',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({model:'qwen3.8-max',messages:[{role:'user',content:'hi'}]})});
  assert.equal(forwarded.status,200);
  const payload=await forwarded.json();
  assert.equal(payload.ok,true);
  assert.equal(payload.auth,'Bearer sk-upstream');
  const descriptor=parseHubDescriptor(JSON.parse(readFileSync(descriptorPath,'utf8')));
  assert.equal(descriptor.baseURL,base);
  assert.equal(descriptor.token,token);
  assert.deepEqual(descriptor.models.map(m=>m.kind),['recognition','discovery']);
 }finally{
  child.kill();
  upstream.close();
  rmSync(dir,{recursive:true,force:true});
 }
});

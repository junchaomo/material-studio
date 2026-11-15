import test from 'node:test';
import assert from 'node:assert/strict';
import {probeQwenImageConnection,probeQwenImagePostConnection,reconstructQwen} from '../backend/server/qwen-image.mjs';
import {imageConnectionOptions,imageProviderFetch} from '../backend/server/image-transport.mjs';

test('connection budget is separate from generation deadline and uses an independent IPv4 socket',()=>{
 assert.equal(imageConnectionOptions.connectTimeout,45000);
 assert.equal(imageConnectionOptions.family,4);
 assert.equal(imageConnectionOptions.headersTimeout,240000);
});

test('failed generation connection never automatically resubmits a paid request',async()=>{
 const image='data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(24)]).toString('base64');
 let calls=0;
 await assert.rejects(reconstructQwen({image,description:'灰色纹理',kind:'重复纹理',referenceMode:'rectified-only'},{key:'test-only',fetcher:async()=>{calls++;throw new TypeError('private URL',{cause:{code:'UND_ERR_CONNECT_TIMEOUT'}});}}),/UND_ERR_CONNECT_TIMEOUT/);
 assert.equal(calls,1);
});
test('image connection probe sends no credential, image or model inference request',async()=>{
 const r=await probeQwenImageConnection({},async(url,init)=>{assert.equal(init.method,'GET');assert.equal(init.headers,undefined);assert.equal(init.body,undefined);assert.match(url,/multimodal-generation\/generation$/);return new Response('',{status:405});});
 assert.equal(r.reachable,true);assert.equal(r.inference,false);
});
test('image connection failure exposes only a safe network cause',async()=>{
 const r=await probeQwenImageConnection({},async()=>{throw new TypeError('secret message',{cause:{code:'ECONNRESET'}});});
 assert.equal(r.code,'ECONNRESET');assert.equal(r.reachable,false);assert.doesNotMatch(JSON.stringify(r),/secret/);
});

test('POST diagnostic uses an intentionally invalid credential and empty body, never a real model request',async()=>{
 const r=await probeQwenImagePostConnection({DASHSCOPE_API_KEY:'must-not-send'},async(url,init)=>{assert.equal(init.method,'POST');assert.equal(init.body,'{}');assert.equal(init.headers.Authorization,'Bearer qmx-invalid-network-diagnostic');assert.ok(!JSON.stringify(init).includes('must-not-send'));return new Response('{}',{status:401});});assert.equal(r.reachable,true);assert.equal(r.inference,false);assert.equal(r.transport,'https-ipv4-v2');
});
test('native transport sends exactly one IPv4 HTTPS request and preserves the response body',async t=>{
 const https=(await import('node:https')).default,{EventEmitter}=await import('node:events'),{PassThrough}=await import('node:stream');let calls=0,body='';
 t.mock.method(https,'request',(url,options,respond)=>{calls++;assert.equal(options.family,4);assert.equal(options.agent.options.family,4);assert.equal(options.method,'POST');const req=new EventEmitter();req.setTimeout=()=>req;req.write=chunk=>{body+=chunk;};req.end=()=>queueMicrotask(()=>{const res=new PassThrough();res.statusCode=401;res.headers={'content-type':'application/json'};respond(res);res.end('{"denied":true}');});return req;});
 const response=await imageProviderFetch('https://dashscope.aliyuncs.com/test',{method:'POST',body:'{}'});assert.equal(response.status,401);assert.deepEqual(await response.json(),{denied:true});assert.equal(body,'{}');assert.equal(calls,1);
});

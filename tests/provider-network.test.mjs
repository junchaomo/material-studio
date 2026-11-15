import test from 'node:test';
import assert from 'node:assert/strict';
import {networkDiagnostic,providerConnectionError} from '../backend/server/provider-network.mjs';
import {probeQwenConnection,probeQwenAuthentication,analyzeQwen} from '../backend/server/qwen.mjs';
test('network diagnostics preserve actionable nested codes without leaking raw errors',()=>{
 const secret='private-key-and-image';const e=new TypeError(secret,{cause:new AggregateError([Object.assign(new Error(secret),{code:'UND_ERR_CONNECT_TIMEOUT'})])});
 assert.equal(networkDiagnostic(e).code,'UND_ERR_CONNECT_TIMEOUT');assert.ok(!JSON.stringify(networkDiagnostic(e)).includes(secret));
 const message=providerConnectionError(e,'阿里云百炼').message;assert.ok(message.includes('服务端'));assert.ok(!message.includes('本机'));assert.ok(!message.includes(secret));
 assert.equal(networkDiagnostic({name:'TimeoutError'}).code,'ABORTED');
});
test('connectivity probe sends only one unauthenticated GET, never a paid inference or retry',async()=>{
 let calls=0;const env={DASHSCOPE_API_KEY:'must-not-send',DASHSCOPE_BASE_URL:'https://dashscope.aliyuncs.com/compatible-mode/v1'};
 const result=await probeQwenConnection(env,async(url,init)=>{calls++;assert.ok(url.endsWith('/chat/completions'));assert.equal(init.method,'GET');assert.equal(init.headers,undefined);assert.equal(init.body,undefined);return new Response('{}',{status:401});});
 assert.equal(calls,1);assert.equal(result.reachable,true);assert.equal(result.authenticationChecked,false);
 const failed=await probeQwenConnection(env,async()=>{calls++;throw {cause:{code:'ENOTFOUND'}};});assert.equal(failed.code,'ENOTFOUND');assert.equal(calls,2);
 await probeQwenConnection({DASHSCOPE_BASE_URL:'https://127.0.0.1/v1'},()=>{throw Error('must not call');});
});
test('recognition preserves connection cause for the user without retrying or exposing secrets',async()=>{
 let calls=0;const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jz1cAAAAASUVORK5CYII=';
 await assert.rejects(analyzeQwen(image,{key:'fixture',fetcher:async()=>{calls++;throw new TypeError('secret',{cause:{code:'ECONNRESET'}});}}),e=>e.code==='network_error'&&e.message.includes('ECONNRESET')&&!e.message.includes('secret'));
 assert.equal(calls,1);
});
test('authenticated diagnostic is only a model catalog lookup and returns no credentials or provider messages',async()=>{
 let calls=0;const env={DASHSCOPE_API_KEY:'private-fixture',QWEN_VISION_MODEL:'vision-fixture'};
 const result=await probeQwenAuthentication(env,async(url,init)=>{calls++;assert.equal(init.method,'GET');assert.equal(new URL(url).pathname,'/api/v1/models');assert.equal(init.body,undefined);assert.equal(init.headers.Authorization,'Bearer private-fixture');return new Response(JSON.stringify({output:{models:[{model:'vision-fixture',capabilities:['VU']}]}}));});
 assert.equal(calls,1);assert.equal(result.modelAvailable,true);assert.equal(result.imageInput,true);assert.ok(!JSON.stringify(result).includes('private-fixture'));
 const denied=await probeQwenAuthentication(env,async()=>new Response(JSON.stringify({message:'private-fixture'}),{status:401}));assert.equal(denied.authenticationChecked,false);assert.ok(!JSON.stringify(denied).includes('private-fixture'));
});

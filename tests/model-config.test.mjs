import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {validateModel,endpoint,sealSecret,openSecret,checkEndpoint,modelConfiguration} from '../backend/server/model-config.mjs';
import {analyzeCompatible,reconstructCompatible} from '../backend/server/compatible-model.mjs';
const pair=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
test('model credentials are authenticated envelopes, including long keys, and cannot be opened or tampered with',()=>{
 const key='secret-'.repeat(300),sealed=sealSecret(key,pair.publicKey);assert.ok(!sealed.includes(key));assert.equal(openSecret(sealed,pair.privateKey),key);
 assert.equal(openSecret(sealed,pair.privateKey.replace(/\n/g,'\\n')),key);
 const tampered=JSON.parse(sealed);tampered.tag=Buffer.alloc(16).toString('base64');assert.throws(()=>openSecret(JSON.stringify(tampered),pair.privateKey));assert.throws(()=>openSecret(sealed,'invalid'));
});
test('compatible providers receive inventory prompts and both reference images, with no automatic retries',async()=>{
 const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jz1cAAAAASUVORK5CYII=';
 const config={name:'测试模型',key:'private-key',model:'vision-model',baseURL:'https://api.example.com/v1',resolver:async()=>[{address:'8.8.8.8'}]};
 let calls=0;const materials=Array.from({length:15},(_,i)=>({name:'材质'+i,category:'其他',kind:'重复纹理',description:'当前图像可见',confidence:0.6,sampleSuitable:false}));
 const result=await analyzeCompatible(image,config,{},async(url,init)=>{calls++;assert.equal(url,'https://api.example.com/v1/chat/completions');assert.equal(init.headers.Authorization,'Bearer private-key');assert.equal(init.redirect,'error');const body=JSON.parse(init.body);assert.ok(body.messages[0].content.includes('不设定候选数量上限'));return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({materials})}}]}));});assert.equal(result.materials.length,15);
 const png=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.writeUInt32BE(1024,16);png.writeUInt32BE(1024,20);
 const output=await reconstructCompatible({contextImage:image,image,description:'屋面',kind:'重复纹理'},{...config,model:'fixture-compatible-image'},async(url,init)=>{calls++;assert.ok(url.endsWith('/images/edits'));assert.equal(init.body.getAll('image[]').length,2);assert.equal(init.body.get('response_format'),'b64_json');assert.equal(init.body.get('output_format'),null);return new Response(JSON.stringify({data:[{b64_json:png.toString('base64')}]}));});assert.equal(output.width,1024);assert.equal(calls,2);
 await assert.rejects(analyzeCompatible(image,config,{},async()=>{calls++;return new Response('{}',{status:401});}));assert.equal(calls,3);
});
test('configuration rejects internal endpoints, wrong native paths and invalid model capabilities',async()=>{
 for(const x of ['http://api.example.com/v1','https://localhost/v1','https://127.0.0.1/v1','https://[::1]/v1','https://api.example.com:8443/v1','https://u:p@api.example.com/v1','https://api.example.com/v1?key=x'])assert.throws(()=>endpoint(x));
 const valid={kind:'recognition',protocol:'openai',name:'视觉识别',model:'vision-model',baseURL:'https://api.example.com/v1',apiKey:'secret'};assert.equal(validateModel(valid).model,'vision-model');assert.throws(()=>validateModel({...valid,kind:'text'}));assert.throws(()=>validateModel({...valid,protocol:'dashscope'}));
 for(const address of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.1.1','192.168.1.1','100.64.0.1','::1','::ffff:127.0.0.1'])await assert.rejects(checkEndpoint(valid.baseURL,async()=>[{address}]));
 await checkEndpoint(valid.baseURL,async()=>[{address:'8.8.8.8'}]);
});
test('cloud model resolution retains legacy default, pauses explicitly and decrypts only server side',async()=>{
 const auth={config:{url:'https://example.supabase.co',key:'publishable'},bearer:'Bearer token'};
 const fetcher=x=>async()=>new Response(JSON.stringify(x));
 const env={DASHSCOPE_API_KEY:'legacy',AI_MODEL_PRIVATE_KEY:pair.privateKey};assert.equal((await modelConfiguration(auth,'recognition',{env,fetcher:fetcher(null)})).key,'legacy');
 await assert.rejects(modelConfiguration(auth,'recognition',{env,fetcher:fetcher({disabled:true})}));
 const model={kind:'recognition',protocol:'openai',name:'模型',model:'vision',baseURL:'https://api.example.com/v1',secret:sealSecret('new-secret',pair.publicKey)};
 assert.equal((await modelConfiguration(auth,'recognition',{env,fetcher:fetcher(model)})).key,'new-secret');
 await assert.rejects(modelConfiguration(auth,'recognition',{env:{},fetcher:fetcher(model)}));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {validateModel} from '../backend/server/model-config.mjs';
import {recognizeLocalMaterial} from '../backend/server/local-material.mjs';
import {reconstructAdditional} from '../backend/server/multi-material.mjs';
import {materialProvider} from '../shared/material-providers.mjs';
const material={name:'红砖',category:'砖材',kind:'重复纹理',part:'墙面',description:'红色错缝砖',features:{surface:'颗粒'},risks:[],confidence:.8};
test('overseas vision protocols are rejected before any request is sent',async()=>{
 let calls=0;await assert.rejects(recognizeLocalMaterial(['original','mask','corrected'],{protocol:'fal-vision',baseURL:'https://fal.run',model:'openai/gpt-4o',key:'fixture',fetcher:async()=>{calls++;return Response.json({});}}),/不支持材质信息识别/);assert.equal(calls,0);
});
test('Doubao vision uses the official Ark chat route with bearer authentication',async()=>{
 const result=await recognizeLocalMaterial(['original','mask','corrected'],{protocol:'volcengine',baseURL:'https://ark.cn-beijing.volces.com/api/v3',model:'fixture-vision',key:'fixture',fetcher:async(url,options)=>{assert.ok(url.endsWith('/chat/completions'));assert.equal(options.headers.Authorization,'Bearer fixture');assert.equal(JSON.parse(options.body).messages[1].content.filter(x=>x.type==='image_url').length,3);return Response.json({id:'receipt',choices:[{finish_reason:'stop',message:{content:JSON.stringify(material)}}]});}});assert.equal(result.requestId,'receipt');
});
test('Ark reconstruction uses image editing rather than text-only generation and normalizes output PNG',async()=>{
 const png=await sharp({create:{width:64,height:64,channels:3,background:'#c98b65'}}).png().toBuffer(),image='data:image/png;base64,'+png.toString('base64');
 let calls=0;const result=await reconstructAdditional({image,referenceMode:'rectified-only',kind:'重复纹理',category:'砖材',part:'墙面'}, {protocol:'volcengine',baseURL:'https://ark.cn-beijing.volces.com/api/v3',model:'fixture-seedream',key:'fixture'},async(url,options)=>{calls++;const body=JSON.parse(options.body);assert.ok(url.endsWith('/images/generations'));assert.equal(body.image,image);assert.equal(body.response_format,'b64_json');return Response.json({data:[{b64_json:png.toString('base64')}]});});assert.equal(calls,1);assert.equal(result.width,64);assert.ok(result.image.startsWith('data:image/png;'));
});
test('provider validation accepts domestic channels and rejects overseas ones',()=>{
 for(const [kind,protocol,model,baseURL] of [['recognition','dashscope','qwen3.8-max','https://dashscope.aliyuncs.com/compatible-mode/v1'],['discovery','dashscope','qwen3.8-max','https://dashscope.aliyuncs.com/compatible-mode/v1'],['recognition','volcengine','fixture','https://ark.cn-beijing.volces.com/api/v3']])assert.ok(validateModel({name:'fixture',kind,protocol,model,baseURL}).protocol);
 assert.throws(()=>validateModel({name:'bad',kind:'recognition',protocol:'volcengine',model:'x',baseURL:'https://example.com'}));
 for(const [kind,protocol,baseURL] of [['reconstruction','fal','https://fal.run'],['recognition','fal-vision','https://fal.run'],['recognition','gemini','https://generativelanguage.googleapis.com'],['recognition','anthropic','https://api.anthropic.com']])assert.throws(()=>validateModel({name:'gone',kind,protocol,model:'openai/gpt-image-2/edit',baseURL}));
 assert.equal(materialProvider({protocol:'volcengine',model:'fixture'}),'volcengine');assert.equal(materialProvider({protocol:'openai',model:'deepseek-chat'}),'openai');assert.equal(materialProvider({protocol:'fal-vision',model:'openai/gpt-4o'}),null);
});
test('a failed paid request is never retried automatically',async()=>{let calls=0;await assert.rejects(reconstructAdditional({image:'fixture',referenceMode:'rectified-only',kind:'重复纹理',category:'砖材',part:'墙面'},{protocol:'volcengine',baseURL:'https://ark.cn-beijing.volces.com/api/v3',model:'fixture',key:'fixture'},async()=>{calls++;return Response.json({error:'denied'},{status:403});}),/403/);assert.equal(calls,1);});

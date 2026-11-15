import test from 'node:test';
import assert from 'node:assert/strict';
import {downloadQwenCandidate} from '../backend/server/qwen-image.mjs';
const body={output:{choices:[{message:{content:[{image:'https://dashscope-test.oss-cn-beijing.aliyuncs.com/output.png'}]}}]}};
const png=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.write('IHDR',12);png.writeUInt32BE(1024,16);png.writeUInt32BE(1024,20);
test('download retries GET only and recovers a transient failure',async()=>{let calls=0;const result=await downloadQwenCandidate(body,{downloadRetryDelay:async()=>{},fetcher:async(url,init)=>{assert.equal(init.body,undefined);assert.equal(init.headers,undefined);if(++calls===1)throw Error('offline');return new Response(png);}});assert.equal(calls,2);assert.equal(result.width,1024);});
test('download recovery is bounded',async()=>{let calls=0;await assert.rejects(downloadQwenCandidate(body,{downloadRetryDelay:async()=>{},fetcher:async()=>{calls++;throw Error('offline');}}),{code:'download_failed'});assert.equal(calls,3);});
test('untrusted image host is never fetched',async()=>{let calls=0;await assert.rejects(downloadQwenCandidate({output:{choices:[{message:{content:[{image:'https://example.com/x'}]}}]}},{fetcher:async()=>{calls++;}}),{code:'invalid_output'});assert.equal(calls,0);});

import {request as httpRequest} from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import {adminRequestAllowed,createLocalAdminServer} from '../backend/local/admin.mjs';
test('admin permits only direct loopback with exact host and same origin',()=>{
 const req={socket:{remoteAddress:'127.0.0.1'},headers:{host:'127.0.0.1:4193'}};
 assert.equal(adminRequestAllowed(req),true);
 for(const patch of [{host:'evil.example:4193'},{origin:'http://127.0.0.1:4173'},{'sec-fetch-site':'cross-site'}])assert.equal(adminRequestAllowed({...req,headers:{...req.headers,...patch}}),false);
 assert.equal(adminRequestAllowed({...req,socket:{remoteAddress:'192.168.1.2'},headers:{...req.headers,'x-forwarded-for':'127.0.0.1'}}),false);
});
test('admin mutations require private session, exact origin and CSRF',async t=>{
 let mutations=0;const service={token:'internal-only',store:{all:()=>[]},handleAdmin:async req=>{if(req.method==='POST')mutations++;assert.equal(req.headers.get('authorization'),'Bearer internal-only');return Response.json({models:[]});}};
 const fetch=(url,options={})=>new Promise((resolve,reject)=>{const req=httpRequest(url,{method:options.method||'GET',headers:options.headers},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode,headers:{get:name=>{const v=res.headers[name];return Array.isArray(v)?v.join(';'):v;}},text:async()=>body}));});req.on('error',reject);req.end(options.body);});
 const server=createLocalAdminServer(service);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const base='http://127.0.0.1:'+server.address().port,host={Host:'127.0.0.1:4193'};
 assert.equal((await fetch(base+'/api/models',{headers:host})).status,401);
 const home=await fetch(base+'/',{headers:host});assert.equal(home.status,200);const cookie=home.headers.get('set-cookie').split(';')[0],html=await home.text(),csrf=html.match(/const csrf='([^']+)'/)[1];assert.ok(!html.includes('internal-only'));
 const headers={...host,Cookie:cookie,'Content-Type':'application/json'};
 assert.equal((await fetch(base+'/api/models',{method:'POST',headers,body:'{}'})).status,403);
 assert.equal((await fetch(base+'/api/models',{method:'POST',headers:{...headers,Origin:'http://evil.example','X-Admin-CSRF':csrf},body:'{}'})).status,403);
 assert.equal((await fetch(base+'/api/models',{method:'POST',headers:{...headers,Origin:'http://127.0.0.1:4193','X-Admin-CSRF':csrf},body:'{}'})).status,200);
 assert.equal(mutations,1);
});

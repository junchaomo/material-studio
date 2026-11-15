import {authorize,json,fail} from '../server/cloud-auth.mjs';
import {checkout,portal,buyPack,billingReady,commercialPaymentsEnabled} from '../server/billing.mjs';
export default async function handler(req,res){try{
 const auth=await authorize(req,{paid:false});
 if(req.method==='GET')return json(res,200,{ready:billingReady(),paused:!commercialPaymentsEnabled()});
 if(req.method!=='POST')return json(res,405,{error:'请使用 GET 或 POST。'});
 if(!commercialPaymentsEnabled())return json(res,403,{error:'付费功能已暂停，暂不提供订阅、试用续费或付费额度包。',code:'commerce_paused'});
 if(req.body?.action==='checkout'){
  if(req.body.renewalConsent!==true)return json(res,400,{error:'请先确认试用与自动续费规则。'});
  return json(res,200,await checkout(auth));
 }
 if(req.body?.action==='portal')return json(res,200,await portal(auth));
 if(req.body?.action==='pack')return json(res,200,await buyPack(auth));
 return json(res,400,{error:'不支持的操作。'});
}catch(e){fail(res,e);}}

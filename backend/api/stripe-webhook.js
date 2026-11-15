import {json,fail} from '../server/cloud-auth.mjs';
import {readWebhook,verifyWebhook,processEvent,billingReady} from '../server/billing.mjs';
export const config={api:{bodyParser:false}};
export default async function handler(req,res){try{
 if(req.method!=='POST')return json(res,405,{error:'请使用 POST。'});
 if(!billingReady())return json(res,503,{error:'支付通知服务尚未配置。'});
 const event=verifyWebhook(await readWebhook(req),req.headers['stripe-signature'],process.env.STRIPE_WEBHOOK_SECRET);
 await processEvent(event);json(res,200,{received:true});
}catch(e){fail(res,e);}}

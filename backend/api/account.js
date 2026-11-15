import {authorize,json,fail} from '../server/cloud-auth.mjs';
import {memberRPC} from '../server/membership.mjs';
import {billingReady,addonReady} from '../server/billing.mjs';
export default async function handler(req,res){try{
 const auth=await authorize(req,{paid:false});
 if(req.method==='GET')return json(res,200,{email:auth.user.email,createdAt:auth.user.created_at,paymentReady:billingReady(),addonReady:addonReady(),...await memberRPC(auth,'get_member_account')});
 if(req.method!=='POST')return json(res,405,{error:'请使用 GET 或 POST。'});
 if(req.body?.action==='profile'){
  const name=String(req.body.displayName||'').trim();if(name.length<1||name.length>40)return json(res,400,{error:'昵称需要 1–40 个字符。'});
  await memberRPC(auth,'save_member_profile',{new_display_name:name});
 }else if(req.body?.action==='request')await memberRPC(auth,'request_membership');
 else return json(res,400,{error:'不支持的操作。'});
 json(res,200,{email:auth.user.email,createdAt:auth.user.created_at,paymentReady:billingReady(),addonReady:addonReady(),...await memberRPC(auth,'get_member_account')});
}catch(e){fail(res,e);}}

import {authorize,json,fail} from '../server/cloud-auth.mjs';
import {memberRPC} from '../server/membership.mjs';
import {validateFeedback} from '../server/feedback.mjs';
export default async function handler(req,res){try{const auth=await authorize(req,{paid:false});if(req.method==='GET')return json(res,200,await memberRPC(auth,'list_my_feedback'));if(req.method!=='POST')return json(res,405,{error:'请使用 GET 或 POST。'});const body=validateFeedback(req.body);try{const id=await memberRPC(auth,'submit_feedback',body);json(res,200,{id,saved:true});}catch(e){if(e.status===403)e.message='每天最多提交 5 条反馈，请稍后再试。';throw e;}}catch(e){fail(res,e);}}

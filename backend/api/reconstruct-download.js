import {authorize,json,fail} from '../server/cloud-auth.mjs';
import {receiptStore} from '../server/cloud-receipts.mjs';
import {downloadQwenCandidate} from '../server/qwen-image.mjs';
export default async function handler(req,res){try{if(req.method!=='POST')return json(res,405,{error:'请使用 POST。'});const auth=await authorize(req,{paid:false}),receiptId=req.body.receiptId,saved=await receiptStore(auth,null,receiptId);json(res,200,{...await downloadQwenCandidate(saved.body,{model:saved.model}),receiptId});}catch(e){fail(res,e);}}

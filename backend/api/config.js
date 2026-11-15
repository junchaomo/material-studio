import {authConfig,json} from '../server/cloud-auth.mjs';
export default function handler(req,res){try{const c=authConfig();json(res,200,{configured:!!c,url:c?.url,publishableKey:c?.key});}catch{json(res,503,{configured:false,error:'用户系统配置异常。'});}}

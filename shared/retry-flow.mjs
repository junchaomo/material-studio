/** @param {(state: any) => void} [notify] */
export function createRetryFlow(notify=()=>{}){
 let state={request:null,busy:false,error:''};const publish=next=>{state=next;notify(state);};
 return {get state(){return state;},open(request){if(state.request)return false;if(!request?.subject||typeof request.onRetry!=='function')throw Error('重试请求缺少任务或处理函数。');publish({request,busy:false,error:''});return true;},cancel(){if(state.busy)return false;publish({request:null,busy:false,error:''});return true;},async confirm(){if(!state.request||state.busy)return false;const request=state.request;publish({request,busy:true,error:''});try{await request.onRetry();publish({request:null,busy:false,error:''});return true;}catch(e){publish({request,busy:false,error:e instanceof Error?e.message:'重试提交失败，请检查后再试。'});return false;}}};
}

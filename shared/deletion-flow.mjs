// Shared deletion workflow: callers supply the business operation, never run it before confirmation.
/** @param {(state: any) => void} [notify] */
export function createDeletionFlow(notify=()=>{}){
 let state={request:null,busy:false,error:''};
 const publish=next=>{state=next;notify(state);};
 return {
  get state(){return state;},
  open(request){if(state.request)return false;if(!request?.subject||typeof request.onDelete!=='function')throw Error('删除请求缺少对象或处理函数。');publish({request,busy:false,error:''});return true;},
  cancel(){if(state.busy)return false;publish({request:null,busy:false,error:''});return true;},
  async confirm(typed=''){
   if(!state.request||state.busy)return false;
   const request=state.request;if(request.mode==='permanent'&&typed!==request.subject)return false;
   publish({...state,busy:true,error:''});
   try{await request.onDelete();publish({request:null,busy:false,error:''});return true;}
   catch(e){publish({request,busy:false,error:e instanceof Error?e.message:'删除未完成，请重试。'});return false;}
  }
 };
}

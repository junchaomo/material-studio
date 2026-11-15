// One channel per changed tile; no full RGBA snapshot per brush movement.
export class MaskHistory {
 constructor(width,height,read,write){this.width=width;this.height=height;this.read=read;this.write=write;this.past=[];this.future=[];this.pending=new Map();}
 begin(){this.commit();this.pending=new Map();}
 capture(x,y,w,h){const size=128;const left=Math.max(0,Math.floor(x/size)*size),top=Math.max(0,Math.floor(y/size)*size),right=Math.min(this.width,Math.ceil(x+w)),bottom=Math.min(this.height,Math.ceil(y+h));for(let yy=top;yy<bottom;yy+=size)for(let xx=left;xx<right;xx+=size){const key=xx+':'+yy;if(this.pending.has(key))continue;const tw=Math.min(size,this.width-xx),th=Math.min(size,this.height-yy);this.pending.set(key,{x:xx,y:yy,w:tw,h:th,data:this.read(xx,yy,tw,th)});}}
 commit(){if(!this.pending.size)return;this.past.push([...this.pending.values()]);if(this.past.length>20)this.past.shift();this.future=[];this.pending.clear();}
 undo(redo=false){this.commit();const from=redo?this.future:this.past,to=redo?this.past:this.future,patches=from.pop();if(!patches)return false;const inverse=patches.map(p=>({...p,data:this.read(p.x,p.y,p.w,p.h)}));for(const p of patches)this.write(p);to.push(inverse);return true;}
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {MaskHistory} from '../shared/mask-history.mjs';
import {stageView} from '../shared/workflow-ui.mjs';
test('mask tile history restores overlapping strokes and clears redo after new edit',()=>{
 const w=300,h=260,a=new Uint8Array(w*h);
 const read=(x,y,ww,hh)=>Uint8Array.from({length:ww*hh},(_,i)=>a[(y+Math.floor(i/ww))*w+x+i%ww]);
 const write=p=>{for(let i=0;i<p.data.length;i++)a[(p.y+Math.floor(i/p.w))*w+p.x+i%p.w]=p.data[i];};
 const history=new MaskHistory(w,h,read,write);
 history.begin();history.capture(5,5,10,10);a[5*w+5]=255;history.capture(5,5,10,10);history.commit();
 assert.equal(history.past[0].length,1);assert.equal(history.past[0][0].data.length,128*128);
 history.begin();history.capture(5,5,10,10);a[5*w+5]=100;history.commit();
 history.undo();assert.equal(a[5*w+5],255);history.undo();assert.equal(a[5*w+5],0);
 history.undo(true);assert.equal(a[5*w+5],255);
 history.begin();history.capture(299,259,20,20);a[w*h-1]=42;history.commit();
 assert.equal(history.future.length,0);history.undo();assert.equal(a[w*h-1],0);assert.equal(a[5*w+5],255);
});
test('workflow previews follow stage with unavailable outputs falling back safely',()=>{
 for(const stage of [0,1,2])assert.equal(stageView(stage,true,true),'source');
 assert.equal(stageView(3,true,true),'rectified');assert.equal(stageView(4,true,true),'diffuse');
 assert.equal(stageView(5,true,false),'rectified');assert.equal(stageView(3,false,false),'source');
});

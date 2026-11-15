'use client';
import {useEffect,useState} from 'react';
import {imagePreview} from '../lib/image-preview.ts';
import {imageIdentity} from '../../shared/image-identity.mjs';
export function useProjectImageState(url:string){
 const key=imageIdentity(url);
 const [loaded,setLoaded]=useState<{key:string;image:HTMLImageElement;full:boolean}|null>(null);
 const [failure,setFailure]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  let alive=true,fullStarted=false,hasImage=false;
  if(!url)return;
  const full=new Image(),preview=new Image();full.crossOrigin=preview.crossOrigin='anonymous';
  const fail=()=>{if(alive&&!hasImage)setFailure(key);};
  const show=(image:HTMLImageElement,isFull:boolean)=>{
   if(!alive)return;hasImage=true;setFailure('');
   setLoaded(old=>old&&old.key===key&&old.full&&!isFull?old:{key,image,full:isFull});
  };
  const startFull=()=>{if(alive&&!fullStarted){fullStarted=true;full.src=url;}};
  full.onload=()=>show(full,true);full.onerror=fail;
  preview.onload=()=>{show(preview,false);startFull();};preview.onerror=startFull;
  const fallback=setTimeout(startFull,8000),deadline=setTimeout(fail,45000);
  preview.src=imagePreview(url,1920)||url;
  return()=>{alive=false;clearTimeout(fallback);clearTimeout(deadline);full.onload=null;full.onerror=null;preview.onload=null;preview.onerror=null;};
 },[url,key,attempt]);
 const image=url&&loaded&&loaded.key===key?loaded.image:null;
 return {image,error:!!url&&!image&&failure===key,retry:()=>{setFailure('');setAttempt(n=>n+1);}};
}
export function useProjectImage(url:string){return useProjectImageState(url).image;}

'use client';
import {useEffect,useState} from 'react';
export function useModelPreference(kind:string,scope:string){
 const [id,setId]=useState('');
 useEffect(()=>{try{setId(localStorage.getItem('qmx-model:'+scope+':'+kind)||'');}catch{}},[kind,scope]);
 function choose(value:string){setId(value);try{localStorage.setItem('qmx-model:'+scope+':'+kind,value);}catch{}}
 return [id,choose] as const;
}

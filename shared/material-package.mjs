// ZIP STORE: PNG files are already compressed. UTF-8 filenames and CRC32.
export function materialPackageEntries(materials,assets){
 const ready=materials.filter(m=>m.confirmed);
 if(!ready.length)throw Error('请先确认至少一张 Diffuse 入库。');
 return ready.map(m=>{const a=assets.find(a=>a.id===m.asset_id);if(!a?.url)throw Error('已确认贴图尚未加载完整，请刷新后再下载。');return {material:m,asset:a,path:'textures/'+m.id+'_Diffuse.png'};});
}
export function zipArchive(files){
 const enc=new TextEncoder(),parts=[],central=[],names=new Set();let offset=0;
 const table=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
 for(const file of files){
  if(names.has(file.name)||file.name.startsWith('/')||file.name.includes('..')||file.name.includes('\\'))throw Error('资源包文件名无效。');names.add(file.name);
  const name=enc.encode(file.name),data=typeof file.data==='string'?enc.encode(file.data):file.data;
  if(!(data instanceof Uint8Array)||name.length>65535||data.length>0xffffffff)throw Error('资源包文件无效。');
  let crc=0xffffffff;for(const b of data)crc=table[(crc^b)&255]^(crc>>>8);crc=(crc^0xffffffff)>>>0;
  const local=new Uint8Array(30+name.length),v=new DataView(local.buffer);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,0x5821,true);v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,name.length,true);local.set(name,30);parts.push(local,data);
  const cd=new Uint8Array(46+name.length),d=new DataView(cd.buffer);d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint16(14,0x5821,true);d.setUint32(16,crc,true);d.setUint32(20,data.length,true);d.setUint32(24,data.length,true);d.setUint16(28,name.length,true);d.setUint32(42,offset,true);cd.set(name,46);central.push(cd);offset+=local.length+data.length;
 }
 const size=central.reduce((n,p)=>n+p.length,0);
 if(files.length>65535||offset+size>0xffffffff)throw Error('资源包过大，请分批下载。');
 const end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);v.setUint32(12,size,true);v.setUint32(16,offset,true);
 return new Blob([...parts,...central,end],{type:'application/zip'});
}

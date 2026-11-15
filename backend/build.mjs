import {stripTypeScriptTypes} from 'node:module';
import {readdir,readFile,writeFile,mkdir,rm,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const backend=path.resolve(fileURLToPath(new URL('.',import.meta.url))),root=path.dirname(backend),out=path.join(backend,'dist');
// dist is generated output inside this backend, never project data or environment files.
if(path.dirname(out)!==backend)throw Error('Invalid build directory');
await rm(out,{recursive:true,force:true});
const exclude=new Set(['local-data','dist','node_modules','.local','__pycache__','.venv']);
async function visit(dir){for(const entry of await readdir(dir,{withFileTypes:true})){
 if(exclude.has(entry.name)||entry.name.startsWith('.env'))continue;
 const source=path.join(dir,entry.name);
 if(entry.isDirectory()){await visit(source);continue;}
 if(!/\.(ts|mjs|js|json|ps1|html|css)$/.test(entry.name)||source===fileURLToPath(import.meta.url)||entry.name==='package-lock.json'||entry.name==='tsconfig.json')continue;
 const relative=path.relative(root,source),dest=path.join(out,relative.replace(/\.ts$/,'.js'));await mkdir(path.dirname(dest),{recursive:true});
 if(/\.(ts|mjs|js)$/.test(source)){
  let text=await readFile(source,'utf8');
  if(source.endsWith('.ts'))text=stripTypeScriptTypes(text,{mode:'strip',sourceUrl:source});
  text=text.replace(/((?:from\s*|import\s*|import\(\s*)['"]\.[^'"]+)\.ts(['"])/g,'$1.js$2');
  // TypeScript keeps extensionless local module imports; Node ESM requires explicit extensions.
  text=text.replace(/((?:from\s*|import\s*)['"])(\.[^'"]+)(['"])/g,(all,a,spec,z)=>path.extname(spec)?all:a+spec+'.js'+z);
  await writeFile(dest,text);
 }else await copyFile(source,dest);
}}
await visit(backend);await visit(path.join(root,'shared'));
await writeFile(path.join(out,'package.json'),JSON.stringify({type:'module'}));
console.log('Independent backend compiled; no Next.js dependency or secrets copied.');

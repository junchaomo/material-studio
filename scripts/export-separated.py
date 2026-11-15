from pathlib import Path
import json,zipfile,os
root=Path(__file__).resolve().parent.parent
archive=root.parent/'qimingxing-separated-source.zip'
excluded={'local-data','node_modules','.next','.local','.venv','.git','.vercel','__pycache__','outputs','dist','.run'}
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
 for directory,dirs,files in os.walk(root):
  dirs[:]=[d for d in dirs if d not in excluded]
  for name in files:
   p=Path(directory)/name
   if name.startswith('.env') and name!='.env.example':continue
   if name=='model-secret.key' or name.startswith('studio.sqlite') or name=='.instance-lock':continue
   if p.suffix in {'.log','.pyc','.tsbuildinfo','.zip'} or name=='.source-version.json':continue
   z.write(p,Path('qimingxing-studio')/p.relative_to(root))
with zipfile.ZipFile(archive) as z:
 assert z.testzip() is None
 assert not any('/local-data/' in n or n.endswith('/model-secret.key') or n.endswith('/studio.sqlite') for n in z.namelist())
 assert not any('/.env' in n and not n.endswith('/.env.example') for n in z.namelist())
 print(json.dumps({'archive':str(archive),'files':len(z.infolist()),'bytes':archive.stat().st_size}))

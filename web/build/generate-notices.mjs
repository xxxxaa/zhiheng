import fs from 'node:fs';
import path from 'node:path';

const lock=JSON.parse(fs.readFileSync('package-lock.json','utf8'));
const rows=[],texts=[];
for(const [dir,entry] of Object.entries(lock.packages)){
  if(!dir||entry.dev||entry.link||!dir.includes('node_modules/'))continue;
  const manifest=path.join(dir,'package.json');
  if(!fs.existsSync(manifest))continue;
  const pkg=JSON.parse(fs.readFileSync(manifest,'utf8'));
  const licenses=fs.readdirSync(dir).filter(n=>/^(licen[cs]e|copying|notice)(\.|$)/i.test(n)&&fs.statSync(path.join(dir,n)).isFile());
  if(!licenses.length)throw new Error(`Missing license for ${pkg.name}`);
  rows.push(`| ${pkg.name} | ${pkg.version} | ${pkg.license||entry.license||'See license'} |`);
  const destination=path.join('licenses',pkg.name.replaceAll('/','__'));
  fs.mkdirSync(destination,{recursive:true});
  for(const file of licenses){const text=fs.readFileSync(path.join(dir,file),'utf8');fs.writeFileSync(path.join(destination,file),text);texts.push(`\n## ${pkg.name} ${pkg.version} / ${file}\n\n${text}`);}
}
const header='# Runtime dependency notices\n\nFull license texts are included below and under licenses/. No Wealthfolio or ezBookkeeping implementation code is incorporated.\n\n| Package | Version | License |\n| --- | --- | --- |\n';
const native=fs.existsSync('licenses/native/NOTICES.txt')?fs.readFileSync('licenses/native/NOTICES.txt','utf8'):'';
fs.writeFileSync('THIRD_PARTY_NOTICES.md',header+rows.sort().join('\n')+'\n\n'+native);
fs.writeFileSync('public/third-party-notices.txt',header+rows.sort().join('\n')+'\n\n'+native+texts.join('\n'));
console.log(`Collected licenses for ${rows.length} runtime packages`);

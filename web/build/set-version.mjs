import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const [version,build]=process.argv.slice(2);
if(!/^\d+\.\d+\.\d+$/.test(version||'')||!/^\d+$/.test(build||''))throw Error('Usage: npm run version:android -- 0.1.3 4');
const configPath=path.join(root,'release/android.json');
const config=JSON.parse(fs.readFileSync(configPath));
if(Number(build)<=config.versionCode||Number(build)>2100000000)throw Error('versionCode 必须递增且不超过 Android 上限');
config.version=version;config.versionCode=Number(build);fs.writeFileSync(configPath,JSON.stringify(config,null,2)+'\n');
for(const relative of ['web/package.json','web/package-lock.json']){const p=path.join(root,relative),d=JSON.parse(fs.readFileSync(p));d.version=version;if(d.packages)d.packages[''].version=version;fs.writeFileSync(p,JSON.stringify(d,null,2)+'\n');}
const gradle=path.join(root,'web/android/app/build.gradle');fs.writeFileSync(gradle,fs.readFileSync(gradle,'utf8').replace(/versionCode \d+/,`versionCode ${build}`).replace(/versionName "[^"]+"/,`versionName "${version}"`));
console.log(`Android ${version} (${build})；请补充 release/notes/v${version}.md`);

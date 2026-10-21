import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const web=path.join(root,'web');
const config=JSON.parse(fs.readFileSync(path.join(root,'release/android.json')));
const publish=process.argv.includes('--publish');
const publishOnly=process.argv.includes('--publish-only');
if(process.argv.slice(2).some(arg=>!['--publish','--publish-only'].includes(arg)))throw Error('Supported flags: --publish or --publish-only');
if(!/^\d+\.\d+\.\d+$/.test(config.version)||!Number.isInteger(config.versionCode)||config.versionCode<1)throw Error('Invalid release version');
const tag=`v${config.version}`,asset=`zhiheng-${config.version}-android.apk`;
const artifactDir=path.join(root,'artifacts'),apk=path.join(artifactDir,asset);
const provenance=path.join(artifactDir,`${asset}.build.json`);
const notesSource=path.join(root,'release/notes',`${tag}.md`);
const notes=fs.readFileSync(notesSource,'utf8');
if(notes.includes('zhiheng-update:'))throw Error('Release notes must not contain machine metadata');
const env={...process.env};
const sdk=env.ANDROID_HOME||env.ANDROID_SDK_ROOT;
if(!sdk)throw Error('Set ANDROID_HOME to your Android SDK');
const tool=name=>path.join(sdk,'build-tools/36.0.0',name);
function run(command,args,cwd=root,quiet=false){const result=spawnSync(command,args,{cwd,env,encoding:'utf8',stdio:quiet?['ignore','pipe','pipe']:'inherit'});if(result.status!==0)throw Error(`${command} failed (${result.status})${quiet?`: ${result.stderr?.trim()}`:''}`);return result.stdout?.trim()||'';}
function output(command,args,cwd=root){return run(command,args,cwd,true);}
const gradleSource=fs.readFileSync(path.join(web,'android/app/build.gradle'),'utf8');
if(!gradleSource.includes(`versionCode ${config.versionCode}`)||!gradleSource.includes(`versionName "${config.version}"`)||JSON.parse(fs.readFileSync(path.join(web,'package.json'))).version!==config.version)throw Error('release/android.json, package.json and Gradle versions must match');
if(publish||publishOnly){
  if(output('git',['status','--porcelain']))throw Error('Commit all source changes before publishing');
  const remote=output('git',['remote','get-url','origin']);
  if(![`https://github.com/${config.repository}.git`,`git@github.com:${config.repository}.git`].includes(remote))throw Error('Unexpected GitHub remote');
  const releaseQuery=spawnSync('gh',['api',`repos/${config.repository}/releases/tags/${tag}`],{cwd:root,env,encoding:'utf8'});
  if(releaseQuery.status===0)throw Error('This release already exists; never overwrite a published APK');
  if(!releaseQuery.stderr?.includes('HTTP 404'))throw Error('Cannot verify existing GitHub release');
}
fs.mkdirSync(artifactDir,{recursive:true});
if(!publishOnly){
  const keystore=env.ANDROID_SIGNING_KEYSTORE||path.join(root,'.mobile-tools/signing/zhiheng-compat.keystore');
  if(!fs.existsSync(keystore))throw Error('Original signing key missing. Restore it privately; do not generate a replacement key for existing installs.');
  env.ZHIHENG_STORE_PASSWORD=env.ANDROID_SIGNING_STORE_PASSWORD||'android';
  env.ZHIHENG_KEY_PASSWORD=env.ANDROID_SIGNING_KEY_PASSWORD||'android';
  run('npm',['test'],web);run('npm',['run','mobile:sync'],web);
  run(env.GRADLE_BIN||path.join(web,'android/gradlew'),['-p',path.join(web,'android'),'assembleRelease','--no-daemon','--console=plain']);
  const unsigned=path.join(web,'android/app/build/outputs/apk/release/app-release-unsigned.apk');
  const aligned=path.join(artifactDir,`.${asset}.aligned`);
  try{
    run(tool('zipalign'),['-f','-p','4',unsigned,aligned]);
    run(tool('apksigner'),['sign','--ks',keystore,'--ks-key-alias',env.ANDROID_SIGNING_ALIAS||'androiddebugkey','--ks-pass','env:ZHIHENG_STORE_PASSWORD','--key-pass','env:ZHIHENG_KEY_PASSWORD','--out',apk,aligned]);
  }finally{fs.rmSync(aligned,{force:true});}
  const clean=!output('git',['status','--porcelain']);
  fs.writeFileSync(provenance,JSON.stringify({commit:clean?output('git',['rev-parse','HEAD']):null,sha256:crypto.createHash('sha256').update(fs.readFileSync(apk)).digest('hex')})+'\n');
}
const cert=output(tool('apksigner'),['verify','--print-certs',apk]);
if(!cert.includes(`certificate SHA-256 digest: ${config.signerSha256}`))throw Error('Signing certificate changed; refusing to publish an incompatible update');
const badging=output(tool('aapt'),['dump','badging',apk]);
if(!badging.includes(`name='${config.appId}' versionCode='${config.versionCode}' versionName='${config.version}'`)||!badging.includes(`sdkVersion:'${config.minSdk}'`)||badging.includes('application-debuggable'))throw Error('APK identity/version/system requirement or release build check failed');
const sha256=crypto.createHash('sha256').update(fs.readFileSync(apk)).digest('hex');
const meta={schema:1,appId:config.appId,version:config.version,versionCode:config.versionCode,minSdk:config.minSdk,asset,sha256,signerSha256:config.signerSha256};
const checksums=path.join(artifactDir,'SHA256SUMS.txt');
fs.writeFileSync(checksums,`${sha256}  ${asset}\n`);
const body=path.join(artifactDir,`release-${tag}.md`);
fs.writeFileSync(body,`${notes.trim()}\n\n<!-- zhiheng-update:v1\n${JSON.stringify(meta)}\n-->\n`);
console.log(JSON.stringify({apk,sha256,versionCode:config.versionCode},null,2));
if(publish||publishOnly){
  const head=output('git',['rev-parse','HEAD']);
  const built=JSON.parse(fs.readFileSync(provenance));
  if(built.commit!==head||built.sha256!==sha256)throw Error('APK was not built from this clean source commit; rebuild before publishing');
  const existing=spawnSync('git',['rev-parse','--verify',`refs/tags/${tag}^{commit}`],{cwd:root,encoding:'utf8'});
  if(existing.status===0&&existing.stdout.trim()!==head)throw Error('Tag points to another commit');
  if(existing.status!==0)run('git',['tag','-a',tag,'-m',`知衡 ${tag}`]);
  run('git',['push','origin','HEAD:main',`refs/tags/${tag}`]);
  run('gh',['release','create',tag,'--repo',config.repository,'--verify-tag','--draft','--title',`知衡 ${tag}`,'--notes-file',body,apk,checksums]);
  const release=JSON.parse(output('gh',['api',`repos/${config.repository}/releases/tags/${tag}`]));
  const remoteAsset=release.assets.find(item=>item.name===asset);
  if(!remoteAsset||remoteAsset.digest!==`sha256:${sha256}`)throw Error('Uploaded APK digest mismatch; release left as draft for inspection');
  run('gh',['release','edit',tag,'--repo',config.repository,'--draft=false','--latest']);
  console.log(`Published https://github.com/${config.repository}/releases/tag/${tag}`);
}

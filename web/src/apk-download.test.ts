import {describe,expect,it,vi} from 'vitest';
vi.mock('@capacitor/core',()=>({registerPlugin:vi.fn(()=>({}))}));
import {downloadBusy,downloadOptions,downloadPercent,emptyDownload,nextDownload} from './apk-download';
import type {AppRelease} from './updates';
describe('安装包下载状态',()=>{
  it('收到全部字节也不误报可安装，校验阶段与就绪状态分开',()=>{
    const full={...emptyDownload,total:100,received:100};
    expect(downloadPercent({...full,phase:'downloading'})).toBe(99);
    expect(downloadPercent({...full,phase:'verifying'})).toBe(100);
    expect(downloadBusy({...full,phase:'verifying'})).toBe(true);
    expect(downloadPercent({...full,phase:'ready'})).toBe(100);
    expect(downloadBusy({...full,phase:'ready'})).toBe(false);
  });
  it('旧轮询不能覆盖取消或完成后的新状态',()=>{
    const ready={...emptyDownload,phase:'ready' as const,revision:10};
    expect(nextDownload(ready,{...emptyDownload,revision:9})).toBe(ready);
    expect(nextDownload(ready,{...emptyDownload,phase:'cancelled',revision:11}).phase).toBe('cancelled');
  });
  it('失败与取消允许重试，连接与校验时不重复下载',()=>{
    for(const phase of ['cancelled','error','idle'] as const)expect(downloadBusy({...emptyDownload,phase})).toBe(false);
    for(const phase of ['connecting','downloading','cancelling','restoring'] as const)expect(downloadBusy({...emptyDownload,phase})).toBe(true);
  });
  it('只把校验元数据交给原生层，不接受任意下载地址和本机路径',()=>{
    const release={version:'0.1.5',versionCode:6,bytes:123,sha256:'a'.repeat(64),downloadUrl:'https://evil.example',notes:'ignored'} as AppRelease;
    expect(downloadOptions(release)).toEqual({version:'0.1.5',versionCode:6,bytes:123,sha256:'a'.repeat(64)});
  });
});

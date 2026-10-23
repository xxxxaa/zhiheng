import {z} from 'zod';
import {serviceFetch} from './transport';

export const UPDATE_REPO = 'xxxxaa/zhiheng';
export const RELEASES_URL = `https://github.com/${UPDATE_REPO}/releases`;
export const UPDATE_API = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;
export const UPDATE_MANIFEST = `https://raw.githubusercontent.com/${UPDATE_REPO}/main/release/latest.json`;
// Public certificate fingerprint, never the signing key. Retain the existing install's identity.
export const SIGNER_SHA256 = '0fb97ee5bf50a79946ee75f337bcc42b5f29471174473dd8c63718e459f0fa2b';
export const UPDATE_INTERVAL = 24 * 60 * 60 * 1000;
const version = z.string().regex(/^\d+\.\d+\.\d+$/);
const metadataSchema = z.object({
  schema: z.literal(1), appId: z.literal('app.zhiheng.assets'),
  version, versionCode: z.number().int().positive().max(2100000000),
  minSdk: z.number().int().positive(),
  asset: z.string().regex(/^zhiheng-\d+\.\d+\.\d+-android\.apk$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), signerSha256: z.literal(SIGNER_SHA256),
}).strict();
const releaseSchema = z.object({
  tag_name: z.string(), html_url: z.string(), body: z.string().max(100000),
  draft: z.boolean(), prerelease: z.boolean(), published_at: z.string(),
  assets: z.array(z.object({name: z.string(), browser_download_url: z.string(),
    state: z.string(), size: z.number().int().positive().max(200 * 1024 * 1024),
    digest: z.string().nullable().optional(),
  })).max(100),
});
export type AppRelease = z.infer<typeof metadataSchema> & {
  url: string; downloadUrl: string; notes: string; publishedAt: string; bytes: number;
};
export function parseCachedRelease(input: unknown): AppRelease {
  const cached = metadataSchema.extend({url:z.string(),downloadUrl:z.string(),notes:z.string().max(12000),publishedAt:z.string(),bytes:z.number()}).parse(input);
  const {url,downloadUrl,notes,publishedAt,bytes,...meta}=cached;
  return parseRelease({tag_name:`v${meta.version}`,html_url:url,body:`${notes}\n<!-- zhiheng-update:v1 ${JSON.stringify(meta)} -->`,draft:false,prerelease:false,published_at:publishedAt,
    assets:[{name:meta.asset,browser_download_url:downloadUrl,state:'uploaded',size:bytes,digest:`sha256:${meta.sha256}`}]});
}
export function parseRelease(input: unknown): AppRelease {
  const release = releaseSchema.parse(input);
  if (release.draft || release.prerelease) throw new Error('更新源不是公开正式发布');
  const markers = [...release.body.matchAll(/<!-- zhiheng-update:v1\s*([\s\S]*?)\s*-->/g)];
  if (markers.length !== 1) throw new Error('新版缺少有效的更新说明，请稍后重试');
  const meta = metadataSchema.parse(JSON.parse(markers[0][1]));
  const tag = `v${meta.version}`;
  if (release.tag_name !== tag || meta.asset !== `zhiheng-${meta.version}-android.apk`)
    throw new Error('版本号与安装包不一致');
  // Version 1 of this update channel supports the same Android 7+ devices.
  if (meta.minSdk > 24) throw new Error('新版提高了系统要求，请在发布页核对后安装');
  const url = `${RELEASES_URL}/tag/${tag}`;
  const downloadUrl = `${RELEASES_URL}/download/${tag}/${meta.asset}`;
  const assets = release.assets.filter(asset => asset.name === meta.asset);
  const asset = assets[0];
  if (release.html_url !== url || assets.length !== 1 || asset.state !== 'uploaded' || asset.browser_download_url !== downloadUrl)
    throw new Error('安装包来源或上传状态不正确');
  if (asset.digest && asset.digest !== `sha256:${meta.sha256}`) throw new Error('安装包摘要与更新说明不一致');
  if (!Number.isFinite(Date.parse(release.published_at))) throw new Error('发布时间无效');
  return {...meta, url, downloadUrl, notes: release.body.replace(markers[0][0], '').trim().slice(0, 12000), publishedAt: release.published_at, bytes: asset.size};
}
export function isNewerRelease(release: AppRelease, installedBuild: string): boolean {
  if (!/^\d+$/.test(installedBuild) || !Number.isSafeInteger(Number(installedBuild)) || Number(installedBuild) < 1)
    throw new Error('无法读取当前安装版本，请在发布页检查更新');
  return release.versionCode > Number(installedBuild);
}
export function updateDue(lastAttempt: number, now = Date.now()) {
  return !Number.isFinite(lastAttempt) || lastAttempt <= 0 || lastAttempt > now || now - lastAttempt >= UPDATE_INTERVAL;
}
export async function fetchRelease(): Promise<AppRelease | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('检查更新超时，请稍后重试')), 20000);
  try {
    // Public static metadata avoids GitHub REST's shared-IP anonymous rate limit.
    const manifestUrl = new URL(UPDATE_MANIFEST);
    manifestUrl.searchParams.set('ts', String(Date.now()));
    let response = await serviceFetch(manifestUrl.href, {signal:controller.signal,credentials:'omit',cache:'no-store',headers:{Accept:'application/json','Cache-Control':'no-cache'}});
    if(response.status===404)response=await serviceFetch(UPDATE_API,{signal:controller.signal,credentials:'omit',headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}});
    if (response.status === 404) return null;
    if (response.status === 403 || response.status === 429) throw new Error('GitHub 暂时限制请求，请稍后重试或打开发布页');
    if (!response.ok) throw new Error(`检查更新失败（${response.status}）`);
    const text = await response.text();
    if (text.length > 500000) throw new Error('更新信息过大，请在发布页核对');
    return parseRelease(JSON.parse(text));
  } finally { clearTimeout(timer); }
}

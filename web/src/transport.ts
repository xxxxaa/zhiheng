import {checkAborted} from './abort';
import { CapacitorHttp } from '@capacitor/core';
import { isNative } from './native';

/** Explicit native transport; leave browser fetch and local asset loading untouched. */
export async function serviceFetch(input: string | Request, init?: RequestInit): Promise<Response> {
  if (!isNative()) return fetch(input, init);
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.protocol !== 'https:') throw new Error('手机 App 的服务连接需要 HTTPS');
  if (url.username || url.password) throw new Error('服务地址不能包含账号口令');
  checkAborted(request.signal);
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => { headers[key.toLowerCase() === 'content-type' ? 'Content-Type' : key] = value; });
  const data = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text();
  checkAborted(request.signal);
  // Native SDKs buffer the response. The existing backup reader still validates the 30 MB limit.
  // Cancellation discards late results; this bridge cannot cancel an already sent native request.
  const pending = CapacitorHttp.request({
    url: request.url, method: request.method, headers, data,
    responseType: 'text', disableRedirects: true, shouldEncodeUrlParams: false,
    connectTimeout: 45000, readTimeout: 120000,
  });
  const result = await new Promise<Awaited<typeof pending>>((resolve, reject) => {
    const abort = () => reject(request.signal.reason ?? new DOMException('已取消', 'AbortError'));
    request.signal.addEventListener('abort', abort, { once: true });
    pending.then(resolve, reject).finally(() => request.signal.removeEventListener('abort', abort));
    if (request.signal.aborted) abort();
  });
  checkAborted(request.signal);
  if (result.status >= 300 && result.status < 400) throw new Error('服务返回了重定向，请填写最终服务地址');
  if (result.status < 200 || result.status > 599) throw new Error('服务返回了无效状态');
  const text = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
  return new Response([204, 205, 304].includes(result.status) ? null : text, { status: result.status, headers: result.headers });
}

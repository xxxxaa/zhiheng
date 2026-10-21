/** Older supported WebViews do not yet provide AbortSignal.any/timeout. */
export function withTimeout(ms: number, parent?: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const cancel = () => controller.abort(parent?.reason ?? new DOMException('已取消', 'AbortError'));
  if (parent?.aborted) { cancel(); return controller.signal; }
  const timer = setTimeout(() => controller.abort(new DOMException('连接超时，请重试', 'TimeoutError')), ms);
  parent?.addEventListener('abort', cancel, {once:true});
  controller.signal.addEventListener('abort', () => { clearTimeout(timer); parent?.removeEventListener('abort', cancel); }, {once:true});
  return controller.signal;
}
export function checkAborted(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason ?? new DOMException('已取消', 'AbortError');
}

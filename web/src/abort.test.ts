import {afterEach,expect,it,vi} from 'vitest';
import {withTimeout,checkAborted} from './abort';
afterEach(()=>vi.useRealTimers());
it('兼容旧 WebView 的超时和手动取消',()=>{
 vi.useFakeTimers();const parent=new AbortController();const signal=withTimeout(1000,parent.signal);
 parent.abort();expect(signal.aborted).toBe(true);expect(()=>checkAborted(signal)).toThrow();expect(vi.getTimerCount()).toBe(0);
 const timed=withTimeout(1000);vi.advanceTimersByTime(1000);expect(timed.aborted).toBe(true);expect(timed.reason.name).toBe('TimeoutError');
});
it('已经取消的请求不会创建后台超时计时器',()=>{
 vi.useFakeTimers();const parent=new AbortController();parent.abort();expect(withTimeout(1000,parent.signal).aborted).toBe(true);expect(vi.getTimerCount()).toBe(0);
});

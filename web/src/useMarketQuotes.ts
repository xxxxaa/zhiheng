import {useState, useEffect, useRef, useCallback} from 'react';
import {useLiveQuery} from 'dexie-react-hooks';
import {db, getMeta, setMeta} from './db';
import {eligibleStock, syncMarketQuotes, type QuoteSyncStatus} from './quote-sync';
import type {QuoteRecords} from './quotes';

const emptyRecords: QuoteRecords = {};
export function useMarketQuotes(paused: boolean) {
  const automatic = useLiveQuery(() => getMeta('quotesAutomatic', false), []) === true;
  const status = useLiveQuery(() => getMeta<QuoteSyncStatus | null>('quoteSyncStatus', null), []) || null;
  const records = useLiveQuery(() => getMeta<QuoteRecords>('quoteRecords', emptyRecords), []) || emptyRecords;
  const stocks = useLiveQuery(async () => (await db.positions.toArray()).filter(position => eligibleStock(position)).map(position => `${position.id}:${position.code}:${position.quantity}`).sort().join('|'), []) || '';
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null), lastAttempt = useRef(0);
  const refresh = useCallback(async (manual = true) => {
    if (paused || document.hidden || controller.current) return;
    if (navigator.onLine === false) { if (manual) setError('当前离线，已保留原估值'); return; }
    const request = new AbortController();
    controller.current = request;
    lastAttempt.current = Date.now();
    setBusy(true); setError('');
    try { await syncMarketQuotes(request.signal, !manual); }
    catch (failure) { if (!request.signal.aborted) setError(failure instanceof Error ? failure.message : '行情更新失败，已保留原估值'); }
    finally { if (controller.current === request) { controller.current = null; setBusy(false); } }
  }, [paused]);
  const setAutomatic = async (enabled: boolean) => {
    if (!enabled) controller.current?.abort();
    try { await setMeta('quotesAutomatic', enabled); }
    catch { setError('无法保存行情偏好，请检查本机存储'); }
  };
  useEffect(() => {
    if (paused || !automatic || !stocks) return;
    lastAttempt.current = 0;
    const check = () => { if (!document.hidden && Date.now() - lastAttempt.current >= 60000) void refresh(false); };
    const visibility = () => { if (document.hidden) controller.current?.abort(); else check(); };
    const initial = setTimeout(check, 0);
    const timer = setInterval(check, 60000);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('online', check);
    window.addEventListener('focus', check);
    return () => { clearTimeout(initial); clearInterval(timer); controller.current?.abort(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('online', check); window.removeEventListener('focus', check); };
  }, [paused, automatic, stocks, refresh]);
  useEffect(() => {
    const pause = () => { if (document.hidden) controller.current?.abort(); };
    if (paused) controller.current?.abort();
    document.addEventListener('visibilitychange', pause);
    return () => { controller.current?.abort(); document.removeEventListener('visibilitychange', pause); };
  }, [paused]);
  return {automatic, status, records, busy, error, refresh, setAutomatic, cancel: () => controller.current?.abort()};
}
export type MarketQuotesState = ReturnType<typeof useMarketQuotes>;

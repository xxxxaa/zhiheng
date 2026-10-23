import Decimal from 'decimal.js';
import {serviceFetch} from './transport';
import {checkAborted} from './abort';
import type {Position} from './model';

export type StockSymbol = {code: string; market: 'SH' | 'SZ' | 'BJ'; secid: string};
export type MarketQuote = {symbol: StockSymbol; price: string; asOf: string; quotedAt: string; fetchedAt: string; provider: 'eastmoney-delay'};
export type QuoteRecord = {code: string; price: string; asOf: string; quotedAt: string; fetchedAt: string; provider: 'eastmoney-delay'};
export type QuoteRecords = Record<string, QuoteRecord>;
const SH = /^(600|601|603|605|688|689)\d{3}$/;
const SZ = /^(000|001|002|003|300|301)\d{3}$/;
const BJ = /^(43|83|87|88|92)\d{4}$/;

/** Only CNY A-shares: never infer foreign-currency stocks, indices or fund NAVs. */
export function stockSymbol(code: string): StockSymbol | null {
  const text = code.trim().toUpperCase();
  const match = /^(\d{6})(?:\.(SH|SZ|BJ))?$/.exec(text);
  if (!match) return null;
  const value = match[1];
  const inferred = SH.test(value) ? 'SH' : SZ.test(value) ? 'SZ' : BJ.test(value) ? 'BJ' : null;
  if (!inferred || (match[2] && match[2] !== inferred)) return null;
  return {code: value, market: inferred, secid: `${inferred === 'SH' ? 1 : 0}.${value}`};
}
export function quotedPosition(position: Position, record?: QuoteRecord): boolean {
  return Boolean(record && position.kind === 'stock' && position.code === record.code && position.price === record.price && position.asOf === record.asOf);
}
export function parseQuote(input: unknown, symbol: StockSymbol, now = new Date()): MarketQuote {
  const envelope = input as {rc?: unknown; data?: Record<string, unknown> | null};
  const data = envelope?.data;
  if (envelope?.rc !== 0 || !data || data.f57 !== symbol.code) throw new Error('行情代码不匹配或暂无数据');
  const raw = data.f43, precision = data.f59, seconds = data.f86;
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw <= 0 || typeof precision !== 'number' || !Number.isInteger(precision) || precision < 0 || precision > 8) throw new Error('行情价格或精度无效，已保留原估值');
  if (typeof seconds !== 'number' || !Number.isSafeInteger(seconds) || seconds < 946684800 || seconds * 1000 > now.getTime() + 300000) throw new Error('行情时间无效，已保留原估值');
  const price = new Decimal(raw).div(new Decimal(10).pow(precision)).toFixed();
  if (!/^\d{1,14}(\.\d{1,8})?$/.test(price)) throw new Error('行情价格超出账本支持范围');
  const quotedAt = new Date(seconds * 1000).toISOString();
  // Shanghai exchange dates use UTC+8, independent of the phone's timezone.
  const asOf = new Date(seconds * 1000 + 8 * 3600000).toISOString().slice(0, 10);
  return {symbol, price, asOf, quotedAt, fetchedAt: now.toISOString(), provider: 'eastmoney-delay'};
}
export async function fetchQuote(symbol: StockSymbol, parent: AbortSignal): Promise<MarketQuote> {
  checkAborted(parent);
  const controller = new AbortController();
  const abort = () => controller.abort(parent.reason);
  parent.addEventListener('abort', abort, {once: true});
  const timer = setTimeout(() => controller.abort(new DOMException('行情连接超时', 'TimeoutError')), 10000);
  try {
    const url = new URL('https://push2delay.eastmoney.com/api/qt/stock/get');
    url.search = new URLSearchParams({secid: symbol.secid, fields: 'f43,f57,f58,f59,f86', fltt: '1', invt: '2', _: String(Date.now())}).toString();
    const response = await serviceFetch(url.href, {method: 'GET', credentials: 'omit', cache: 'no-store', headers: {Accept: 'application/json'}, signal: controller.signal});
    checkAborted(controller.signal);
    if (!response.ok) throw new Error(`行情服务暂不可用（${response.status}）`);
    const text = await response.text();
    checkAborted(controller.signal);
    if (text.length > 100000) throw new Error('行情响应过大');
    let data: unknown;
    try { data = JSON.parse(text); } catch { throw new Error('行情服务返回了无效数据'); }
    return parseQuote(data, symbol);
  } finally {
    clearTimeout(timer);
    parent.removeEventListener('abort', abort);
  }
}

import 'fake-indexeddb/auto';
import {beforeEach, afterEach, describe, it, expect, vi} from 'vitest';
import {stockSymbol, parseQuote, fetchQuote, quotedPosition} from './quotes';
import {syncMarketQuotes} from './quote-sync';
import {serviceFetch} from './transport';
import {db, setMeta, getMeta, restoreData} from './db';
import {metrics, defaultProfile, makeBundle, type Position} from './model';
vi.mock('./transport', () => ({serviceFetch: vi.fn()}));

const account = {id: 'a', name: '合成测试账户', platform: '东方财富' as const};
const base: Position = {id: 'stock', accountId: 'a', name: '合成持仓', kind: 'stock', code: '600000.SH', quantity: '100', price: '8', cost: '800', asOf: '2020-01-01', fundType: 'unknown', maturity: '', rate: null};
const data = (override: Record<string, unknown> = {}) => ({rc: 0, data: {f43: 958, f57: '600000', f59: 2, f86: Math.floor(Date.now() / 1000), ...override}});
const response = (override: Record<string, unknown> = {}) => Response.json(data(override));
beforeEach(async () => {
  vi.mocked(serviceFetch).mockReset();
  await Promise.all([db.accounts.clear(), db.positions.clear(), db.snapshots.clear(), db.reports.clear(), db.meta.clear()]);
  await db.accounts.add(account);
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('行情适配与金额精度', () => {
  it('识别沪深北 A 股，拒绝错市场、B 股、港美股、ETF 和指数', () => {
    expect(stockSymbol('600000.sh')?.secid).toBe('1.600000');
    expect(stockSymbol('000001.SZ')?.secid).toBe('0.000001');
    expect(stockSymbol('920001.BJ')?.secid).toBe('0.920001');
    expect(stockSymbol('831234')?.market).toBe('BJ');
    for (const code of ['600000.SZ', '000001.SH', '900901.SH', '200001.SZ', '00700.HK', 'AAPL.US', '510300.SH', '000300.SH', 'https://example.com']) expect(stockSymbol(code)).toBeNull();
  });
  it('按返回精度还原价格，日期来自行情时间而非请求时间', () => {
    const tick = Date.parse('2026-01-02T02:00:00Z') / 1000;
    const quote = parseQuote(data({f43: 12345, f59: 3, f86: tick}), stockSymbol(base.code)!, new Date('2026-01-03T00:00:00Z'));
    expect(quote.price).toBe('12.345');
    expect(quote.asOf).toBe('2026-01-02');
    expect(quote.quotedAt).toBe('2026-01-02T02:00:00.000Z');
    expect(quote.fetchedAt).toBe('2026-01-03T00:00:00.000Z');
  });
  it('无效、负值、丢失精度、错误代码、未来时间均不当成有效报价', () => {
    for (const patch of [{f43: '--'}, {f43: 0}, {f43: -10}, {f43: 9.58}, {f59: undefined}, {f59: 99}, {f57: '000001'}, {f86: 0}, {f86: Math.floor(Date.now()/1000)+3600}]) expect(() => parseQuote(data(patch), stockSymbol(base.code)!)).toThrow();
    expect(() => parseQuote({rc: 0, data: null}, stockSymbol(base.code)!)).toThrow();
  });
  it('请求仅发送股票代码和行情字段，不包含持仓或账户数据', async () => {
    vi.mocked(serviceFetch).mockResolvedValue(response());
    await fetchQuote(stockSymbol(base.code)!, new AbortController().signal);
    const [url, init] = vi.mocked(serviceFetch).mock.calls[0];
    expect(new URL(String(url)).hostname).toBe('push2delay.eastmoney.com');
    expect(new URL(String(url)).searchParams.get('fltt')).toBe('1');
    expect(new URL(String(url)).searchParams.get('secid')).toBe('1.600000');
    expect(init?.credentials).toBe('omit');
    expect(init?.body).toBeUndefined();
    expect(JSON.stringify([url, init])).not.toContain(account.name);
    expect(JSON.stringify([url, init])).not.toContain('quantity');
  });
});

describe('持仓与资产自动重估', () => {
  it('同代码跨账户只请求一次，只更新单价/日期并原子生成快照', async () => {
    await db.accounts.add({...account, id: 'b'});
    await db.positions.bulkAdd([base, {...base, id: 'second', accountId: 'b', quantity: '20', cost: '160'}, {...base, id: 'cash', kind: 'cash', code: '', price: '1', quantity: '1000'}, {...base, id: 'fund', kind: 'fund', code: '000001', price: '2'}]);
    vi.mocked(serviceFetch).mockResolvedValue(response());
    const result = await syncMarketQuotes(new AbortController().signal);
    expect(serviceFetch).toHaveBeenCalledTimes(1);
    expect(result?.updated).toBe(2);
    const saved = (await db.positions.get(base.id))!;
    expect(saved.price).toBe('9.58'); expect(saved.quantity).toBe('100'); expect(saved.cost).toBe('800');
    expect((await db.positions.get('cash'))?.price).toBe('1');
    expect((await db.positions.get('fund'))?.price).toBe('2');
    const m = metrics([saved], defaultProfile);
    expect(m.assets.toFixed(2)).toBe('958.00'); expect(m.pnl.toFixed(2)).toBe('158.00');
    expect(await db.snapshots.count()).toBe(1);
    const records = await getMeta<Record<string, never>>('quoteRecords', {});
    expect(quotedPosition(saved, records[base.id])).toBe(true);
  });
  it('空数据、网络失败和不支持代码不会把原资产置零', async () => {
    await db.positions.bulkAdd([base, {...base, id: 'hk', code: '00700.HK'}]);
    vi.mocked(serviceFetch).mockResolvedValue(Response.json({rc: 0, data: null}));
    const result = await syncMarketQuotes(new AbortController().signal);
    expect(result?.failed).toBe(1); expect(result?.skipped).toBe(1);
    expect((await db.positions.get(base.id))?.price).toBe('8');
    expect(await db.snapshots.count()).toBe(0);
  });
  it('旧于账本日期或已记录报价时间的数据不回退估值', async () => {
    const current = {...base, price: '11', asOf: '2026-01-03'};
    await db.positions.add(current);
    vi.mocked(serviceFetch).mockResolvedValue(response({f86: Date.parse('2026-01-02T02:00:00Z')/1000}));
    expect((await syncMarketQuotes(new AbortController().signal))?.updated).toBe(0);
    expect((await db.positions.get(base.id))?.price).toBe('11');
    await setMeta('quoteRecords', {[base.id]: {code: base.code, price: '11', asOf: current.asOf, quotedAt: '2026-01-03T06:00:00.000Z'}});
    vi.mocked(serviceFetch).mockResolvedValue(response({f86: Date.parse('2026-01-03T02:00:00Z')/1000}));
    expect((await syncMarketQuotes(new AbortController().signal))?.updated).toBe(0);
  });
  it('查询期间的手工编辑和删除不会被迟到报价覆盖或重新创建', async () => {
    await db.positions.add(base);
    vi.mocked(serviceFetch).mockImplementationOnce(async () => { await db.positions.update(base.id, {quantity: '200', price: '12'}); return response(); });
    await syncMarketQuotes(new AbortController().signal);
    expect((await db.positions.get(base.id))?.price).toBe('12');
    expect((await db.positions.get(base.id))?.quantity).toBe('200');
    vi.mocked(serviceFetch).mockImplementationOnce(async () => { await db.positions.delete(base.id); return response(); });
    await syncMarketQuotes(new AbortController().signal);
    expect(await db.positions.count()).toBe(0);
  });
  it('恢复即使内容相同也使在途报价失效，旧行情标记不进入备份', async () => {
    await db.positions.add(base); await setMeta('quoteRecords', {old: {provider: 'eastmoney-delay'}});
    vi.mocked(serviceFetch).mockImplementationOnce(async () => { await restoreData(makeBundle([account], [base], defaultProfile)); return response(); });
    await expect(syncMarketQuotes(new AbortController().signal)).rejects.toThrow('账本已恢复');
    expect((await db.positions.get(base.id))?.price).toBe('8');
    expect(await getMeta('quoteRecords', null)).toBeNull();
    const {exportData} = await import('./db');
    expect(JSON.stringify(await exportData())).not.toContain('quoteRecords');
  });
  it('关闭自动更新时不联网，更新中关闭或取消不会写入行情', async () => {
    await db.positions.add(base);
    await syncMarketQuotes(new AbortController().signal, true);
    expect(serviceFetch).not.toHaveBeenCalled();
    await setMeta('quotesAutomatic', true);
    vi.mocked(serviceFetch).mockImplementationOnce(async () => { await setMeta('quotesAutomatic', false); return response(); });
    await expect(syncMarketQuotes(new AbortController().signal, true)).rejects.toThrow('自动行情已关闭');
    const controller = new AbortController();
    vi.mocked(serviceFetch).mockImplementationOnce(async () => { controller.abort(); return response(); });
    await expect(syncMarketQuotes(controller.signal)).rejects.toThrow();
    expect((await db.positions.get(base.id))?.price).toBe('8');
    expect(await db.snapshots.count()).toBe(0);
  });
});

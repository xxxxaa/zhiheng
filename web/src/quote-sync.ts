import {db, getMeta, setMeta, snapshot} from './db';
import {positionSchema, type Position} from './model';
import {stockSymbol, fetchQuote, type MarketQuote, type QuoteRecords} from './quotes';
import {checkAborted} from './abort';

export type QuoteSyncStatus = {attemptedAt: string; completedAt: string; eligible: number; updated: number; unchanged: number; skipped: number; failed: number; errors: string[]};
let running = false;
export function eligibleStock(position: Position) { return position.kind === 'stock' && Number(position.quantity) > 0 ? stockSymbol(position.code) : null; }

/** Network work finishes before one atomic, optimistic ledger update. */
export async function syncMarketQuotes(signal: AbortSignal, automatic = false): Promise<QuoteSyncStatus | null> {
  if (running) return null;
  checkAborted(signal);
  running = true;
  try {
    if (automatic && await getMeta('quotesAutomatic', false) !== true) return null;
    const revision = await getMeta('ledgerRevision', 'initial');
    const positions = await db.positions.toArray();
    checkAborted(signal);
    const eligible = positions.filter(position => eligibleStock(position));
    const unique = new Map(eligible.map(position => { const symbol = eligibleStock(position)!; return [symbol.secid, symbol] as const; }));
    if (unique.size > 100) throw new Error('当前单次最多更新 100 只不同股票，请减少自动更新范围');
    const status: QuoteSyncStatus = {attemptedAt: new Date().toISOString(), completedAt: '', eligible: eligible.length, updated: 0, unchanged: 0, skipped: positions.length - eligible.length, failed: 0, errors: []};
    const quotes = new Map<string, MarketQuote>();
    const errors = new Map<string, string>();
    const symbols = [...unique.values()];
    let cursor = 0;
    await Promise.all(Array.from({length: Math.min(3, symbols.length)}, async () => {
      while (cursor < symbols.length) {
        checkAborted(signal);
        const symbol = symbols[cursor++];
        try { quotes.set(symbol.secid, await fetchQuote(symbol, signal)); }
        catch (error) { checkAborted(signal); errors.set(symbol.secid, error instanceof Error ? error.message : '行情连接失败'); }
      }
    }));
    checkAborted(signal);
    await db.transaction('rw', [db.positions, db.snapshots, db.meta], async () => {
      checkAborted(signal);
      if (await getMeta('ledgerRevision', 'initial') !== revision) throw new DOMException('账本已恢复，本次行情已忽略，请重新更新', 'AbortError');
      if (automatic && await getMeta('quotesAutomatic', false) !== true) throw new DOMException('自动行情已关闭', 'AbortError');
      const records = await getMeta<QuoteRecords>('quoteRecords', {});
      for (const original of eligible) {
        checkAborted(signal);
        const symbol = eligibleStock(original)!;
        const quote = quotes.get(symbol.secid);
        if (!quote) { status.failed++; continue; }
        const current = await db.positions.get(original.id);
        // Do not overwrite edits, deletes or a ledger restored while the quote was loading.
        if (!current || JSON.stringify(current) !== JSON.stringify(original)) { status.skipped++; continue; }
        if (quote.asOf < current.asOf) { status.skipped++; continue; }
        const previous = records[current.id];
        if (previous && previous.code === current.code && previous.price === current.price && previous.asOf === current.asOf && previous.quotedAt > quote.quotedAt) { status.skipped++; continue; }
        const next = positionSchema.parse({...current, price: quote.price, asOf: quote.asOf});
        if (next.price !== current.price || next.asOf !== current.asOf) { await db.positions.put(next); status.updated++; }
        else status.unchanged++;
        records[current.id] = {code: current.code, price: quote.price, asOf: quote.asOf, quotedAt: quote.quotedAt, fetchedAt: quote.fetchedAt, provider: quote.provider};
      }
      checkAborted(signal);
      if (status.updated) await snapshot();
      status.errors = [...errors].slice(0, 20).map(([secid, message]) => `${secid}: ${message}`);
      status.completedAt = new Date().toISOString();
      await setMeta('quoteRecords', records);
      await setMeta('quoteSyncStatus', status);
    });
    return status;
  } finally { running = false; }
}

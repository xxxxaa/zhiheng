import {RefreshCw, CirclePause} from 'lucide-react';
import {Panel} from './App';
import type {MarketQuotesState} from './useMarketQuotes';

export function MarketQuotePanel({quotes, demo}: {quotes: MarketQuotesState; demo: boolean}) {
  const {status} = quotes;
  return <Panel title="东方财富行情估值" subtitle="沪深北 A 股 · 延迟行情 · 按持仓数量重新计算市值" action={<span className="pill">{demo ? '示例数据不联网' : quotes.busy ? '正在更新' : quotes.automatic ? '自动更新已开启' : '按需更新'}</span>}>
    <div className="button-row"><button className="secondary" disabled={demo || quotes.busy} onClick={() => void quotes.refresh()}><RefreshCw size={16}/>更新股票估值</button>{quotes.busy && <button className="text-button" onClick={quotes.cancel}><CirclePause size={16}/>取消更新</button>}</div>
    <label className="checkbox"><input type="checkbox" disabled={demo} checked={quotes.automatic} onChange={event => void quotes.setAutomatic(event.target.checked)}/>打开并解锁 App 后自动更新（每 60 秒）</label>
    <p role="status">{demo ? '示例持仓保留合成估值，不发送行情请求。' : quotes.busy ? '正在获取报价，成功后自动更新总资产、净资产和浮动盈亏…' : quotes.error || (status ? status.eligible ? `最近检查 ${new Date(status.completedAt).toLocaleString('zh-CN')}：${status.updated} 项更新，${status.unchanged} 项报价未变，${status.failed} 项失败，${status.skipped} 项保留原值。` : '暂未找到可更新的 A 股持仓，请填写股票代码，例如 600000.SH、000001.SZ、920001.BJ。' : '填写股票代码和持股数量后，可更新单价与行情截至日期。')}</p>
    {status && status.errors.length > 0 && !quotes.busy && <details><summary>部分报价获取失败，原估值已保留</summary><ul>{status.errors.map((message, index) => <li key={index}>{message}</li>)}</ul></details>}
    <p className="muted">仅向东方财富发送证券代码，不发送账户名称、持股数量、成本或金额。报价可能延迟，持仓列表会保留报价时间；非支持代码、无效或过旧报价不覆盖原估值。股票数量、成本、现金、基金与负债仍由你确认，不连接交易账户、不执行买卖。App 关闭或锁定时不运行。</p>
  </Panel>;
}

import { useEffect,useState } from "react";
import type { DocumentSummary, Organization } from "../api";
import { api } from "../api";
import { formatYen } from "../../domain/money";
import { TYPE_LABELS } from "../shell";

export function Home({organization,documents,navigate,admin}:{organization:Organization|null;documents:DocumentSummary[];navigate:(path:string)=>void;admin:boolean}){
  const month=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit"}).format(new Date());
  const [metrics,setMetrics]=useState<Awaited<ReturnType<typeof api.sales>>|null>(null);
  const [trend,setTrend]=useState<Array<{month:string;salesYen:number}>>([]);
  const [overdue,setOverdue]=useState<Awaited<ReturnType<typeof api.overdueInvoices>>>([]);
  useEffect(()=>{api.sales(month).then(setMetrics).catch(()=>setMetrics(null));api.monthlySales(month).then(setTrend).catch(()=>setTrend([]));api.overdueInvoices().then(setOverdue).catch(()=>setOverdue([]))},[month]);
  // First-run checklist: what still has to be set before documents look complete.
  const setup=organization?[
    {label:"会社情報（会社名・住所）を登録",done:Boolean(organization.legal_name&&organization.legal_name!=="サンプル株式会社"&&organization.address),path:"/settings/company"},
    {label:"インボイス登録番号を設定（適格請求書発行事業者の場合）",done:Boolean(organization.registration_number),path:"/settings/company",optional:true},
    {label:"社印（印影）を登録",done:Boolean(organization.seal_asset_id),path:"/settings/company",optional:true},
    {label:"振込先口座を登録",done:Boolean(organization.bank.bankName&&organization.bank.accountNumber),path:"/settings/bank"},
    {label:"最初の帳票を作成",done:documents.length>0,path:"/documents/new?type=QT"},
  ]:[];
  const pending=setup.filter(item=>!item.done);
  const maxSales=Math.max(1,...trend.map(item=>item.salesYen));const chartMax=Math.max(100_000,Math.ceil(maxSales/100_000)*100_000);
  return <>
    <div className="page-heading"><div><span className="eyebrow">OVERVIEW　/　{month.replace("-","年")}月</span><h1>ホーム</h1><p>{organization?.display_name||"会社情報を設定してください"} の帳票と入金状況</p></div><button className="button primary" onClick={()=>navigate("/documents/new?type=QT")}><span>＋</span> 帳票を作成</button></div>
    {pending.length>0?<section className="panel setup-panel"><div className="section-heading"><div><h2>はじめての設定</h2><span>帳票を取引先へ送る前に、次の項目を確認してください。{admin?"":"（設定の変更は管理者が行います）"}</span></div><button className="text-button" onClick={()=>navigate("/guide")}>使い方ガイドを見る　→</button></div><ul className="setup-list">{setup.map(item=><li key={item.label} className={item.done?"done":""}><span className="setup-check">{item.done?"✓":""}</span><span>{item.label}{item.optional&&!item.done&&<small>任意</small>}</span>{!item.done&&<button className="text-button" onClick={()=>navigate(item.path)}>設定する　→</button>}</li>)}</ul></section>
    :<div className="welcome-strip"><div className="welcome-icon">✳</div><div><strong>今日の業務を、ここから。</strong><p>帳票の作成から発行、入金状況までをひとつの場所で管理できます。</p></div><button onClick={()=>navigate("/guide")}>使い方ガイドを見る <span>→</span></button></div>}
    <section className="section-block"><div className="section-heading"><div><h2>今月の状況</h2><span>請求日を基準とした発行済み請求書</span></div><button className="text-button" onClick={()=>navigate("/sales")}>売上管理を見る　→</button></div>
      <div className="metric-grid"><Metric label="売上高" value={formatYen(metrics?.salesYen??0)} change="発行済み請求書の税抜合計" color="blue" icon="↗"/><Metric label="請求済" value={formatYen(metrics?.invoicedYen??0)} change="今月発行した請求書" color="violet" icon="▤"/><Metric label="入金済" value={formatYen(metrics?.paidYen??0)} change="対象月請求への現在の入金" color="green" icon="✓"/><Metric label="未入金" value={formatYen(metrics?.outstandingYen??0)} change="未回収の請求残高" color="amber" icon="◷"/></div>
    </section>
    <div className="dashboard-grid"><section className="panel trend-panel"><div className="section-heading"><div><h2>売上の推移</h2><span>月ごとの請求額（税抜）</span></div><span className="chart-legend"><i/>直近6か月</span></div><div className="chart-area"><div className="chart-y"><span>{formatYen(chartMax)}</span><span>{formatYen(chartMax/2)}</span><span>¥0</span></div><div className="chart-grid"><div className="chart-line"/><div className="chart-line"/><div className="chart-line"/><div className="bars">{trend.map((item,index)=><div className="bar-column" key={item.month}><div className={`bar ${index===trend.length-1?"bar-current":""}`} style={{height:`${item.salesYen?Math.max(3,item.salesYen/chartMax*88):1}%`}}/><span>{Number(item.month.slice(5))}月</span></div>)}</div></div></div><div className="chart-legend"><span/>売上高</div></section>
      <section className="panel attention-panel"><div className="section-heading"><div><h2>確認が必要な請求書</h2><span>支払期限を過ぎた未入金</span></div><span className="count-pill">{overdue.length} 件</span></div>{overdue.length?<div className="overdue-list">{overdue.slice(0,3).map(item=><button className="overdue-row" key={item.id} onClick={()=>navigate(`/documents/${item.id}/edit`)}><span><strong>{item.recipient_search_name}</strong><small>{item.number}　期限 {item.due_date}</small></span><b>{formatYen(item.outstanding_yen)}</b></button>)}</div>:<div className="empty-state compact"><span className="empty-check">✓</span><strong>対応が必要な請求書はありません</strong><p>期限を過ぎた請求書があると、ここに表示されます。</p></div>}</section></div>
    <section className="panel recent-panel"><div className="section-heading"><div><h2>最近の帳票</h2><span>作成・更新した帳票</span></div><button className="text-button" onClick={()=>navigate("/documents")}>すべて見る　→</button></div>{documents.length? <div className="table-wrap"><table className="data-table"><thead><tr><th>帳票番号</th><th>種類</th><th>件名</th><th>取引先</th><th>発行日</th><th>金額</th><th>状態</th></tr></thead><tbody>{documents.slice(0,5).map(doc=><tr key={doc.id} onClick={()=>navigate(`/documents/${doc.id}/edit`)}><td className="mono">{doc.number??"下書き"}</td><td><span className="doc-type-tag">{TYPE_LABELS[doc.type]}</span></td><td>{doc.subject||"—"}</td><td>{doc.recipient_search_name||"—"}</td><td>{doc.issue_date}</td><td className="amount-cell">{formatYen(doc.total_yen)}</td><td><span className={`status-tag ${doc.state==="DRAFT"?"draft":"issued"}`}>{doc.state==="DRAFT"?"下書き":doc.state==="ISSUED"?"発行済み":doc.state==="ISSUING"?"発行処理中":doc.state}</span></td></tr>)}</tbody></table></div>:<div className="empty-state"><span className="empty-document">▤</span><strong>帳票はまだありません</strong><p>見積書を作成して、日々の帳票管理を始めましょう。</p><button className="button secondary" onClick={()=>navigate("/documents/new?type=QT")}>見積書を作成　→</button></div>}</section>
  </>;
}
function Metric({label,value,change,color,icon}:{label:string;value:string;change:string;color:string;icon:string}){return <article className="metric-card"><div className="metric-top"><span>{label}</span><span className={`metric-icon ${color}`}>{icon}</span></div><strong>{value}</strong><small>{change}</small><span className={`metric-accent ${color}`}/></article>}

import { useEffect, useMemo, useState } from "react";
import { api, type DocumentFilters, type DocumentSummary, type Organization } from "./api";
import { DocumentEditor } from "./views/DocumentEditor";
import { Documents } from "./views/Documents";
import { Home } from "./views/Home";
import { Masters } from "./views/Masters";
import { Sales } from "./views/Sales";
import { Settings } from "./views/Settings";

export const TYPE_LABELS: Record<string,string> = {QT:"見積書",DN:"納品書",INV:"請求書",RC:"領収書",PO:"発注書",OC:"注文請書"};
const primary = [{path:"/",label:"ホーム",icon:"⌂"},{path:"/documents",label:"帳票",icon:"▤"},{path:"/sales",label:"売上管理",icon:"↗"},{path:"/counterparties",label:"取引先",icon:"▣"},{path:"/products",label:"商品・サービス",icon:"◇"}];
const types = ["QT","DN","INV","RC","PO","OC"];

export function App() {
  const [path,setPath] = useState(window.location.pathname + window.location.search);
  const [org,setOrg] = useState<Organization | null>(null);
  const [docs,setDocs] = useState<DocumentSummary[]>([]);
  const [query,setQuery] = useState("");
  const [notice,setNotice] = useState("");
  const [error,setError] = useState("");
  const [refresh,setRefresh] = useState(0);
  const [filters,setFilters] = useState<DocumentFilters>({from:"",to:"",minAmount:"",maxAmount:"",counterpartyId:"",status:""});
  const currentPath=path.split("?")[0];
  const selectedType=useMemo(()=>new URLSearchParams(path.split("?")[1]??"").get("type")??"",[path]);
  useEffect(()=>{
    const onPop=()=>setPath(window.location.pathname+window.location.search);
    window.addEventListener("popstate",onPop); return ()=>window.removeEventListener("popstate",onPop);
  },[]);
  useEffect(()=>{ api.getOrganization().then(setOrg).catch((e)=>setError(e.message)); },[refresh]);
  useEffect(()=>{ api.documents(query,selectedType,filters).then(setDocs).catch(()=>setDocs([])); },[query,refresh,selectedType,filters]);
  function navigate(to:string){window.history.pushState({},"",to);setPath(to);setError("");setNotice("");window.scrollTo(0,0);}
  function flash(message:string){setNotice(message);window.setTimeout(()=>setNotice(""),3500);}
  const view = currentPath==="/" ? <Home organization={org} documents={docs} navigate={navigate} />
    : currentPath==="/documents/new" || /^\/documents\/[^/]+\/edit$/.test(currentPath) ? <DocumentEditor path={currentPath} organization={org} navigate={navigate} flash={flash} />
    : currentPath==="/documents" ? <Documents documents={docs} selectedType={selectedType} query={query} setQuery={setQuery} filters={filters} setFilter={(key,value)=>setFilters(old=>({...old,[key]:value}))} navigate={navigate} />
    : currentPath==="/sales" ? <Sales />
    : currentPath==="/counterparties" ? <Masters kind="counterparties" />
    : currentPath==="/products" ? <Masters kind="products" />
    : currentPath.startsWith("/settings") ? <Settings organization={org} saved={()=>{setRefresh((n)=>n+1);flash("会社情報を保存しました。")}} />
    : <Documents documents={docs} selectedType="" query={query} setQuery={setQuery} filters={filters} setFilter={(key,value)=>setFilters(old=>({...old,[key]:value}))} navigate={navigate} />;
  return <div className="app-shell">
    <aside className="sidebar">
      <button className="brand" onClick={()=>navigate("/")}><span className="brand-mark">帳</span><span><strong>JDS</strong><small>BUSINESS DOCUMENTS</small></span></button>
      <div className="nav-caption">メニュー</div>
      <nav>{primary.map((item)=><button key={item.path} className={`nav-link ${currentPath===item.path || (item.path==="/documents"&&currentPath.startsWith("/documents"))?"active":""}`} onClick={()=>navigate(item.path)}><span className="nav-icon">{item.icon}</span>{item.label}{item.path==="/documents"&&<span className="nav-chevron">⌄</span>}</button>)}
      {currentPath.startsWith("/documents")&&<div className="subnav">{types.map(type=><button key={type} className={selectedType===type?"chosen":""} onClick={()=>navigate(`/documents?type=${type}`)}><span className="type-dot">{type.slice(0,1)}</span>{TYPE_LABELS[type]}</button>)}</div>}
      <div className="sidebar-spacer"/><button className={`nav-link ${currentPath.startsWith("/settings")?"active":""}`} onClick={()=>navigate("/settings/company")}><span className="nav-icon">⚙</span>設定</button></nav>
      <div className="account-card"><div className="avatar">開</div><div><strong>開発ユーザー</strong><small>管理者</small></div><span className="online-dot"/></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="breadcrumbs"><span>業務管理</span><i>/</i><strong>{currentPath.startsWith("/documents")?"帳票":primary.find(x=>x.path===currentPath)?.label??(currentPath==="/sales"?"売上管理":currentPath==="/products"?"商品・サービス":currentPath==="/counterparties"?"取引先":"設定")}</strong></div><div className="top-actions"><span className="today-label">{new Intl.DateTimeFormat("ja-JP",{dateStyle:"long",timeZone:"Asia/Tokyo"}).format(new Date())}</span><button className="icon-button" aria-label="通知">♧<span className="notification-dot"/></button></div></header>
      {(notice||error)&&<div role={error?"alert":"status"} className={`toast ${error?"toast-error":""}`}><span>{error||notice}</span><button onClick={()=>{setError("");setNotice("")}}>×</button></div>}
      <div className="page-content">{view}</div>
    </main>
  </div>;
}

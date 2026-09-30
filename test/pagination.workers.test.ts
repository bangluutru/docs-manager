import { exports,env } from 'cloudflare:workers';
import { expect,it } from 'vitest';
const org='local-organization';
async function fetchPage(path:string){const r=await exports.default.fetch(`http://localhost/api/v1${path}`);expect(r.status).toBe(200);return await r.json() as {data:Array<{id:string;has_correction?:number;state?:string}>;nextCursor:string|null};}
it('pages 105 tied-name masters and documents without duplicates or missing records',async()=>{
 const stamp=new Date().toISOString();const ids=Array.from({length:105},()=>crypto.randomUUID());const statements:D1PreparedStatement[]=[];
 for(const [i,id] of ids.entries()){
  statements.push(env.DB.prepare("INSERT INTO products(id,organization_id,code,name,unit,unit_price_decimal,tax_class,created_at,updated_at) VALUES(?,?,?,'同名商品','個','1000','STANDARD_10',?,?)").bind(id,org,`PAGE-${i}`,stamp,stamp));
  statements.push(env.DB.prepare("INSERT INTO counterparties(id,organization_id,name,normalized_name,is_customer,is_supplier,created_at,updated_at) VALUES(?,?,'同名顧客','同名顧客',1,0,?,?)").bind(id,org,stamp,stamp));
  statements.push(env.DB.prepare("INSERT INTO documents(id,organization_id,type,active_draft_revision_id,created_by,created_at) VALUES(?,?,'QT',?,'test',?)").bind(id,org,`revision-${id}`,stamp));
  statements.push(env.DB.prepare("INSERT INTO document_revisions(id,organization_id,document_id,revision,state,recipient_snapshot_json,recipient_search_name,issuer_snapshot_json,issue_date,subject,tax_mode,tax_rounding,line_rounding,created_by,created_at,updated_at) VALUES(?,?,?,0,'DRAFT','{}','同名顧客','{}','2026-09-30','同名帳票','exclusive','floor','floor','test',?,?)").bind(`revision-${id}`,org,id,stamp,stamp));
 }
 for(let i=0;i<statements.length;i+=80)await env.DB.batch(statements.slice(i,i+80));
 for(const path of ['/products','/counterparties','/documents']){
  let cursor:string|null=null;const found:string[]=[];let pages=0;
  do{const page=await fetchPage(`${path}?limit=40${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`);found.push(...page.data.map(r=>r.id));cursor=page.nextCursor;pages++;expect(pages).toBeLessThan(5);}while(cursor);
  expect(pages).toBe(3);expect(found).toHaveLength(105);expect(new Set(found).size).toBe(105);expect(new Set(found)).toEqual(new Set(ids));
 }
 const first=await fetchPage('/products?limit=2');expect(first.nextCursor).not.toBeNull();
 expect((await exports.default.fetch(`http://localhost/api/v1/products?q=changed&cursor=${encodeURIComponent(first.nextCursor!)}`)).status).toBe(422);
 expect((await exports.default.fetch(`http://localhost/api/v1/counterparties?cursor=${encodeURIComponent(first.nextCursor!)}`)).status).toBe(422);
 expect((await exports.default.fetch('http://localhost/api/v1/products?cursor=bad-base64')).status).toBe(422);
 expect((await exports.default.fetch('http://localhost/api/v1/products?limit=101')).status).toBe(422);
 const selected=await fetchPage('/products?q=PAGE-104');expect(selected.data).toHaveLength(1);expect(selected.data[0].id).toBe(ids[104]);
});

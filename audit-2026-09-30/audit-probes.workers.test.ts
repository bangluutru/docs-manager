import { exports, env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { renderDocumentHtml } from '../src/jds/render';
const org='local-organization';
async function call(path:string,method='GET',body?:unknown,headers:Record<string,string>={}) {return exports.default.fetch(new Request(`http://localhost/api/v1${path}`,{method,headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID(),...headers},body:body===undefined?undefined:JSON.stringify(body)}));}
async function draft(type='INV',counterpartyId?:string) {
 const input={type,recipientName:'監査顧客',subject:'監査検証',issueDate:'2026-09-29',transactionDate:'2026-09-29',dueDate:'2026-10-31',validUntil:'2026-10-31',counterpartyId,taxMode:'exclusive',lines:[{id:crypto.randomUUID(),description:'監査商品',quantity:'1',unit:'個',unitPrice:'1000',taxClass:'STANDARD_10'}]};
 const response=await call('/documents','POST',input);expect(response.status).toBe(201);const result=await response.json() as {data:{id:string;version:number}};return {id:result.data.id,input};
}
async function partner(name:string){const r=await call('/counterparties','POST',{name,isCustomer:true});expect(r.status).toBe(201);return (await r.json() as {data:{id:string}}).data.id;}
it('A01: qualified-mode issuance accepts a frozen issuer without registration number',async()=>{
 const d=await draft();
 await env.DB.prepare("UPDATE organization_settings SET qualified_mode=1,registration_number='T1234567890123' WHERE organization_id=?").bind(org).run();
 const issued=await call(`/documents/${d.id}/issue`,'POST',{});expect(issued.status).toBe(200);
 const record=(await (await call(`/documents/${d.id}`)).json() as {data:Parameters<typeof renderDocumentHtml>[0]}).data;
 expect(record.issuer.registrationNumber).toBeNull();expect(renderDocumentHtml(record)).not.toContain('T1234567890123');
});
it('A02: changing draft type through PATCH returns success but silently retains old type',async()=>{
 const d=await draft('QT');const r=await call(`/documents/${d.id}`,'PATCH',{...d.input,type:'INV'},{'If-Match':'1'});expect(r.status).toBe(200);
 const record=await (await call(`/documents/${d.id}`)).json() as {data:{data:{type:string}}};expect(record.data.data.type).toBe('QT');
});
it('A03: unissued correction hides a current issued invoice from UNPAID search',async()=>{
 const d=await draft();expect((await call(`/documents/${d.id}/issue`,'POST',{})).status).toBe(200);
 expect((await call(`/documents/${d.id}/revise`,'POST',{reason:'監査用訂正'})).status).toBe(201);
 const rows=(await (await call('/documents?status=UNPAID')).json() as {data:Array<{id:string}>}).data;expect(rows.find(r=>r.id===d.id)).toBeUndefined();
 const summary=(await (await call('/sales/summary?month=2026-09')).json() as {data:{outstandingYen:number}}).data;expect(summary.outstandingYen).toBeGreaterThanOrEqual(1100);
});
it('A04: saving a correction reassigns historical sales before the correction is issued',async()=>{
 const a=await partner('原顧客');const b=await partner('訂正後顧客');const d=await draft('INV',a);expect((await call(`/documents/${d.id}/issue`,'POST',{})).status).toBe(200);
 expect((await call(`/documents/${d.id}/revise`,'POST',{reason:'監査用訂正'})).status).toBe(201);
 expect((await call(`/documents/${d.id}`,'PATCH',{...d.input,counterpartyId:b,recipientName:'訂正後顧客'},{'If-Match':'1'})).status).toBe(200);
 const rows=(await (await call('/sales/counterparties?month=2026-09')).json() as {data:Array<{counterparty_id:string;counterparty_name:string;sales_yen:number}>}).data;expect(rows.find(r=>r.counterparty_id===b)).toMatchObject({counterparty_id:b,counterparty_name:'訂正後顧客',sales_yen:1000});
});
it('A05: payment accepted after correction draft creation permanently blocks issuance finalization',async()=>{
 const d=await draft();expect((await call(`/documents/${d.id}/issue`,'POST',{})).status).toBe(200);
 expect((await call(`/documents/${d.id}/revise`,'POST',{reason:'監査用訂正'})).status).toBe(201);
 expect((await call(`/documents/${d.id}/payments`,'POST',{paymentDate:'2026-09-29',amountYen:100,method:'BANK_TRANSFER'})).status).toBe(201);
 expect((await call(`/documents/${d.id}/issue`,'POST',{})).status).toBe(500);
 const row=await env.DB.prepare("SELECT r.state,j.state job_state,j.last_error_code FROM documents d JOIN document_revisions r ON r.id=d.active_draft_revision_id JOIN issue_jobs j ON j.revision_id=r.id WHERE d.id=?").bind(d.id).first<{state:string;job_state:string;last_error_code:string}>();expect(row).toMatchObject({state:'ISSUING',job_state:'FAILED'});expect(row!.last_error_code).toContain('effective revision');
});
it('A06: product validation accepts leading zero prices rejected when reused in drafts',async()=>{
 const r=await call('/products','POST',{code:'AUDIT-001',name:'監査商品',unit:'個',unitPrice:'001000',taxClass:'STANDARD_10'});expect(r.status).toBe(201);
 const d=await draft();expect((await call('/documents','POST',{...d.input,lines:[{...d.input.lines[0],unitPrice:'001000'}]})).status).toBe(422);
});
it('A07: an edit between issue validation and freeze is issued without revalidation',async()=>{
 const worker=(await import('../src/server/index')).default;
 const d=await draft();let edited=false;
 const wrappedDb=new Proxy(env.DB,{get(target,property){
   if(property==='batch')return async(statements:D1PreparedStatement[])=>{
     if(!edited){edited=true;expect((await call(`/documents/${d.id}`,'PATCH',{...d.input,subject:'',dueDate:undefined},{'If-Match':'1'})).status).toBe(200);}
     return target.batch(statements);
   };
   const value=Reflect.get(target,property,target);return typeof value==='function'?value.bind(target):value;
 }});
 const response=await worker.fetch(new Request(`http://localhost/api/v1/documents/${d.id}/issue`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:'{}'}),{...env,DB:wrappedDb});
 expect(response.status).toBe(200);
 const record=await env.DB.prepare("SELECT state,subject,due_date,version FROM document_revisions WHERE document_id=?").bind(d.id).first();expect(record).toMatchObject({state:'ISSUED',subject:'',due_date:null,version:2});
});
it('S01: demo auth remains closed on a non-local host',async()=>{
 const response=await exports.default.fetch(new Request('https://example.com/api/v1/session'));expect(response.status).toBe(401);
});
it('S02: foreign-origin mutations are rejected before any write',async()=>{
 const response=await call('/documents','POST',{}, {Origin:'https://attacker.example'});expect(response.status).toBe(403);
});
it('S03: organization-scoped lookup denies a foreign document ID',async()=>{
 const d=await draft();const worker=(await import('../src/server/index')).default;
 const response=await worker.fetch(new Request(`http://localhost/api/v1/documents/${d.id}`),{...env,ORGANIZATION_ID:'foreign-organization'});expect(response.status).toBe(404);
});

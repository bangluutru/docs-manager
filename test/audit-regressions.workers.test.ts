import { exports, env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { renderDocumentHtml } from '../src/jds/render';
const org='local-organization';
async function call(path:string,method='GET',body?:unknown,headers:Record<string,string>={}) {return exports.default.fetch(new Request(`http://localhost/api/v1${path}`,{method,headers:{'Content-Type':'application/json','If-Match':'1','Idempotency-Key':crypto.randomUUID(),...headers},body:body===undefined?undefined:JSON.stringify(body)}));}
async function draft(type='INV',counterpartyId?:string) {
 const input={type,recipientName:'監査顧客',subject:'監査検証',issueDate:'2026-09-29',transactionDate:'2026-09-29',dueDate:'2026-10-31',validUntil:'2026-10-31',counterpartyId,taxMode:'exclusive',lines:[{id:crypto.randomUUID(),description:'監査商品',quantity:'1',unit:'個',unitPrice:'1000',taxClass:'STANDARD_10'}]};
 const response=await call('/documents','POST',input);expect(response.status).toBe(201);const result=await response.json() as {data:{id:string;version:number}};return {id:result.data.id,input};
}
async function partner(name:string){const r=await call('/counterparties','POST',{name,isCustomer:true});expect(r.status).toBe(201);return (await r.json() as {data:{id:string}}).data.id;}
it('validates the frozen issuer and supports explicit draft refresh',async()=>{
 const d=await draft();
 await env.DB.prepare("UPDATE organization_settings SET qualified_mode=1,registration_number='T1234567890123' WHERE organization_id=?").bind(org).run();
 const issued=await call(`/documents/${d.id}/issue`,'POST',{});expect(issued.status).toBe(422);
 const error=await issued.json() as {error:{code:string}};expect(error.error.code).toBe('ISSUER_SNAPSHOT_OUTDATED');
 expect(await env.DB.prepare('SELECT 1 FROM number_reservations WHERE document_id=?').bind(d.id).first()).toBeNull();
 expect((await call(`/documents/${d.id}/refresh-issuer`,'POST',{})).status).toBe(200);
 expect((await call(`/documents/${d.id}/issue`,'POST',{}, {'If-Match':'2'})).status).toBe(200);
 const record=(await (await call(`/documents/${d.id}`)).json() as {data:Parameters<typeof renderDocumentHtml>[0]}).data;
 expect(record.issuer.registrationNumber).toBe('T1234567890123');expect(renderDocumentHtml(record)).toContain('T1234567890123');
 await env.DB.prepare('UPDATE organization_settings SET qualified_mode=0,registration_number=NULL WHERE organization_id=?').bind(org).run();
});
it('rejects a PATCH changing the document type',async()=>{
 const d=await draft('QT');const r=await call(`/documents/${d.id}`,'PATCH',{...d.input,type:'INV'},{'If-Match':'1'});expect(r.status).toBe(422);
 const record=await (await call(`/documents/${d.id}`)).json() as {data:{data:{type:string}}};expect(record.data.data.type).toBe('QT');
});
it('keeps the effective invoice visible in unpaid search during correction',async()=>{
 const d=await draft();expect((await call(`/documents/${d.id}/issue`,'POST',{})).status).toBe(200);
 expect((await call(`/documents/${d.id}/revise`,'POST',{reason:'監査用訂正'})).status).toBe(201);
 const rows=(await (await call('/documents?status=UNPAID')).json() as {data:Array<{id:string}>}).data;expect(rows.find(r=>r.id===d.id)).toBeDefined();
 const summary=(await (await call('/sales/summary?month=2026-09')).json() as {data:{outstandingYen:number}}).data;expect(summary.outstandingYen).toBeGreaterThanOrEqual(1100);
});
it('keeps sales with the effective revision counterparty until issuance',async()=>{
 const a=await partner('原顧客');const b=await partner('訂正後顧客');const d=await draft('INV',a);expect((await call(`/documents/${d.id}/issue`,'POST',{})).status).toBe(200);
 expect((await call(`/documents/${d.id}/revise`,'POST',{reason:'監査用訂正'})).status).toBe(201);
 expect((await call(`/documents/${d.id}`,'PATCH',{...d.input,counterpartyId:b,recipientName:'訂正後顧客'},{'If-Match':'1'})).status).toBe(200);
 const rows=(await (await call('/sales/counterparties?month=2026-09')).json() as {data:Array<{counterparty_id:string;counterparty_name:string;sales_yen:number}>}).data;expect(rows.find(r=>r.counterparty_id===b)).toBeUndefined();expect(rows.find(r=>r.counterparty_id===a)).toMatchObject({counterparty_id:a,counterparty_name:'監査顧客',sales_yen:1000});
 const correction=await (await call(`/documents/${d.id}`)).json() as {data:{data:{counterpartyId:string}}};expect(correction.data.data.counterpartyId).toBe(b);
 expect((await call(`/documents/${d.id}/issue`,'POST',{}, {'If-Match':'2'})).status).toBe(200);
 const effective=await (await call(`/documents/${d.id}`)).json() as {data:{data:{counterpartyId:string}}};expect(effective.data.data.counterpartyId).toBe(b);
 const after=(await (await call('/sales/counterparties?month=2026-09')).json() as {data:Array<{counterparty_id:string;sales_yen:number}>}).data;expect(after.find(r=>r.counterparty_id===b)).toMatchObject({sales_yen:1000});expect(after.find(r=>r.counterparty_id===a)).toBeUndefined();
});
it('blocks payments during correction and allows revision issuance',async()=>{
 const d=await draft();expect((await call(`/documents/${d.id}/issue`,'POST',{})).status).toBe(200);
 expect((await call(`/documents/${d.id}/revise`,'POST',{reason:'監査用訂正'})).status).toBe(201);
 expect((await call(`/documents/${d.id}/payments`,'POST',{paymentDate:'2026-09-29',amountYen:100,method:'BANK_TRANSFER'})).status).toBe(409);
 expect((await call(`/documents/${d.id}/issue`,'POST',{})).status).toBe(200);
 const row=await env.DB.prepare("SELECT r.state,j.state job_state,j.last_error_code FROM documents d JOIN document_revisions r ON r.id=d.current_issued_revision_id JOIN issue_jobs j ON j.revision_id=r.id WHERE d.id=?").bind(d.id).first<{state:string;job_state:string;last_error_code:string}>();expect(row).toMatchObject({state:'ISSUED',job_state:'COMPLETE'});
});
it('shares decimal validation between masters and drafts',async()=>{
 const r=await call('/products','POST',{code:'AUDIT-001',name:'監査商品',unit:'個',unitPrice:'001000',taxClass:'STANDARD_10'});expect(r.status).toBe(422);
 const d=await draft();expect((await call('/documents','POST',{...d.input,lines:[{...d.input.lines[0],unitPrice:'001000'}]})).status).toBe(422);
});
it('rolls back reservation and job when a draft changes between validation and freeze',async()=>{
 const worker=(await import('../src/server/index')).default;
 const d=await draft();let edited=false;
 const wrappedDb=new Proxy(env.DB,{get(target,property){
   if(property==='batch')return async(statements:D1PreparedStatement[])=>{
     if(!edited){edited=true;expect((await call(`/documents/${d.id}`,'PATCH',{...d.input,subject:'',dueDate:undefined},{'If-Match':'1'})).status).toBe(200);}
     return target.batch(statements);
   };
   const value=Reflect.get(target,property,target);return typeof value==='function'?value.bind(target):value;
 }});
 const response=await worker.fetch(new Request(`http://localhost/api/v1/documents/${d.id}/issue`,{method:'POST',headers:{'Content-Type':'application/json','If-Match':'1','Idempotency-Key':crypto.randomUUID()},body:'{}'}),{...env,DB:wrappedDb});
 expect(response.status).toBe(409);
 expect(await env.DB.prepare('SELECT 1 FROM number_reservations WHERE document_id=?').bind(d.id).first()).toBeNull();
 expect(await env.DB.prepare('SELECT 1 FROM issue_jobs WHERE revision_id IN (SELECT id FROM document_revisions WHERE document_id=?)').bind(d.id).first()).toBeNull();
 const record=await env.DB.prepare("SELECT state,subject,due_date,version FROM document_revisions WHERE document_id=?").bind(d.id).first();expect(record).toMatchObject({state:'DRAFT',subject:'',due_date:null,version:2});
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
it('rejects stale caller versions before reserving an issue number',async()=>{
 const d=await draft();expect((await call(`/documents/${d.id}`,'PATCH',d.input)).status).toBe(200);
 expect((await call(`/documents/${d.id}/issue`,'POST',{})).status).toBe(409);
 expect(await env.DB.prepare('SELECT 1 FROM number_reservations WHERE document_id=?').bind(d.id).first()).toBeNull();
});
it('rolls back an existing-number revision freeze when it is edited concurrently',async()=>{
 const worker=(await import('../src/server/index')).default;const d=await draft();
 expect((await call(`/documents/${d.id}/issue`,'POST',{})).status).toBe(200);
 expect((await call(`/documents/${d.id}/revise`,'POST',{reason:'監査用訂正'})).status).toBe(201);
 let edited=false;
 const wrappedDb=new Proxy(env.DB,{get(target,property){if(property==='batch')return async(statements:D1PreparedStatement[])=>{if(!edited){edited=true;expect((await call(`/documents/${d.id}`,'PATCH',{...d.input,subject:'',dueDate:undefined})).status).toBe(200);}return target.batch(statements);};const value=Reflect.get(target,property,target);return typeof value==='function'?value.bind(target):value;}});
 const response=await worker.fetch(new Request(`http://localhost/api/v1/documents/${d.id}/issue`,{method:'POST',headers:{'If-Match':'1','Idempotency-Key':crypto.randomUUID()}}),{...env,DB:wrappedDb});
 expect(response.status).toBe(409);
 const row=await env.DB.prepare('SELECT r.state,r.version,j.id job_id FROM documents d JOIN document_revisions r ON r.id=d.active_draft_revision_id LEFT JOIN issue_jobs j ON j.revision_id=r.id WHERE d.id=?').bind(d.id).first();expect(row).toMatchObject({state:'DRAFT',version:2,job_id:null});
});
it('rejects a payment arriving after the API precheck via the transactional guard',async()=>{
 const worker=(await import('../src/server/index')).default;const d=await draft();expect((await call(`/documents/${d.id}/issue`,'POST',{})).status).toBe(200);
 let interleaved=false;
 const wrappedDb=new Proxy(env.DB,{get(target,property){if(property==='batch')return async(statements:D1PreparedStatement[])=>{if(!interleaved){interleaved=true;expect((await call(`/documents/${d.id}/revise`,'POST',{reason:'競合の検証'})).status).toBe(201);}return target.batch(statements);};const value=Reflect.get(target,property,target);return typeof value==='function'?value.bind(target):value;}});
 const key=crypto.randomUUID();const response=await worker.fetch(new Request(`http://localhost/api/v1/documents/${d.id}/payments`,{method:'POST',headers:{'Idempotency-Key':key,'Content-Type':'application/json'},body:JSON.stringify({paymentDate:'2026-09-29',amountYen:100,method:'CASH'})}),{...env,DB:wrappedDb});expect(response.status).toBe(409);
 expect(await env.DB.prepare('SELECT 1 FROM payments WHERE invoice_document_id=?').bind(d.id).first()).toBeNull();
 expect(await env.DB.prepare('SELECT 1 FROM idempotency_requests WHERE key=?').bind(key).first()).toBeNull();
});
it('abandons only an unissued correction and restores payments without deleting history',async()=>{
 const d=await draft();expect((await call(`/documents/${d.id}/issue`,'POST',{})).status).toBe(200);
 expect((await call(`/documents/${d.id}/revise`,'POST',{reason:'取りやめ検証'})).status).toBe(201);
 const headers={'Idempotency-Key':crypto.randomUUID()};const body={revision:1,reason:'元の内容を使用する'};
 expect((await call(`/documents/${d.id}/abandon-revision`,'POST',body,headers)).status).toBe(200);
 expect((await call(`/documents/${d.id}/abandon-revision`,'POST',body,headers)).status).toBe(200);
 expect((await call(`/documents/${d.id}/payments`,'POST',{paymentDate:'2026-09-29',amountYen:100,method:'CASH'})).status).toBe(201);
 expect(await env.DB.prepare('SELECT state FROM document_revisions WHERE document_id=? AND revision=1').bind(d.id).first()).toEqual({state:'ABANDONED'});
 expect(await env.DB.prepare("SELECT 1 FROM audit_logs WHERE entity_id=? AND action='DOCUMENT_REVISION_ABANDONED'").bind(d.id).first()).not.toBeNull();
});
it('recovers an R2 failure with the same frozen snapshot and reports retryability',async()=>{
 const worker=(await import('../src/server/index')).default;const d=await draft();const key=crypto.randomUUID();
 const bucket=new Proxy(env.DOCUMENT_ARTIFACTS,{get(target,property){if(property==='get')return async()=>{throw new Error('injected R2 read failure')};const value=Reflect.get(target,property,target);return typeof value==='function'?value.bind(target):value;}});
 const response=await worker.fetch(new Request(`http://localhost/api/v1/documents/${d.id}/issue`,{method:'POST',headers:{'If-Match':'1','Idempotency-Key':key}}),{...env,DOCUMENT_ARTIFACTS:bucket});expect(response.status).toBe(500);
 const status=await (await call(`/documents/${d.id}/issue-status`)).json() as {data:{state:string;jobState:string;retryable:boolean}};expect(status.data).toMatchObject({state:'ISSUING',jobState:'FAILED',retryable:true});
 const before=await env.DB.prepare('SELECT snapshot_hash,snapshot_json FROM issue_jobs WHERE revision_id IN (SELECT id FROM document_revisions WHERE document_id=?)').bind(d.id).first();
 expect((await call(`/documents/${d.id}/issue`,'POST',{}, {'Idempotency-Key':key})).status).toBe(200);
 const after=await env.DB.prepare('SELECT snapshot_hash,snapshot_json FROM issue_jobs WHERE revision_id IN (SELECT id FROM document_revisions WHERE document_id=?)').bind(d.id).first();expect(after).toEqual(before);
 expect(await env.DB.prepare("SELECT 1 FROM audit_logs WHERE entity_id=? AND action='DOCUMENT_ISSUE_FAILED'").bind(d.id).first()).not.toBeNull();
});
it('reuses the stored PDF after a finalize failure instead of rendering again',async()=>{
 const worker=(await import('../src/server/index')).default;const d=await draft();const key=crypto.randomUUID();let batches=0;
 const wrappedDb=new Proxy(env.DB,{get(target,property){if(property==='batch')return async(statements:D1PreparedStatement[])=>{batches++;if(batches===2)throw new Error('injected finalize failure');return target.batch(statements)};const value=Reflect.get(target,property,target);return typeof value==='function'?value.bind(target):value;}});
 const request=()=>new Request(`http://localhost/api/v1/documents/${d.id}/issue`,{method:'POST',headers:{'If-Match':'1','Idempotency-Key':key}});
 expect((await worker.fetch(request(),{...env,DB:wrappedDb})).status).toBe(500);
 const job=await env.DB.prepare('SELECT object_key FROM issue_jobs WHERE revision_id IN (SELECT id FROM document_revisions WHERE document_id=?)').bind(d.id).first<{object_key:string}>();
 const artifact=await env.DOCUMENT_ARTIFACTS.head(job!.object_key);expect(artifact).not.toBeNull();
 const noBrowser=new Proxy(env.BROWSER,{get(target,property){if(property==='fetch')return ()=>{throw new Error('PDF must not be rendered again')};const value=Reflect.get(target,property,target);return typeof value==='function'?value.bind(target):value;}});
 const retry=await worker.fetch(request(),{...env,BROWSER:noBrowser});expect(retry.status).toBe(200);expect((await retry.json() as {data:{sha256:string}}).data.sha256).toBe(artifact!.customMetadata!.sha256);
 const counts=await env.DB.prepare('SELECT (SELECT COUNT(*) FROM number_reservations WHERE document_id=?) reservations,(SELECT COUNT(*) FROM document_files WHERE revision_id IN (SELECT id FROM document_revisions WHERE document_id=?)) files').bind(d.id,d.id).first();expect(counts).toEqual({reservations:1,files:1});
});
it('fences a late finalizer and rolls back partial financial writes',async()=>{
 const worker=(await import('../src/server/index')).default;const d=await draft();const key=crypto.randomUUID();const newToken=crypto.randomUUID();let batches=0;
 const wrappedDb=new Proxy(env.DB,{get(target,property){if(property==='batch')return async(statements:D1PreparedStatement[])=>{batches++;if(batches===2){await env.DB.prepare("UPDATE issue_jobs SET state='RENDERING',lease_token=?,lease_expires_at=? WHERE revision_id IN (SELECT id FROM document_revisions WHERE document_id=?)").bind(newToken,new Date(Date.now()+90000).toISOString(),d.id).run();}return target.batch(statements)};const value=Reflect.get(target,property,target);return typeof value==='function'?value.bind(target):value;}});
 const response=await worker.fetch(new Request(`http://localhost/api/v1/documents/${d.id}/issue`,{method:'POST',headers:{'If-Match':'1','Idempotency-Key':key}}),{...env,DB:wrappedDb});expect(response.status).toBe(500);
 const state=await env.DB.prepare('SELECT r.state,d.current_issued_revision_id,j.state job_state,j.lease_token FROM documents d JOIN document_revisions r ON r.id=d.active_draft_revision_id JOIN issue_jobs j ON j.revision_id=r.id WHERE d.id=?').bind(d.id).first();expect(state).toMatchObject({state:'ISSUING',current_issued_revision_id:null,job_state:'RENDERING',lease_token:newToken});
 expect(await env.DB.prepare('SELECT 1 FROM document_files WHERE revision_id IN (SELECT id FROM document_revisions WHERE document_id=?)').bind(d.id).first()).toBeNull();
 expect((await (await call(`/documents/${d.id}/issue-status`)).json() as {data:{retryable:boolean}}).data.retryable).toBe(false);
 expect((await call(`/documents/${d.id}/abandon-revision`,'POST',{revision:1,reason:'実行中の検証'})).status).toBe(409);
 await env.DB.prepare('UPDATE issue_jobs SET lease_expires_at=? WHERE revision_id IN (SELECT id FROM document_revisions WHERE document_id=?)').bind(new Date(Date.now()-1000).toISOString(),d.id).run();
 expect((await call(`/documents/${d.id}/issue`,'POST',{}, {'Idempotency-Key':key})).status).toBe(200);
});

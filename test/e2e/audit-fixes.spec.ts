import { test,expect,type Page } from '@playwright/test';

const organization={id:'local-organization',legal_name:'監査株式会社',display_name:'監査株式会社',postal_code:'',prefecture:'',address:'',building:'',phone:'',representative:'',default_tax_mode:'exclusive',tax_rounding:'floor',line_rounding:'floor',theme:'standard',accent_color:'#315b78',qualified_mode:0,registration_number:null,fax:'',email:'',website:'',logo_asset_id:null,seal_asset_id:null,quotation_title:'御見積書',purchase_order_title:'発注書',delivery_show_amounts:0,bank:{bankName:'',branchName:'',accountType:'ORDINARY',accountNumber:'',accountHolder:'',note:''},defaults:{paymentTerms:'',quoteValidDays:30,dueRule:'NEXT_MONTH_END',quoteNotes:'',invoiceNotes:''},numbering:{QT:'QT-{YYYY}-{####}',DN:'DN-{YYYY}-{####}',INV:'INV-{YYYY}-{####}',RC:'RC-{YYYY}-{####}',PO:'PO-{YYYY}-{####}',OC:'OC-{YYYY}-{####}'}};
const initialData={type:'INV',recipientName:'監査顧客',recipientPostalCode:'',recipientAddress:'',recipientBuilding:'',recipientPhone:'',department:'',contactName:'',recipientOverride:'',subject:'検証',issueDate:'2026-09-29',transactionDate:'2026-09-29',dueDate:'2026-10-31',notes:'',taxMode:'exclusive',showAmounts:false,deliveryPlace:'',paymentTerms:'',purchaseOrderNumber:'',quotationReference:'',purpose:'',paymentMethod:'BANK_TRANSFER',lines:[{id:'test-line',description:'検証商品',quantity:'1',unit:'個',unitPrice:'1000',taxClass:'STANDARD_10'}]};
async function fixtures(page:Page,initialState='DRAFT'){
 let state=initialState,version=1,attempts=0,patches=0;let data={...initialData};
 const selectedProduct={id:'late-product',code:'PAGE-104',name:'検索した商品',description:'',unit:'式',unit_price_decimal:'2000',tax_class:'STANDARD_10'};
 const selectedPartner={id:'late-partner',name:'検索した顧客',postal_code:'123',prefecture:'東京都',address:'住所',building:'',phone:''};
 await page.route('**/api/v1/**',async route=>{
  const req=route.request();const url=new URL(req.url());const path=url.pathname;let result:unknown=[];let nextCursor:string|null=null;
  if(path.endsWith('/organization'))result=organization;
  else if(path.endsWith('/session'))result={actor:{id:'audit-admin',role:'ADMIN',name:'監査',email:'audit@example.com'}};
  else if(path.endsWith('/documents/test')&&req.method()==='GET')result={id:'test',version,revision:0,number:state==='ISSUED'?'INV-2026-0001':'',status:state,sentAt:null,data,issuer:{legalName:'監査株式会社'},theme:'standard',accentColor:'#315b78',tax:{mode:data.taxMode,lineRounding:'floor',taxRounding:'floor'}};
  else if(path.endsWith('/documents/test')&&req.method()==='PATCH'){patches++;version++;data=req.postDataJSON();result={saved:true,version};}
  else if(path.endsWith('/issue-status'))result={state,version,jobState:'FAILED',attemptCount:1,retryable:state==='ISSUING'};
  else if(path.endsWith('/issue')){
    attempts++;
    if(attempts===1&&initialState==='DRAFT'){expect(req.headers()['if-match']).toBe('2');state='ISSUING';await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:{code:'ISSUE_FAILED',message:'PDFを発行できませんでした。'}})});return;}
    state='ISSUED';result={issued:true,number:'INV-2026-0001',pdfUrl:'/api/v1/documents/test/revisions/0/pdf',sha256:'test-hash'};
  }
  else if(path.endsWith('/preview')){await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:{message:'PDFプレビューの生成に失敗しました。'}})});return;}
  else if(path.endsWith('/payments'))result={totalYen:1100,paidYen:0,outstandingYen:1100,status:'UNPAID',payments:[]};
  else if(path.endsWith('/products')){const query=url.searchParams.get('q');const cursor=url.searchParams.get('cursor');result=query==='PAGE-104'||cursor?[selectedProduct]:[{...selectedProduct,id:'first-product',code:'FIRST',name:'最初の商品'}];nextCursor=!query&&!cursor?'products-next':null;}
  else if(path.endsWith('/counterparties')){const query=url.searchParams.get('q');const cursor=url.searchParams.get('cursor');result=query==='検索した顧客'||cursor?[selectedPartner]:[{...selectedPartner,id:'first-partner',name:'最初の顧客'}];nextCursor=!query&&!cursor?'partners-next':null;}
  else if(path.endsWith('/documents')){const cursor=url.searchParams.get('cursor');result=[{id:cursor?'late-document':'first-document',type:'INV',number:cursor?'INV-LATE':'INV-FIRST',revision:0,state:'ISSUED',subject:'検証',issue_date:'2026-09-29',due_date:'2026-10-31',total_yen:1100,recipient_search_name:'監査顧客',counterparty_id:null,paid_yen:0,payment_status:'UNPAID',overdue:0,has_correction:1}];nextCursor=cursor?null:'documents-next';}
  await route.fulfill({contentType:'application/json',body:JSON.stringify({data:result,nextCursor})});
 });
 return {patches:()=>patches,attempts:()=>attempts};
}
test('saved draft tax totals and live preview agree in both tax modes',async({page})=>{
 await fixtures(page);await page.goto('/documents/test/edit');
 await page.getByRole('button',{name:'税込',exact:true}).click();
 await expect(page.locator('.totals-grand')).toContainText('¥1,000');
 await expect(page.frameLocator('iframe[title="A4帳票プレビュー"]').locator('.grand-total')).toContainText('¥1,000');
 await page.getByRole('button',{name:'税抜',exact:true}).click();
 await expect(page.locator('.totals-grand')).toContainText('¥1,100');
 await expect(page.frameLocator('iframe[title="A4帳票プレビュー"]').locator('.grand-total')).toContainText('¥1,100');
});
test('shows a render failure and retries without saving the frozen revision',async({page})=>{
 const f=await fixtures(page);await page.goto('/documents/test/edit');page.on('dialog',d=>d.accept());
 await page.getByRole('button',{name:'発行',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('PDFを発行できませんでした。');
 await page.reload();await expect(page.getByRole('button',{name:'発行を再試行',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'発行を再試行',exact:true}).click();
 await expect(page.locator('.editor-title-line')).toContainText('発行済み');expect(f.patches()).toBe(1);expect(f.attempts()).toBe(2);
});
test('shows draft PDF preview errors',async({page})=>{
 await fixtures(page);await page.goto('/documents/test/edit');await page.getByRole('button',{name:'▧　PDFプレビュー'}).click();
 await expect(page.getByRole('alert')).toContainText('PDFプレビューの生成に失敗しました。');
});
test('master pickers load further pages and search server-side',async({page})=>{
 await fixtures(page);await page.goto('/documents/test/edit');
 await page.getByRole('button',{name:'商品をさらに表示'}).click();await expect(page.locator('option[value="late-product"]')).toHaveCount(1);
 await page.getByRole('button',{name:'取引先をさらに表示'}).click();await expect(page.locator('option[value="late-partner"]')).toHaveCount(1);
 await page.getByText('商品マスターを検索',{exact:true}).locator('..').getByRole('textbox').fill('PAGE-104');
 await expect(page.locator('option[value="first-product"]')).toHaveCount(0);await expect(page.locator('option[value="late-product"]')).toHaveCount(1);
 await page.locator('.product-picker select').selectOption('late-product');await expect(page.getByText('品名・内容',{exact:false}).locator('..').getByRole('textbox')).toHaveValue('検索した商品');
 await page.getByText('取引先マスターを検索',{exact:true}).locator('..').getByRole('textbox').fill('検索した顧客');
 await expect(page.locator('option[value="first-partner"]')).toHaveCount(0);await page.locator('select').filter({has:page.locator('option[value="late-partner"]')}).selectOption('late-partner');
 await expect(page.getByPlaceholder('例：株式会社ABC')).toHaveValue('検索した顧客');
});
test('document and master lists expose additional pages',async({page})=>{
 await fixtures(page);await page.goto('/documents');await expect(page.getByText('INV-FIRST',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'帳票をさらに表示'}).click();await expect(page.getByText('INV-LATE',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'帳票をさらに表示'})).toHaveCount(0);
 await page.goto('/products');await page.getByRole('button',{name:'さらに表示',exact:true}).click();await expect(page.getByText('PAGE-104',{exact:true})).toBeVisible();
});
test('new documents start from the organization defaults and the guide and settings are reachable',async({page})=>{
 await fixtures(page);await page.goto('/documents/new?type=INV');
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo'}).format(new Date());const [year,month]=today.split('-').map(Number);
 const nextMonthEnd=new Date(Date.UTC(year,month+1,0)).toISOString().slice(0,10);
 await expect(page.getByText('支払期限',{exact:false}).locator('..').locator('input[type=date]')).toHaveValue(nextMonthEnd);
 const preview=page.frameLocator('iframe[title="A4帳票プレビュー"]');
 await expect(preview.locator('h1')).toHaveText('請求書');await expect(preview.locator('.items thead')).toContainText('単価');await expect(preview.locator('.breakdown')).toContainText('10%対象');
 await page.getByRole('button',{name:'？　使い方ガイド'}).click();await expect(page.getByRole('heading',{name:'使い方ガイド'})).toBeVisible();
 await page.getByRole('button',{name:'Tiếng Việt'}).click();await expect(page.getByRole('heading',{name:'Hướng dẫn sử dụng'})).toBeVisible();
 await page.goto('/settings/bank');await expect(page.getByRole('heading',{name:'振込先'})).toBeVisible();
 await page.goto('/settings/documents');await expect(page.getByText('例：INV-'+year+'-0001')).toBeVisible();
});

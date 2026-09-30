import { chromium } from '@playwright/test';
const browser=await chromium.launch({headless:true,executablePath:'/Users/tranhaibang/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'});
const page=await browser.newPage();
const organization={id:'local-organization',legal_name:'監査株式会社',display_name:'監査株式会社',postal_code:'',prefecture:'',address:'',building:'',phone:'',representative:'',default_tax_mode:'exclusive',tax_rounding:'floor',line_rounding:'floor',theme:'standard',accent_color:'#315b78',qualified_mode:0,registration_number:null};
const data={type:'INV',recipientName:'監査顧客',recipientPostalCode:'',recipientAddress:'',recipientBuilding:'',recipientPhone:'',department:'',contactName:'',recipientOverride:'',subject:'検証',issueDate:'2026-09-29',transactionDate:'2026-09-29',dueDate:'2026-10-31',notes:'',taxMode:'exclusive',showAmounts:false,deliveryPlace:'',paymentTerms:'',purchaseOrderNumber:'',quotationReference:'',purpose:'',paymentMethod:'BANK_TRANSFER',lines:[{id:'test-line',description:'検証商品',quantity:'1',unit:'個',unitPrice:'1000',taxClass:'STANDARD_10'}]};
let state='DRAFT';const writes=[];
await page.route('**/api/v1/**',async route=>{
 const req=route.request();const path=new URL(req.url()).pathname;let result=[];
 if(path.endsWith('/organization'))result=organization;
 else if(path.endsWith('/session'))result={actor:{role:'ADMIN',name:'監査',email:'audit@example.com'}};
 else if(path.endsWith('/documents/test/edit'))throw Error('unexpected API');
 else if(path.endsWith('/documents/test')&&req.method()==='GET')result={id:'test',version:1,revision:0,number:'',status:state,sentAt:null,data,issuer:{legalName:'監査株式会社'},theme:'standard',accentColor:'#315b78',tax:{mode:'exclusive',lineRounding:'floor',taxRounding:'floor'}};
 else if(path.endsWith('/documents/test')&&req.method()==='PATCH'){writes.push({path,method:'PATCH'});result={saved:true,version:2};}
 else if(path.endsWith('/issue')){await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:{code:'ISSUE_FAILED',message:'PDFを発行できませんでした。'}})});return;}
 await route.fulfill({contentType:'application/json',body:JSON.stringify({data:result})});
});
await page.goto('http://127.0.0.1:8799/documents/test/edit');
await page.getByRole('button',{name:'税込',exact:true}).waitFor();
await page.getByRole('button',{name:'税込',exact:true}).click();
await page.waitForTimeout(100);
const formTotal=await page.locator('.totals-grand').innerText();
const previewTotal=await page.frameLocator('iframe[title="A4帳票プレビュー"]').locator('.grand-total').innerText();
console.log(JSON.stringify({probe:'UI01_tax_mode',formTotal,previewTotal}));
if(!formTotal.includes('1,000')||!previewTotal.includes('1,100'))throw Error('expected mismatch not observed');
page.on('dialog',d=>d.accept());await page.getByRole('button',{name:'発行',exact:true}).click();
await page.waitForTimeout(350);
console.log(JSON.stringify({probe:'UI02_issue_error',visibleAlerts:await page.locator('[role="alert"]').allTextContents(),issueButtonPresent:await page.getByRole('button',{name:'発行',exact:true}).count()}));
state='ISSUING';await page.reload();await page.getByText('発行処理中',{exact:true}).waitFor();
console.log(JSON.stringify({probe:'UI03_retry_after_reload',issueButtonCount:await page.getByRole('button',{name:'発行',exact:true}).count(),retryButtonCount:await page.getByRole('button',{name:/再試行|retry/i}).count()}));
await browser.close();

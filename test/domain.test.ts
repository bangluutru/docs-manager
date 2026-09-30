import { describe, expect, it } from "vitest";
import { calculateDocumentTax } from "../src/domain/tax";
import { formatDocumentNumber } from "../src/domain/numbering";
import { isOverdue, paymentState } from "../src/domain/payments";
import { recipientLine, type DraftDocument } from "../src/domain/document";
import { renderDocumentHtml, renderDocumentPreview } from "../src/jds/render";

const line=(id:string,unitPrice:string,taxClass:"STANDARD_10"|"REDUCED_8"|"NON_TAXABLE"|"OUT_OF_SCOPE"|"EXEMPT"="STANDARD_10")=>({id,description:"作業一式",quantity:"1",unit:"式",unitPrice,taxClass});
describe("document tax",()=>{
  it("calculates standard and reduced tax once per rate and keeps zero-tax classes separate",()=>{
    const result=calculateDocumentTax([line("a","1001"),line("b","1001","REDUCED_8"),line("c","500","NON_TAXABLE")],{mode:"exclusive",lineRounding:"floor",taxRounding:"floor"});
    expect(result.subtotalYen).toBe(2502);
    expect(result.taxYen).toBe(180);
    expect(result.totalYen).toBe(2682);
    expect(result.groups).toHaveLength(3);
  });
  it("rounds tax once per class rather than once per line",()=>{
    const result=calculateDocumentTax([line("a","5"),line("b","5")],{mode:"exclusive",lineRounding:"floor",taxRounding:"floor"});
    expect(result.taxYen).toBe(1);
  });
  it("supports tax-inclusive prices and each rounding policy",()=>{
    const inclusive=calculateDocumentTax([line("a","1100")],{mode:"inclusive",lineRounding:"floor",taxRounding:"floor"});
    expect(inclusive).toMatchObject({subtotalYen:1000,taxYen:100,totalYen:1100});
    expect(calculateDocumentTax([line("a","105")],{mode:"exclusive",lineRounding:"floor",taxRounding:"floor"}).taxYen).toBe(10);
    expect(calculateDocumentTax([line("a","105")],{mode:"exclusive",lineRounding:"floor",taxRounding:"half-up"}).taxYen).toBe(11);
    expect(calculateDocumentTax([line("a","101")],{mode:"exclusive",lineRounding:"floor",taxRounding:"ceil"}).taxYen).toBe(11);
  });
  it("rejects zero quantities, excessive precision, and empty documents",()=>{
    expect(()=>calculateDocumentTax([line("a","100")],{mode:"exclusive",lineRounding:"floor",taxRounding:"floor"})).not.toThrow();
    expect(()=>calculateDocumentTax([{...line("a","100"),quantity:"0"}],{mode:"exclusive",lineRounding:"floor",taxRounding:"floor"})).toThrow();
    expect(()=>calculateDocumentTax([line("a","1.00001")],{mode:"exclusive",lineRounding:"floor",taxRounding:"floor"})).toThrow();
    expect(()=>calculateDocumentTax([],{mode:"exclusive",lineRounding:"floor",taxRounding:"floor"})).toThrow();
  });
});
describe("numbering and payment state",()=>{
  it("formats independent yearly sequences without truncating overflow",()=>{
    expect(formatDocumentNumber("INV-{YYYY}-{####}",2026,1)).toBe("INV-2026-0001");
    expect(()=>formatDocumentNumber("INV-{YYYY}-{####}",2026,10000)).toThrow();
    expect(()=>formatDocumentNumber("INV-{####}-{####}",2026,1)).toThrow();
  });
  it("derives partial/full balances and JST overdue boundaries",()=>{
    expect(paymentState(1000,0)).toEqual({status:"UNPAID",outstandingYen:1000});
    expect(paymentState(1000,400)).toEqual({status:"PARTIALLY_PAID",outstandingYen:600});
    expect(paymentState(1000,1000)).toEqual({status:"PAID",outstandingYen:0});
    expect(isOverdue("2026-09-28","2026-09-29",1)).toBe(true);
    expect(isOverdue("2026-09-29","2026-09-29",1)).toBe(false);
  });
  it("formats company and individual recipients without combining honorifics",()=>{
    expect(recipientLine({recipientName:"株式会社ABC",department:"",contactName:"",recipientOverride:""})).toEqual(["株式会社ABC 御中"]);
    expect(recipientLine({recipientName:"株式会社ABC",department:"営業部",contactName:"田中 太郎",recipientOverride:""})).toEqual(["株式会社ABC","営業部","田中 太郎 様"]);
    expect(recipientLine({recipientName:"株式会社ABC",department:"",contactName:"",recipientOverride:"特別御中"})).toEqual(["特別御中"]);
  });
});
describe("JDS document renderer",()=>{
  it("prints the qualified-invoice items: registration number, per-rate totals and taxes, reduced-rate mark and bank account",()=>{
    const data={type:"INV" as const,recipientName:"株式会社ABC",recipientPostalCode:"",recipientAddress:"",recipientBuilding:"",recipientPhone:"",department:"",contactName:"",recipientOverride:"",subject:"10月分",issueDate:"2026-10-01",transactionDate:"2026-09-30",dueDate:"2026-10-31",notes:"",taxMode:"exclusive" as const,showAmounts:false,deliveryTerms:"",deliveryPlace:"",paymentTerms:"",purchaseOrderNumber:"",quotationReference:"",purpose:"",paymentMethod:"BANK_TRANSFER" as const,lines:[line("a","1000"),line("b","1000","REDUCED_8")]};
    const html=renderDocumentHtml({id:"fixture",number:"INV-2026-0001",revision:1,status:"ISSUED",data,issuer:{legalName:"株式会社サンプル",registrationNumber:"T1234567890123"},theme:"standard",accentColor:"#315b78",tax:{mode:"exclusive",lineRounding:"floor",taxRounding:"floor"},bank:{bankName:"みずほ銀行",branchName:"丸の内支店",accountType:"CHECKING",accountNumber:"7654321",accountHolder:"カ）サンプル"},assets:{sealUrl:"/api/v1/brand-assets/seal-1"},titles:{QT:"見積書"}});
    for(const text of ["登録番号：T1234567890123","<td>10%対象</td><td>¥1,000</td><td>¥100</td>","<td>8%対象 ※</td><td>¥1,000</td><td>¥80</td>","8%※","※印は軽減税率（8%）対象品目です。","<th>消費税（8%）</th><td>¥80</td>","¥2,180","お振込先","みずほ銀行　丸の内支店","当座　7654321","口座名義：カ）サンプル","<th>お支払期限</th><td>2026年10月31日</td>","INV-2026-0001（改訂1）",'src="/api/v1/brand-assets/seal-1"',"単価"])expect(html).toContain(text);
  });
  it("uses the configured quotation title, hides the bank block outside invoices and marks receipts",()=>{
    const data={type:"QT" as const,recipientName:"株式会社ABC",recipientPostalCode:"",recipientAddress:"",recipientBuilding:"",recipientPhone:"",department:"",contactName:"",recipientOverride:"",subject:"",issueDate:"2026-10-01",validUntil:"2026-10-31",notes:"",taxMode:"inclusive" as const,showAmounts:false,deliveryTerms:"受注後2週間",deliveryPlace:"",paymentTerms:"",purchaseOrderNumber:"",quotationReference:"",purpose:"商品代として",paymentMethod:"CASH" as const,lines:[line("a","110000")]};
    const view={id:"fixture",number:"",revision:0,status:"DRAFT",issuer:{legalName:"株式会社サンプル"},theme:"modern" as const,accentColor:"#1f4e79",tax:{mode:"inclusive" as const,lineRounding:"floor" as const,taxRounding:"floor" as const},bank:{bankName:"みずほ銀行",accountNumber:"1"},titles:{QT:"見積書"}};
    const quote=renderDocumentHtml({...view,data});
    expect(quote).toContain("<h1>見積書</h1>");expect(quote).not.toContain("お振込先");expect(quote).toMatch(/<th>納期<\/th><td[^>]*>受注後2週間<\/td>/);expect(quote).toContain("<th>内消費税（10%）</th><td>¥10,000</td>");expect(quote).toContain("下書き・未採番");
    const receipt=renderDocumentHtml({...view,data:{...data,type:"RC"}});
    expect(receipt).toContain("¥110,000－");expect(receipt).toContain("但し、商品代として");expect(receipt).toContain("上記正に領収いたしました。");expect(receipt).toContain("収入印紙");
    expect(renderDocumentHtml({...view,data:{...data,type:"RC",paymentMethod:"BANK_TRANSFER"}})).not.toContain("revenue-stamp\"");
  });
  it("renders all six Japanese document types with valid escaping and A4 geometry",()=>{
    const base={recipientName:"株式会社ABC",department:"営業部",contactName:"田中 太郎",recipientOverride:"",subject:"テスト<&>",issueDate:"2026-09-29",notes:"",taxMode:"exclusive" as const,showAmounts:false,deliveryTerms:"",deliveryPlace:"",paymentTerms:"",purchaseOrderNumber:"",quotationReference:"",purpose:"",paymentMethod:"BANK_TRANSFER" as const,lines:[line("a","1000")]};
    for(const type of ["QT","DN","INV","RC","PO","OC"] as const){
      const data={...base,type,acceptedDate:type==="OC"?"2026-09-30":undefined} as DraftDocument;
      const html=renderDocumentHtml({id:"fixture",number:"",revision:0,status:"DRAFT",data,issuer:{legalName:"株式会社サンプル"},theme:"standard",accentColor:"#315b78",tax:{mode:"exclusive",lineRounding:"floor",taxRounding:"floor"}});
      expect(html).toContain("size: A4 portrait");expect(html).toContain("株式会社ABC");expect(html).toContain("&lt;&amp;&gt;");expect(html).toContain({QT:"御見積書",DN:"納品書",INV:"請求書",RC:"領収書",PO:"発注書",OC:"注文請書"}[type]);
      if(type==="DN")expect(html).not.toContain("¥1,000");
      if(type==="OC"){expect(html).toContain("受注確認金額");expect(html).toMatch(/<th>受注日<\/th><td[^>]*>2026年9月30日<\/td>/)}
    }
  });
  it("keeps the last valid draft preview when an incomplete numeric field cannot render",()=>{
    const data={type:"QT" as const,recipientName:"株式会社ABC",recipientPostalCode:"",recipientAddress:"",recipientBuilding:"",recipientPhone:"",department:"",contactName:"",recipientOverride:"",subject:"",issueDate:"2026-09-29",notes:"",taxMode:"exclusive" as const,showAmounts:false,deliveryTerms:"",deliveryPlace:"",paymentTerms:"",purchaseOrderNumber:"",quotationReference:"",purpose:"",paymentMethod:"BANK_TRANSFER" as const,validUntil:"2026-10-01",lines:[{...line("a","1000"),quantity:""}]};
    const fallback="<p>previous valid preview</p>";
    const result=renderDocumentPreview({id:"fixture",number:"",revision:0,status:"DRAFT",data,issuer:{legalName:"株式会社サンプル"},theme:"standard",accentColor:"#315b78",tax:{mode:"exclusive",lineRounding:"floor",taxRounding:"floor"}},fallback);
    expect(result).toEqual({html:fallback,stale:true});
  });
  it("prints an invoice transaction date or complete transaction period",()=>{
    const base={type:"INV" as const,recipientName:"株式会社ABC",recipientPostalCode:"",recipientAddress:"",recipientBuilding:"",recipientPhone:"",department:"",contactName:"",recipientOverride:"",subject:"取引日確認",issueDate:"2026-09-29",notes:"",taxMode:"exclusive" as const,showAmounts:false,deliveryTerms:"",deliveryPlace:"",paymentTerms:"",purchaseOrderNumber:"",quotationReference:"",purpose:"",paymentMethod:"BANK_TRANSFER" as const,lines:[line("a","1000")]};
    const render=(data:DraftDocument)=>renderDocumentHtml({id:"fixture",number:"",revision:0,status:"DRAFT",data,issuer:{legalName:"株式会社サンプル"},theme:"standard",accentColor:"#315b78",tax:{mode:"exclusive",lineRounding:"floor",taxRounding:"floor"}});
    expect(render({...base,transactionDate:"2026-09-28"})).toMatch(/<th>取引年月日<\/th><td[^>]*>2026年9月28日<\/td>/);
    expect(render({...base,periodStart:"2026-09-01",periodEnd:"2026-09-30"})).toMatch(/<th>取引期間<\/th><td[^>]*>2026年9月1日 ～ 2026年9月30日<\/td>/);
  });
});

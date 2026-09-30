import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import type { DraftDocument, DocumentType } from "../../src/domain/document";
import { pdfOptions, renderDocumentHtml, type DocumentViewModel } from "../../src/jds/render";

// Renders every document type through the production renderer into real A4 PDFs.
// The PDFs are kept in test-results/samples for visual review.
const outDir = "test-results/samples";
const seal = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="6" y="6" width="88" height="88" rx="6" fill="none" stroke="#c8372d" stroke-width="5"/><text x="50" y="44" font-size="26" text-anchor="middle" fill="#c8372d" font-family="serif">山田</text><text x="50" y="76" font-size="26" text-anchor="middle" fill="#c8372d" font-family="serif">商事</text></svg>`)}`;
const line = (index: number, description: string, quantity: string, unit: string, unitPrice: string, taxClass: DraftDocument["lines"][number]["taxClass"] = "STANDARD_10") => ({ id: `line-${index}`, description, quantity, unit, unitPrice, taxClass });
const lines = [
  line(1, "Webサイト制作（デザイン・コーディング一式）", "1", "式", "480000"),
  line(2, "CMS導入・初期設定", "1", "式", "120000"),
  line(3, "保守サポート（10月分）", "12.5", "時間", "8000"),
  line(4, "打ち合わせ用お弁当", "6", "個", "1200", "REDUCED_8"),
  line(5, "登録免許税（立替分）", "1", "件", "30000", "NON_TAXABLE"),
];
function sample(type: DocumentType, overrides: Partial<DraftDocument> = {}): DraftDocument {
  return {
    type, recipientName: "株式会社青葉メディカル", recipientPostalCode: "150-0002", recipientAddress: "東京都渋谷区渋谷2-21-1", recipientBuilding: "渋谷ヒカリエ 18階", recipientPhone: "",
    department: "総務部", contactName: type === "RC" ? "" : "田中 太郎", recipientOverride: "", subject: "コーポレートサイトリニューアル", issueDate: "2026-10-01",
    transactionDate: type === "INV" ? "2026-09-30" : undefined, dueDate: type === "INV" ? "2026-10-31" : undefined, validUntil: type === "QT" ? "2026-10-31" : undefined,
    deliveryDate: type === "DN" || type === "OC" ? "2026-10-15" : undefined, requestedDeliveryDate: type === "PO" ? "2026-10-20" : undefined, acceptedDate: type === "OC" ? "2026-10-01" : undefined,
    deliveryTerms: "ご発注後 約3週間", deliveryPlace: "貴社指定場所", paymentTerms: "月末締め翌月末払い（銀行振込）", purchaseOrderNumber: "PO-88213", quotationReference: "QT-2026-0012",
    purpose: "コーポレートサイトリニューアル代として", paymentMethod: type === "RC" ? "CASH" : "BANK_TRANSFER",
    notes: "・本書の内容についてご不明な点がございましたら、担当までお問い合わせください。\n・納品後の仕様変更は別途お見積りとなります。", taxMode: "exclusive", showAmounts: false, lines, ...overrides,
  };
}
function view(data: DraftDocument, theme: "standard" | "modern", number: string): DocumentViewModel {
  return {
    id: "sample", number, revision: 0, status: "ISSUED", data, theme, accentColor: "#1f4e79",
    issuer: { legalName: "山田商事株式会社", representative: "代表取締役　山田 一郎", postalCode: "100-0005", address: "東京都千代田区丸の内1-9-2 グラントウキョウサウスタワー 12階", phone: "03-1234-5678", fax: "03-1234-5679", email: "info@yamada-shoji.example", registrationNumber: "T1234567890123", qualifiedMode: true },
    tax: { mode: data.taxMode, lineRounding: "floor", taxRounding: "floor" },
    bank: { bankName: "みずほ銀行", branchName: "丸の内支店", accountType: "ORDINARY", accountNumber: "1234567", accountHolder: "ヤマダシヨウジ（カ", note: "" },
    assets: { sealUrl: seal },
  };
}
const numbers: Record<DocumentType, string> = { QT: "QT-2026-0012", DN: "DN-2026-0031", INV: "INV-2026-0045", RC: "RC-2026-0008", PO: "PO-2026-0004", OC: "OC-2026-0006" };

test.beforeAll(() => mkdirSync(outDir, { recursive: true }));

for (const theme of ["standard", "modern"] as const) {
  for (const type of ["QT", "DN", "INV", "RC", "PO", "OC"] as const) {
    test(`${type} renders on a single A4 page without overflow (${theme})`, async ({ page }) => {
      const model = view(sample(type), theme, numbers[type]);
      await page.setContent(renderDocumentHtml(model), { waitUntil: "load" });
      const overflow = await page.evaluate(() => {
        const sheet = document.querySelector(".sheet")!.getBoundingClientRect();
        const padding = parseFloat(getComputedStyle(document.querySelector(".sheet")!).paddingRight);
        return [...document.querySelectorAll<HTMLElement>(".sheet *")].filter((node) => { const box = node.getBoundingClientRect(); return box.width > 0 && (box.right > sheet.right - padding + 1 || box.left < sheet.left + padding - 1); }).map((node) => node.className || node.tagName);
      });
      expect(overflow).toEqual([]);
      const pdf = await page.pdf(pdfOptions(model));
      writeFileSync(`${outDir}/${type}-${theme}.pdf`, pdf);
      expect(new TextDecoder("latin1").decode(pdf).match(/\/Type\s*\/Page[^s]/g)?.length).toBe(1);
    });
  }
}

test("a long invoice paginates with repeated column headings", async ({ page }) => {
  const many = Array.from({ length: 60 }, (_, index) => line(index, `定期メンテナンス作業 第${index + 1}回`, "2", "回", "15000"));
  const model = view(sample("INV", { lines: many, taxMode: "inclusive" }), "standard", numbers.INV);
  await page.setContent(renderDocumentHtml(model), { waitUntil: "load" });
  const pdf = await page.pdf(pdfOptions(model));
  writeFileSync(`${outDir}/INV-long.pdf`, pdf);
  expect(new TextDecoder("latin1").decode(pdf).match(/\/Type\s*\/Page[^s]/g)?.length).toBeGreaterThanOrEqual(3);
});

import { divideRounded, parseDecimal, type RoundingMode } from "./money";

export const TAX_RATES = {
  STANDARD_10: 10,
  REDUCED_8: 8,
  NON_TAXABLE: 0,
  OUT_OF_SCOPE: 0,
  EXEMPT: 0,
} as const;
export type TaxClass = keyof typeof TAX_RATES;
export type TaxMode = "exclusive" | "inclusive";

export interface TaxLineInput {
  id: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  taxClass: TaxClass;
}

export interface TaxLineResult extends TaxLineInput { amountYen: number }
export interface TaxGroupResult {
  taxClass: TaxClass;
  rate: number;
  netYen: number;
  taxYen: number;
  grossYen: number;
}
export interface TaxCalculation {
  lines: TaxLineResult[];
  groups: TaxGroupResult[];
  subtotalYen: number;
  taxYen: number;
  totalYen: number;
}

export interface TaxSettings {
  mode: TaxMode;
  lineRounding: RoundingMode;
  taxRounding: RoundingMode;
}

const MAX_TOTAL = 999_999_999_999;

export function calculateDocumentTax(lines: TaxLineInput[], settings: TaxSettings): TaxCalculation {
  if (!lines.length) throw new Error("明細を1件以上追加してください。");
  if (lines.length > 200) throw new Error("明細は200件まで登録できます。");

  const amounts = new Map<TaxClass, bigint>();
  const results = lines.map((line) => {
    const quantity = parseDecimal(line.quantity);
    const price = parseDecimal(line.unitPrice);
    if (quantity.units <= 0n) throw new Error("数量は0より大きい値を入力してください。");
    const numerator = quantity.units * price.units;
    const denominator = quantity.scale * price.scale;
    const amount = divideRounded(numerator, denominator, settings.lineRounding);
    if (amount > BigInt(MAX_TOTAL)) throw new Error("明細金額が上限を超えています。");
    amounts.set(line.taxClass, (amounts.get(line.taxClass) ?? 0n) + amount);
    return { ...line, amountYen: Number(amount) };
  });

  const groups = [...amounts.entries()].map(([taxClass, amount]) => {
    const rate = TAX_RATES[taxClass];
    let net: bigint;
    let tax: bigint;
    let gross: bigint;
    if (settings.mode === "exclusive") {
      net = amount;
      tax = rate === 0 ? 0n : divideRounded(amount * BigInt(rate), 100n, settings.taxRounding);
      gross = net + tax;
    } else {
      gross = amount;
      tax = rate === 0 ? 0n : divideRounded(amount * BigInt(rate), BigInt(100 + rate), settings.taxRounding);
      net = gross - tax;
    }
    return {
      taxClass,
      rate,
      netYen: Number(net),
      taxYen: Number(tax),
      grossYen: Number(gross),
    } satisfies TaxGroupResult;
  });

  const subtotal = groups.reduce((sum, group) => sum + BigInt(group.netYen), 0n);
  const tax = groups.reduce((sum, group) => sum + BigInt(group.taxYen), 0n);
  const total = settings.mode === "exclusive"
    ? subtotal + tax
    : groups.reduce((sum, group) => sum + BigInt(group.grossYen), 0n);
  if (total > BigInt(MAX_TOTAL)) throw new Error("合計金額が上限を超えています。");
  return {
    lines: results,
    groups,
    subtotalYen: Number(subtotal),
    taxYen: Number(tax),
    totalYen: Number(total),
  };
}

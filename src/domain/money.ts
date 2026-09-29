export type RoundingMode = "floor" | "half-up" | "ceil";

export function parseDecimal(value: string, maxScale = 4): { units: bigint; scale: bigint } {
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) throw new Error("金額・数量は0以上の小数で入力してください。");
  const fraction = match[2] ?? "";
  if (fraction.length > maxScale) throw new Error(`小数点以下は${maxScale}桁まで入力できます。`);
  const scale = 10n ** BigInt(fraction.length);
  return { units: BigInt(match[1] + fraction), scale };
}

export function divideRounded(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  if (denominator <= 0n || numerator < 0n) throw new Error("税額計算に使用できない値です。");
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n || mode === "floor") return quotient;
  if (mode === "ceil") return quotient + 1n;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

export function formatYen(value: number | bigint): string {
  const amount = typeof value === "bigint" ? value : BigInt(value);
  return `¥${new Intl.NumberFormat("ja-JP").format(amount)}`;
}

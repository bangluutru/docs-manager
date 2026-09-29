const TOKEN = /\{YYYY\}|\{#{4,}\}/g;
const ALLOWED = /^[A-Za-z0-9_-]*(?:\{YYYY\}|\{#{4,}\})[A-Za-z0-9_-]*(?:(?:\{YYYY\}|\{#{4,}\})[A-Za-z0-9_-]*)*$/;

export function formatDocumentNumber(pattern: string, year: number, sequence: number): string {
  if (!ALLOWED.test(pattern)) throw new Error("採番パターンに使用できない文字があります。");
  let sequenceTokenCount = 0;
  const rendered = pattern.replace(TOKEN, (token) => {
    if (token === "{YYYY}") return String(year);
    sequenceTokenCount += 1;
    const width = token.length - 2;
    const digits = String(sequence).padStart(width, "0");
    if (digits.length > width) throw new Error("採番上限を超えました。採番パターンを変更してください。");
    return digits;
  });
  if (sequenceTokenCount !== 1 || rendered.length > 64) throw new Error("採番パターンには連番を1つ指定してください。");
  return rendered;
}

export const DEFAULT_NUMBERING: Record<string, string> = {
  QT: "QT-{YYYY}-{####}", DN: "DN-{YYYY}-{####}", INV: "INV-{YYYY}-{####}",
  RC: "RC-{YYYY}-{####}", PO: "PO-{YYYY}-{####}", OC: "OC-{YYYY}-{####}",
};

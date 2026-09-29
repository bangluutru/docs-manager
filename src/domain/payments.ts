export type PaymentStatus = "UNPAID" | "PARTIALLY_PAID" | "PAID";

export function paymentState(totalYen: number, paidYen: number): { status: PaymentStatus; outstandingYen: number } {
  if (!Number.isSafeInteger(totalYen) || !Number.isSafeInteger(paidYen) || totalYen < 0 || paidYen < 0 || paidYen > totalYen) {
    throw new Error("入金額と請求額の組み合わせが正しくありません。");
  }
  return {
    status: paidYen === totalYen ? "PAID" : paidYen === 0 ? "UNPAID" : "PARTIALLY_PAID",
    outstandingYen: totalYen - paidYen,
  };
}

export function isOverdue(dueDate: string | null, todayTokyo: string, outstandingYen: number): boolean {
  return dueDate !== null && dueDate < todayTokyo && outstandingYen > 0;
}

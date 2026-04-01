interface BoqLineInput {
  quantity: number;
  unitRate: number;
  marginPercent?: number;
}

export function calculateLineTotal(line: BoqLineInput): number {
  const base = line.quantity * line.unitRate;
  if (!line.marginPercent) {
    return Number(base.toFixed(2));
  }
  const withMargin = base + (base * line.marginPercent) / 100;
  return Number(withMargin.toFixed(2));
}

export function calculateBoqTotals(lines: BoqLineInput[]) {
  const subtotal = Number(lines.reduce((sum, line) => sum + calculateLineTotal(line), 0).toFixed(2));
  const taxAmount = Number((subtotal * 0.18).toFixed(2));
  const totalAmount = Number((subtotal + taxAmount).toFixed(2));

  return { subtotal, taxAmount, totalAmount };
}

export type FinanceExtractionItem = {
  description: string;
  sku: string | null;
  quantity: number | null;
  unit_price: number | null;
  line_total: number | null;
  tax_rate: number | null;
};

export type FinanceExtractionPayload = {
  supplier_name: string | null;
  supplier_tax_id: string | null;
  document_number: string | null;
  issue_date: string | null;
  currency: "ARS" | "USD" | null;
  subtotal: number | null;
  tax_total: number | null;
  total: number | null;
  items: FinanceExtractionItem[];
};

export type NormalizedFinanceExtraction = {
  payload: FinanceExtractionPayload;
  confidence: Record<string, unknown>;
  overallConfidence: number;
  localErrors: string[];
};

type Field = { value?: unknown; confidence?: unknown };

function field(value: unknown): Field {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Field
    : { value: null, confidence: 0 };
}

function textValue(value: unknown, max = 255): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, max) : null;
}

function numberValue(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function confidenceValue(value: unknown): number {
  const number = numberValue(value);
  return number === null ? 0 : Math.max(0, Math.min(1, number));
}

function readText(input: Record<string, unknown>, key: string, max?: number) {
  const candidate = field(input[key]);
  return { value: textValue(candidate.value, max), confidence: confidenceValue(candidate.confidence) };
}

function readNumber(input: Record<string, unknown>, key: string) {
  const candidate = field(input[key]);
  return { value: numberValue(candidate.value), confidence: confidenceValue(candidate.confidence) };
}

export function normalizeFinanceExtraction(input: unknown): NormalizedFinanceExtraction {
  const record = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const supplier = readText(record, "supplier_name");
  const taxId = readText(record, "supplier_tax_id", 32);
  const documentNumber = readText(record, "document_number", 80);
  const issueDate = readText(record, "issue_date", 10);
  const currencyField = readText(record, "currency", 3);
  const subtotal = readNumber(record, "subtotal");
  const taxTotal = readNumber(record, "tax_total");
  const total = readNumber(record, "total");
  const rawItems = Array.isArray(record.items) ? record.items.slice(0, 500) : [];
  const itemConfidences: Array<Record<string, number>> = [];
  const items = rawItems.map(raw => {
    const item = raw && typeof raw === "object" && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : {};
    const description = readText(item, "description", 500);
    const sku = readText(item, "sku", 120);
    const quantity = readNumber(item, "quantity");
    const unitPrice = readNumber(item, "unit_price");
    const lineTotal = readNumber(item, "line_total");
    const taxRate = readNumber(item, "tax_rate");
    itemConfidences.push({
      description: description.confidence,
      sku: sku.confidence,
      quantity: quantity.confidence,
      unit_price: unitPrice.confidence,
      line_total: lineTotal.confidence,
      tax_rate: taxRate.confidence,
    });
    return {
      description: description.value || "",
      sku: sku.value,
      quantity: quantity.value,
      unit_price: unitPrice.value,
      line_total: lineTotal.value,
      tax_rate: taxRate.value,
    };
  });
  const currency = currencyField.value?.toUpperCase();
  const confidence = {
    supplier_name: supplier.confidence,
    supplier_tax_id: taxId.confidence,
    document_number: documentNumber.confidence,
    issue_date: issueDate.confidence,
    currency: currencyField.confidence,
    subtotal: subtotal.confidence,
    tax_total: taxTotal.confidence,
    total: total.confidence,
    items: itemConfidences,
  };
  const scores = [
    supplier.confidence, taxId.confidence, documentNumber.confidence,
    issueDate.confidence, currencyField.confidence, subtotal.confidence,
    taxTotal.confidence, total.confidence,
    ...itemConfidences.flatMap(item => Object.values(item)),
  ];
  const payload: FinanceExtractionPayload = {
    supplier_name: supplier.value,
    supplier_tax_id: taxId.value,
    document_number: documentNumber.value,
    issue_date: issueDate.value,
    currency: currency === "ARS" || currency === "USD" ? currency : null,
    subtotal: subtotal.value,
    tax_total: taxTotal.value,
    total: total.value,
    items,
  };
  return {
    payload,
    confidence,
    overallConfidence: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0,
    localErrors: validateFinanceExtraction(payload),
  };
}

export function validateFinanceExtraction(payload: FinanceExtractionPayload): string[] {
  const errors: string[] = [];
  if (!payload.supplier_name) errors.push("supplier_name: no detectado");
  if (!payload.document_number) errors.push("document_number: no detectado");
  if (payload.currency !== "ARS" && payload.currency !== "USD") errors.push("currency: debe ser ARS o USD");
  if (payload.issue_date && !/^\d{4}-\d{2}-\d{2}$/.test(payload.issue_date)) errors.push("issue_date: formato inválido");
  if (!payload.items.length) errors.push("items: se necesita al menos una línea");
  let sum = 0;
  payload.items.forEach((item, index) => {
    const row = index + 1;
    if (!item.description.trim()) errors.push(`items[${row}].description: obligatoria`);
    if (item.quantity === null || item.quantity <= 0) errors.push(`items[${row}].quantity: debe ser mayor a cero`);
    if (item.unit_price === null || item.unit_price < 0) errors.push(`items[${row}].unit_price: inválido`);
    if (item.line_total === null || item.line_total < 0) errors.push(`items[${row}].line_total: inválido`);
    else {
      sum += item.line_total;
      if (item.quantity !== null && item.unit_price !== null && Math.abs(item.line_total - item.quantity * item.unit_price) > 0.02) {
        errors.push(`items[${row}].line_total: no coincide con cantidad × precio`);
      }
    }
  });
  if (payload.subtotal === null || payload.subtotal < 0) errors.push("subtotal: inválido o no detectado");
  else if (Math.abs(payload.subtotal - sum) > 1) errors.push("subtotal: no reconcilia con las líneas");
  if (payload.total === null || payload.total < 0) errors.push("total: inválido o no detectado");
  else if (payload.subtotal !== null && payload.total < payload.subtotal) errors.push("total: menor al subtotal");
  return errors;
}

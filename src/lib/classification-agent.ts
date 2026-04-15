import type { Transaction, TransactionCategory } from "@/lib/types";

const categoryMatchers: Record<Exclude<TransactionCategory, "revenue" | "other">, RegExp[]> = {
  payroll: [/payroll/, /salary/, /gusto/, /bonus/, /tax/],
  software: [/figma/, /notion/, /linear/, /hubspot/, /slack/, /jira/, /license/, /software/, /subscription/],
  infra: [/aws/, /cloud/, /hosting/, /infrastructure/, /infra/, /gpu/, /datadog/, /vercel/],
  marketing: [/meta/, /google ads/, /linkedin/, /campaign/, /marketing/, /seo/, /growth/],
  operations: [/contractor/, /travel/, /hotel/, /air/, /delta/, /marriott/, /operations/, /office/, /legal/, /consulting/]
};

const normalizeText = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const revenueMatchers = [/revenue/, /sales/, /mrr/, /arr/, /invoice/, /subscription payment/, /customer payment/];
const nonOperatingInflowMatchers = [/refund/, /rebate/, /credit/, /grant/, /loan/, /investment/, /financing/, /capital/];

function matchExpenseCategory(input: string) {
  for (const [category, matchers] of Object.entries(categoryMatchers) as Array<[
    Exclude<TransactionCategory, "revenue" | "other">,
    RegExp[]
  ]>) {
    if (matchers.some((matcher) => matcher.test(input))) {
      return category;
    }
  }

  return null;
}

function classifyInflow(transaction: Transaction): TransactionCategory {
  const hint = normalizeText(transaction.categoryHint ?? "");
  const combinedText = `${transaction.normalizedText} ${hint}`.trim();

  if (revenueMatchers.some((matcher) => matcher.test(combinedText))) {
    return "revenue";
  }

  if (nonOperatingInflowMatchers.some((matcher) => matcher.test(combinedText))) {
    return "other";
  }

  if (hint && matchExpenseCategory(hint)) {
    return "other";
  }

  return "revenue";
}

function classifyCategory(transaction: Transaction): TransactionCategory {
  if (transaction.isOpeningBalance) {
    return "other";
  }

  if (transaction.direction === "inflow") {
    return classifyInflow(transaction);
  }

  const hint = normalizeText(transaction.categoryHint ?? "");
  const combinedText = `${transaction.normalizedText} ${hint}`.trim();

  const matchedCategory = matchExpenseCategory(combinedText);
  if (matchedCategory) {
    return matchedCategory;
  }

  return "other";
}

export function classificationAgent(transactions: Transaction[]): Transaction[] {
  const vendorMonths = new Map<string, Set<string>>();
  const vendorAmountMonths = new Map<string, Set<string>>();

  for (const transaction of transactions) {
    if (transaction.direction !== "outflow") {
      continue;
    }

    vendorMonths.set(
      transaction.normalizedVendor,
      new Set([...(vendorMonths.get(transaction.normalizedVendor) ?? []), transaction.month])
    );

    const fingerprint = `${transaction.normalizedVendor}-${Math.round(transaction.absAmount)}`;
    vendorAmountMonths.set(
      fingerprint,
      new Set([...(vendorAmountMonths.get(fingerprint) ?? []), transaction.month])
    );
  }

  return transactions.map((transaction) => {
    const category = classifyCategory(transaction);
    const recurringVendorMonths = vendorMonths.get(transaction.normalizedVendor)?.size ?? 0;
    const amountFingerprint = `${transaction.normalizedVendor}-${Math.round(transaction.absAmount)}`;
    const recurringAmountMonths = vendorAmountMonths.get(amountFingerprint)?.size ?? 0;
    const isRecurring =
      transaction.direction === "outflow" &&
      (recurringVendorMonths >= 3 || recurringAmountMonths >= 2 || category === "payroll");

    return {
      ...transaction,
      category,
      isRecurring
    };
  });
}

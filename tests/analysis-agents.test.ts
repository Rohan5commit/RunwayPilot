import test from "node:test";
import assert from "node:assert/strict";
import { classificationAgent } from "../src/lib/classification-agent";
import { riskAgent } from "../src/lib/risk-agent";
import type { CategorySpend, MonthlySnapshot, Transaction, VendorSpend } from "../src/lib/types";

function makeTransaction(partial: Partial<Transaction>): Transaction {
  return {
    id: partial.id ?? "txn-1",
    date: partial.date ?? "2026-01-01",
    month: partial.month ?? "2026-01",
    monthLabel: partial.monthLabel ?? "Jan",
    description: partial.description ?? "Transaction",
    vendor: partial.vendor ?? "Vendor",
    normalizedVendor: partial.normalizedVendor ?? "vendor",
    normalizedText: partial.normalizedText ?? "transaction",
    amount: partial.amount ?? 100,
    absAmount: partial.absAmount ?? Math.abs(partial.amount ?? 100),
    direction: partial.direction ?? "outflow",
    category: partial.category ?? "other",
    categoryHint: partial.categoryHint,
    notes: partial.notes,
    isRecurring: partial.isRecurring ?? false,
    isOpeningBalance: partial.isOpeningBalance ?? false
  };
}

test("classificationAgent preserves non-operating inflows from category hints", () => {
  const classified = classificationAgent([
    makeTransaction({
      id: "rev-1",
      direction: "inflow",
      amount: 12000,
      absAmount: 12000,
      normalizedText: "customer invoice payment",
      categoryHint: "revenue"
    }),
    makeTransaction({
      id: "credit-1",
      direction: "inflow",
      amount: 900,
      absAmount: 900,
      normalizedText: "aws promotional credit",
      categoryHint: "cloud credit"
    })
  ]);

  assert.equal(classified[0]?.category, "revenue");
  assert.equal(classified[1]?.category, "other");
});

test("riskAgent measures software load against average monthly revenue, not cumulative revenue", () => {
  const monthly: MonthlySnapshot[] = [
    { month: "2026-04", monthLabel: "Apr", revenue: 10000, outflow: 9000, netCashflow: 1000, burn: 0, cashBalance: 50000 },
    { month: "2026-05", monthLabel: "May", revenue: 10000, outflow: 9200, netCashflow: 800, burn: 0, cashBalance: 50800 },
    { month: "2026-06", monthLabel: "Jun", revenue: 10000, outflow: 9100, netCashflow: 900, burn: 0, cashBalance: 51700 }
  ];
  const topCategories: CategorySpend[] = [
    { category: "software", amount: 3000, share: 0.11 },
    { category: "operations", amount: 6200, share: 0.22 }
  ];
  const topVendors: VendorSpend[] = [
    { vendor: "Northstar Studio", amount: 6200, share: 0.22, category: "operations" }
  ];

  const risks = riskAgent([], monthly, topVendors, topCategories);

  assert.ok(!risks.some((risk) => risk.id === "software-sprawl"));
});

test("riskAgent reports vendor concentration against non-payroll outflow", () => {
  const monthly: MonthlySnapshot[] = [
    { month: "2026-04", monthLabel: "Apr", revenue: 20000, outflow: 26000, netCashflow: -6000, burn: 6000, cashBalance: 90000 },
    { month: "2026-05", monthLabel: "May", revenue: 20000, outflow: 27000, netCashflow: -7000, burn: 7000, cashBalance: 83000 },
    { month: "2026-06", monthLabel: "Jun", revenue: 20000, outflow: 28000, netCashflow: -8000, burn: 8000, cashBalance: 75000 }
  ];
  const transactions = [
    makeTransaction({ id: "pay-1", category: "payroll", vendor: "Gusto", normalizedVendor: "gusto", absAmount: 30000, month: "2026-04" }),
    makeTransaction({ id: "ops-1", category: "operations", vendor: "Northstar Studio", normalizedVendor: "northstar", absAmount: 15000, month: "2026-04" }),
    makeTransaction({ id: "mkt-1", category: "marketing", vendor: "Meta Ads", normalizedVendor: "meta ads", absAmount: 15000, month: "2026-04" })
  ];
  const topCategories: CategorySpend[] = [
    { category: "payroll", amount: 30000, share: 0.5 },
    { category: "operations", amount: 15000, share: 0.25 },
    { category: "marketing", amount: 15000, share: 0.25 }
  ];
  const topVendors: VendorSpend[] = [
    { vendor: "Gusto", amount: 30000, share: 0.5, category: "payroll" },
    { vendor: "Northstar Studio", amount: 15000, share: 0.25, category: "operations" },
    { vendor: "Meta Ads", amount: 15000, share: 0.25, category: "marketing" }
  ];

  const risks = riskAgent(transactions, monthly, topVendors, topCategories);
  const concentrationRisk = risks.find((risk) => risk.id === "vendor-concentration");

  assert.ok(concentrationRisk);
  assert.match(concentrationRisk!.description, /50\.0% of recent non-payroll outflow/);
});

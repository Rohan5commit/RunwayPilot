import { format, parseISO } from "date-fns";
import type { RiskSeverity, TransactionCategory } from "@/lib/types";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

const compactCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1
});

export function formatCurrency(value: number) {
  return currency.format(value);
}

export function formatCompactCurrency(value: number) {
  return compactCurrency.format(value);
}

export function formatSignedCurrency(value: number) {
  return `${value >= 0 ? "+" : "-"}${currency.format(Math.abs(value))}`;
}

export function formatPercent(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export function formatRunway(value: number) {
  if (!Number.isFinite(value) || value >= 24) {
    return "24m+";
  }

  if (value <= 0) {
    return "0.0m";
  }

  return `${value.toFixed(1)}m`;
}

export function formatMonth(month: string) {
  return format(parseISO(`${month}-01`), "MMM");
}

export function labelizeCategory(category: string | TransactionCategory) {
  if (category === "infra") {
    return "Infrastructure";
  }

  if (category === "revenue") {
    return "Revenue";
  }

  return category.charAt(0).toUpperCase() + category.slice(1);
}

export function severityTone(severity: RiskSeverity) {
  switch (severity) {
    case "critical":
      return {
        background: "rgba(181, 78, 59, 0.16)",
        color: "#b54e3b"
      };
    case "high":
      return {
        background: "rgba(191, 111, 35, 0.18)",
        color: "#bf6f23"
      };
    case "medium":
      return {
        background: "rgba(13, 123, 116, 0.14)",
        color: "#0d7b74"
      };
    default:
      return {
        background: "rgba(95, 111, 115, 0.16)",
        color: "#5f6f73"
      };
  }
}

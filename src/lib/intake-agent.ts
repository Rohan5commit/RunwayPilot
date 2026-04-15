import Papa from "papaparse";
import { format, parseISO } from "date-fns";
import { z } from "zod";
import type { Transaction } from "@/lib/types";

const csvRowSchema = z.object({
  date: z.string().min(1),
  description: z.string().min(1),
  vendor: z.string().optional(),
  amount: z.union([z.string(), z.number()]),
  direction: z.string().optional(),
  category_hint: z.string().optional(),
  notes: z.string().optional()
});

const parseAmount = (value: string | number) => {
  if (typeof value === "number") {
    return value;
  }

  const normalized = value.replace(/[$,]/g, "").trim();
  const parsed = Number(normalized);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid amount: ${value}`);
  }
  return parsed;
};

const normalizeVendor = (value: string) => {
  return value
    .toLowerCase()
    .replace(/marketplace/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
};

const normalizeText = (value: string) => {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
};

export function intakeAgent(csvText: string): Transaction[] {
  const parsed = Papa.parse<Record<string, string | undefined>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim().toLowerCase()
  });

  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors[0]?.message || "Unable to parse CSV input.");
  }

  const rows = parsed.data.filter((row) => Object.values(row).some((value) => `${value ?? ""}`.trim().length > 0));
  if (rows.length === 0) {
    throw new Error("The CSV did not contain any transaction rows.");
  }

  return rows.map((row, index) => {
    const safeRow = csvRowSchema.parse({
      date: row.date,
      description: row.description,
      vendor: row.vendor ?? row.description,
      amount: row.amount,
      direction: row.direction,
      category_hint: row.category_hint,
      notes: row.notes
    });

    const date = safeRow.date.trim();
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) {
      throw new Error(`Unsupported date format for row ${index + 1}. Use YYYY-MM-DD.`);
    }

    const parsedDate = parseISO(date);
    if (Number.isNaN(parsedDate.getTime())) {
      throw new Error(`Invalid date for row ${index + 1}.`);
    }

    const rawAmount = parseAmount(safeRow.amount);
    const normalizedDirection = (safeRow.direction || "").trim().toLowerCase();
    const direction = normalizedDirection.startsWith("out") || rawAmount < 0 ? "outflow" : "inflow";
    const absAmount = Math.abs(rawAmount);
    const vendor = (safeRow.vendor || safeRow.description).trim();
    const description = safeRow.description.trim();
    const categoryHint = safeRow.category_hint?.trim() || undefined;
    const notes = safeRow.notes?.trim() || undefined;
    const markerText = `${vendor} ${description} ${notes ?? ""}`.toLowerCase();
    const isOpeningBalance = markerText.includes("opening cash") || markerText.includes("seed round");

    return {
      id: `tx-${index + 1}`,
      date,
      month: date.slice(0, 7),
      monthLabel: format(parsedDate, "MMM"),
      description,
      vendor,
      normalizedVendor: normalizeVendor(vendor),
      normalizedText: normalizeText(`${vendor} ${description} ${notes ?? ""}`),
      amount: direction === "outflow" ? -absAmount : absAmount,
      absAmount,
      direction,
      category: "other",
      categoryHint,
      notes,
      isRecurring: false,
      isOpeningBalance
    };
  });
}

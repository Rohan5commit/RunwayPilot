export type TransactionCategory =
  | "payroll"
  | "software"
  | "infra"
  | "marketing"
  | "operations"
  | "revenue"
  | "other";

export type RiskSeverity = "low" | "medium" | "high" | "critical";
export type ConfidenceLevel = "high" | "medium" | "low";

export interface Transaction {
  id: string;
  date: string;
  month: string;
  monthLabel: string;
  description: string;
  vendor: string;
  normalizedVendor: string;
  normalizedText: string;
  amount: number;
  absAmount: number;
  direction: "inflow" | "outflow";
  category: TransactionCategory;
  categoryHint?: string;
  notes?: string;
  isRecurring: boolean;
  isOpeningBalance: boolean;
}

export interface MonthlySnapshot {
  month: string;
  monthLabel: string;
  revenue: number;
  outflow: number;
  netCashflow: number;
  burn: number;
  cashBalance: number;
}

export interface CategorySpend {
  category: TransactionCategory;
  amount: number;
  share: number;
}

export interface VendorSpend {
  vendor: string;
  amount: number;
  share: number;
  category: TransactionCategory;
}

export interface RiskFinding {
  id: string;
  title: string;
  description: string;
  severity: RiskSeverity;
  metric: string;
  recommendation: string;
  agent: "Risk Agent";
}

export interface ForecastPoint {
  month: string;
  monthLabel: string;
  revenue: number;
  outflow: number;
  netCashflow: number;
  cashBalance: number;
  runwayMonths: number;
}

export interface ForecastScenario {
  name: string;
  assumption: string;
  runwayMonths: number;
  endingBalance: number;
  points: ForecastPoint[];
}

export interface ScenarioControls {
  revenueChangePct: number;
  payrollChangePct: number;
  softwareChangePct: number;
  infraChangePct: number;
  oneTimeCost: number;
  growthMode: boolean;
}

export interface AnalysisSummary {
  cashBalance: number;
  monthlyBurn: number;
  netCashflow: number;
  runwayMonthsRemaining: number;
  revenueTrendPct: number;
  expenseTrendPct: number;
  largestCostCategory: string;
  highestRiskAlert: string;
}

export interface AnalysisResult {
  datasetLabel: string;
  rawInputCount: number;
  openingCash: number;
  transactions: Transaction[];
  monthly: MonthlySnapshot[];
  topCategories: CategorySpend[];
  topVendors: VendorSpend[];
  risks: RiskFinding[];
  summary: AnalysisSummary;
  forecast: {
    baseline: ForecastScenario;
    optimistic: ForecastScenario;
    conservative: ForecastScenario;
  };
}

export interface StrategyAnalysisInput {
  summary: AnalysisSummary;
  topCategories: CategorySpend[];
  topVendors: VendorSpend[];
  risks: RiskFinding[];
}

export interface StrategyResponse {
  summary: string;
  top_risks: string[];
  recommended_actions: string[];
  confidence: ConfidenceLevel;
  board_ready_note: string;
}

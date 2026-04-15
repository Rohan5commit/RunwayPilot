# Architecture

## Frontend structure

RunwayPilot uses Next.js with TypeScript and the App Router. The UI is organized around one main dashboard shell that handles demo loading, CSV ingestion, scenario controls, AI refresh, and report export. The interface is intentionally frontend-heavy to keep setup minimal for judges and users.

## Data pipeline

RunwayPilot uses a split pipeline so the financial logic stays deterministic on the client while the narrative AI layer stays server-side.

The frontend analytics pipeline follows four labeled agents:

1. **Intake Agent** validates CSV rows, standardizes dates and amounts, and recognizes opening balance rows.
2. **Classification Agent** assigns operating categories such as payroll, software, infrastructure, marketing, operations, revenue, and other.
3. **Forecast Agent** aggregates monthly metrics, calculates burn and runway, and builds baseline, optimistic, and conservative forecasts.
4. **Risk Agent** scores anomalies, concentration, duplicated spend, deteriorating cashflow, and revenue weakness.

The **Strategy Agent** runs in the server-side `/api/strategy` route. It receives a validated subset of the structured finance snapshot and calls NVIDIA NIM for business-language recommendations.

## Forecasting logic

Forecasting is deterministic rather than black-box. The system uses recent monthly averages and trend signals to project the next six months. Scenario controls modify revenue and specific cost buckets so the user can see runway compression or extension immediately.

## Agent flow

Raw data enters through the Intake Agent and moves through classification and forecasting before risk analysis runs in the browser. Only after the structured analytics layer is complete does the client send a compact, validated strategy payload to the server-side Strategy Agent. This separation keeps the AI layer grounded in verified financial facts while limiting payload size and tampering risk.

## Export and report generation

Report generation is client-side for speed. The current KPI snapshot, top risks, actions, and scenario summary are converted into a founder-ready markdown report that can be downloaded instantly.

## Future scaling path

- persist workspaces and historical uploads with Supabase
- add bank and accounting integrations
- support multi-entity companies and role-based permissions
- introduce benchmark comparisons across startup stages
- expand reporting into automated investor updates and board packets

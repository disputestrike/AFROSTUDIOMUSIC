import { prisma } from '@afrohit/db';

export const ECONOMICS_RECONCILIATION_SETTING_KEY = 'economics.reconciliation.v1';
const CREDIT_UNITS_PER_USD = 10_000;
const MAX_SOURCE_ROWS = 50_000;

export type EconomicsClassification =
  | 'invoice_reconciled_actual'
  | 'configured_estimate'
  | 'insufficient_evidence';

export interface InvoiceLineEvidence {
  providerJobId: string;
  provider: string;
  invoiceId: string;
  lineItemId?: string;
  actualCostUsd: number;
  retryCostUsd: number;
  retryAttempts: number;
  currency: 'USD';
  reconciledAt: string;
}

export interface AllocatedCostEvidence {
  periodStart: string;
  periodEnd: string;
  currency: 'USD';
  coverageComplete: boolean;
  storageUsd: number;
  egressUsd: number;
  supportUsd: number;
  paymentFeesUsd: number;
  otherUsd: number;
  otherLabel?: string;
  evidenceRef: string;
}

export interface EconomicsReconciliationRegistry {
  schemaVersion: 1;
  invoiceLines: InvoiceLineEvidence[];
  allocatedCosts: AllocatedCostEvidence[];
  recordedAt: string;
  recordedByUserId: string;
}

export interface EconomicsJobEvidence {
  id: string;
  workspaceId: string;
  kind: string;
  provider: string;
  status: string;
  chargeKey: string | null;
  configuredChargeUsd: number;
  estimatedCostUsd: number | null;
  retryAttempts: number;
  requiresInvoice: boolean;
  invoice: InvoiceLineEvidence | null;
}

export interface EconomicsChargeEvidence {
  workspaceId: string;
  workflow: string;
  configuredChargeUsd: number;
}

export interface EconomicsCashReceipt {
  entitlementId: string;
  workspaceId: string;
  grossAmountCents: number | null;
  currency: string;
}

export interface EconomicsCashAdjustment {
  entitlementId: string;
  workspaceId: string;
  kind: string;
  sourceId: string;
  amountCents: number | null;
  entitlementGrossAmountCents: number | null;
  currency: string;
  active: boolean;
  occurredAt: string;
}

export interface DistributionOutcomeEvidence {
  status: string;
  distributor: string | null;
}

export interface EconomicsEvidenceInput {
  from: string;
  to: string;
  generatedAt: string;
  jobs: EconomicsJobEvidence[];
  unattributedCharges: EconomicsChargeEvidence[];
  configuredCreditRefundUsd: number;
  cashReceipts: EconomicsCashReceipt[];
  cashAdjustments: EconomicsCashAdjustment[];
  allocatedCost: AllocatedCostEvidence | null;
  distributionOutcomes: DistributionOutcomeEvidence[];
  liveReleaseCount: number;
  reconciliationConflicts?: string[];
  reconciliationInvalid?: boolean;
  sourceTruncated?: boolean;
}

interface BreakdownAccumulator {
  key: string;
  jobs: number;
  succeeded: number;
  failed: number;
  canceled: number;
  retryAttempts: number;
  configuredUsageUsd: number;
  estimatedProviderCostUsd: number;
  estimatedCostKnownJobs: number;
  invoiceRequiredJobs: number;
  invoiceCoveredJobs: number;
  invoiceActualProviderCostUsd: number;
  invoiceRetryCostUsd: number;
}

interface WorkspaceAccumulator extends BreakdownAccumulator {
  workspaceId: string;
}

function round(value: number, places = 6): number {
  const scale = 10 ** places;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function percentage(numerator: number, denominator: number): number {
  if (denominator === 0) return 100;
  return round((numerator / denominator) * 100, 2);
}

function emptyBreakdown(key: string): BreakdownAccumulator {
  return {
    key,
    jobs: 0,
    succeeded: 0,
    failed: 0,
    canceled: 0,
    retryAttempts: 0,
    configuredUsageUsd: 0,
    estimatedProviderCostUsd: 0,
    estimatedCostKnownJobs: 0,
    invoiceRequiredJobs: 0,
    invoiceCoveredJobs: 0,
    invoiceActualProviderCostUsd: 0,
    invoiceRetryCostUsd: 0,
  };
}

function addJob(target: BreakdownAccumulator, job: EconomicsJobEvidence): void {
  target.jobs += 1;
  target.succeeded += job.status === 'SUCCEEDED' ? 1 : 0;
  target.failed += job.status === 'FAILED' ? 1 : 0;
  target.canceled += job.status === 'CANCELED' ? 1 : 0;
  target.retryAttempts += Math.max(0, job.retryAttempts);
  target.configuredUsageUsd += job.configuredChargeUsd;
  if (job.estimatedCostUsd != null) {
    target.estimatedProviderCostUsd += job.estimatedCostUsd;
    target.estimatedCostKnownJobs += 1;
  }
  if (job.requiresInvoice) {
    target.invoiceRequiredJobs += 1;
    if (job.invoice) {
      target.invoiceCoveredJobs += 1;
      target.invoiceActualProviderCostUsd += job.invoice.actualCostUsd;
      target.invoiceRetryCostUsd += job.invoice.retryCostUsd;
    }
  }
}

function addStandaloneCharge(target: BreakdownAccumulator, chargeUsd: number): void {
  target.configuredUsageUsd += chargeUsd;
}

function finishBreakdown(value: BreakdownAccumulator) {
  const invoiceComplete = value.invoiceCoveredJobs === value.invoiceRequiredJobs;
  const estimateComplete = value.estimatedCostKnownJobs === value.jobs;
  const actualCost = invoiceComplete ? value.invoiceActualProviderCostUsd : null;
  return {
    key: value.key,
    jobs: value.jobs,
    succeeded: value.succeeded,
    failed: value.failed,
    canceled: value.canceled,
    retryAttempts: value.retryAttempts,
    configuredUsageUsd: round(value.configuredUsageUsd),
    estimatedProviderCostUsd: round(value.estimatedProviderCostUsd),
    estimatedCostCoveragePercent: percentage(value.estimatedCostKnownJobs, value.jobs),
    invoiceCoveragePercent: percentage(value.invoiceCoveredJobs, value.invoiceRequiredJobs),
    invoiceActualProviderCostUsd: actualCost == null ? null : round(actualCost),
    invoiceRetryCostUsd: invoiceComplete ? round(value.invoiceRetryCostUsd) : null,
    configuredContributionEstimateUsd: estimateComplete
      ? round(value.configuredUsageUsd - value.estimatedProviderCostUsd)
      : null,
    invoiceReconciledUsageContributionUsd: actualCost == null
      ? null
      : round(value.configuredUsageUsd - actualCost),
    contributionBasis:
      'Configured credit consumption is a usage-value proxy, not recognized cash revenue.',
  };
}

function statusCounts(outcomes: DistributionOutcomeEvidence[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const outcome of outcomes) {
    const status = outcome.status.trim().toLowerCase() || 'unknown';
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function distributionByPartner(
  outcomes: DistributionOutcomeEvidence[]
): Array<{ distributor: string; outcomes: number; live: number; failed: number }> {
  const partners = new Map<string, { distributor: string; outcomes: number; live: number; failed: number }>();
  for (const outcome of outcomes) {
    const key = outcome.distributor?.trim() || 'unattributed';
    const row = partners.get(key) ?? { distributor: key, outcomes: 0, live: 0, failed: 0 };
    const status = outcome.status.toLowerCase();
    row.outcomes += 1;
    row.live += status === 'live' ? 1 : 0;
    row.failed += status === 'failed' ? 1 : 0;
    partners.set(key, row);
  }
  return [...partners.values()].sort((a, b) => b.outcomes - a.outcomes || a.distributor.localeCompare(b.distributor));
}

function latestActiveCashAdjustments(adjustments: EconomicsCashAdjustment[]): EconomicsCashAdjustment[] {
  const latestBySource = new Map<string, EconomicsCashAdjustment>();
  for (const adjustment of adjustments) {
    const key = `${adjustment.entitlementId}:${adjustment.kind}:${adjustment.sourceId}`;
    const current = latestBySource.get(key);
    if (!current || adjustment.occurredAt > current.occurredAt) {
      latestBySource.set(key, adjustment);
    }
  }
  return [...latestBySource.values()].filter(adjustment => adjustment.active);
}

function cashAdjustmentTotalUsd(adjustments: EconomicsCashAdjustment[]): number {
  const byEntitlement = new Map<string, EconomicsCashAdjustment[]>();
  for (const adjustment of adjustments) {
    const rows = byEntitlement.get(adjustment.entitlementId) ?? [];
    rows.push(adjustment);
    byEntitlement.set(adjustment.entitlementId, rows);
  }
  let totalCents = 0;
  for (const rows of byEntitlement.values()) {
    const usdRows = rows.filter(row => row.currency === 'USD' && row.amountCents != null);
    const cumulativeRefundCents = usdRows.reduce(
      (maximum, row) => row.kind === 'REFUND' && row.sourceId.startsWith('refund-total:')
        ? Math.max(maximum, Math.abs(row.amountCents ?? 0))
        : maximum,
      0
    );
    const itemizedRefundCents = usdRows.reduce(
      (sum, row) => row.kind === 'REFUND' && !row.sourceId.startsWith('refund-total:')
        ? sum + Math.abs(row.amountCents ?? 0)
        : sum,
      0
    );
    const nonRefundCents = usdRows.reduce(
      (sum, row) => row.kind === 'REFUND' ? sum : sum + Math.abs(row.amountCents ?? 0),
      0
    );
    const grossCents = rows[0]?.entitlementGrossAmountCents;
    const exposedCents = nonRefundCents + Math.max(cumulativeRefundCents, itemizedRefundCents);
    totalCents += grossCents == null ? exposedCents : Math.min(grossCents, exposedCents);
  }
  return totalCents / 100;
}

export function buildEconomicsReadinessReport(input: EconomicsEvidenceInput) {
  const engineMap = new Map<string, BreakdownAccumulator>();
  const workflowMap = new Map<string, BreakdownAccumulator>();
  const workspaceMap = new Map<string, WorkspaceAccumulator>();
  const missingProviderJobIds: string[] = [];

  for (const job of input.jobs) {
    const engineKey = job.provider || 'unknown';
    const workflowKey = job.chargeKey || job.kind || 'unattributed';
    const engine = engineMap.get(engineKey) ?? emptyBreakdown(engineKey);
    const workflow = workflowMap.get(workflowKey) ?? emptyBreakdown(workflowKey);
    const workspace = workspaceMap.get(job.workspaceId) ?? {
      ...emptyBreakdown(job.workspaceId),
      workspaceId: job.workspaceId,
    };
    addJob(engine, job);
    addJob(workflow, job);
    addJob(workspace, job);
    engineMap.set(engineKey, engine);
    workflowMap.set(workflowKey, workflow);
    workspaceMap.set(job.workspaceId, workspace);
    if (job.requiresInvoice && !job.invoice) missingProviderJobIds.push(job.id);
  }

  for (const charge of input.unattributedCharges) {
    const workflowKey = charge.workflow || 'unattributed';
    const workflow = workflowMap.get(workflowKey) ?? emptyBreakdown(workflowKey);
    const workspace = workspaceMap.get(charge.workspaceId) ?? {
      ...emptyBreakdown(charge.workspaceId),
      workspaceId: charge.workspaceId,
    };
    addStandaloneCharge(workflow, charge.configuredChargeUsd);
    addStandaloneCharge(workspace, charge.configuredChargeUsd);
    workflowMap.set(workflowKey, workflow);
    workspaceMap.set(charge.workspaceId, workspace);
  }

  const invoiceRequiredJobs = input.jobs.filter(job => job.requiresInvoice).length;
  const invoiceCoveredJobs = invoiceRequiredJobs - missingProviderJobIds.length;
  const nonTerminalJobs = input.jobs.filter(
    job => !['SUCCEEDED', 'FAILED', 'CANCELED'].includes(job.status)
  ).length;
  const knownEstimateJobs = input.jobs.filter(job => job.estimatedCostUsd != null).length;
  const estimatedProviderCostUsd = input.jobs.reduce(
    (sum, job) => sum + (job.estimatedCostUsd ?? 0),
    0
  );
  const actualProviderCostUsd = input.jobs.reduce(
    (sum, job) => sum + (job.requiresInvoice ? job.invoice?.actualCostUsd ?? 0 : 0),
    0
  );
  const invoiceRetryCostUsd = input.jobs.reduce(
    (sum, job) => sum + (job.invoice?.retryCostUsd ?? 0),
    0
  );
  const configuredUsageGrossUsd =
    input.jobs.reduce((sum, job) => sum + job.configuredChargeUsd, 0) +
    input.unattributedCharges.reduce((sum, charge) => sum + charge.configuredChargeUsd, 0);
  const configuredUsageNetUsd = Math.max(
    0,
    configuredUsageGrossUsd - input.configuredCreditRefundUsd
  );

  const unsupportedReceiptCurrencies = input.cashReceipts.filter(r => r.currency !== 'USD').length;
  const missingReceiptAmounts = input.cashReceipts.filter(r => r.grossAmountCents == null).length;
  const effectiveCashAdjustments = latestActiveCashAdjustments(input.cashAdjustments);
  const unsupportedAdjustmentCurrencies = effectiveCashAdjustments.filter(r => r.currency !== 'USD').length;
  const missingAdjustmentAmounts = effectiveCashAdjustments.filter(
    r => r.amountCents == null || r.entitlementGrossAmountCents == null
  ).length;
  const grossCashReceiptsUsd = input.cashReceipts.reduce(
    (sum, receipt) =>
      sum + (receipt.currency === 'USD' && receipt.grossAmountCents != null ? receipt.grossAmountCents / 100 : 0),
    0
  );
  const cashAdjustmentsUsd = cashAdjustmentTotalUsd(effectiveCashAdjustments);
  const netCashReceiptsUsd = grossCashReceiptsUsd - cashAdjustmentsUsd;
  const revenueCoverageComplete =
    missingReceiptAmounts === 0 &&
    missingAdjustmentAmounts === 0 &&
    unsupportedReceiptCurrencies === 0 &&
    unsupportedAdjustmentCurrencies === 0;

  const allocation = input.allocatedCost;
  const allocationComplete = !!allocation?.coverageComplete;
  const allocatedCostTotalUsd = allocation
    ? allocation.storageUsd +
      allocation.egressUsd +
      allocation.supportUsd +
      allocation.paymentFeesUsd +
      allocation.otherUsd
    : 0;
  const invoiceCoverageComplete = invoiceCoveredJobs === invoiceRequiredJobs;
  const estimateCoverageComplete = knownEstimateJobs === input.jobs.length;
  const reconciliationConflicts = input.reconciliationConflicts ?? [];

  const blockers: string[] = [];
  if (input.jobs.length === 0) blockers.push('no_provider_jobs_observed');
  if (nonTerminalJobs > 0) blockers.push('unsettled_provider_jobs');
  if (input.cashReceipts.length === 0 || grossCashReceiptsUsd <= 0) blockers.push('no_paid_revenue_observed');
  if (!revenueCoverageComplete) blockers.push('incomplete_cash_revenue_or_refund_coverage');
  if (!invoiceCoverageComplete) blockers.push('missing_provider_invoice_coverage');
  if (!allocationComplete) blockers.push('missing_allocated_cost_coverage');
  if (reconciliationConflicts.length > 0) blockers.push('conflicting_invoice_evidence');
  if (input.reconciliationInvalid) blockers.push('invalid_reconciliation_registry');
  if (input.sourceTruncated) blockers.push('source_data_truncated');
  if (input.liveReleaseCount === 0) blockers.push('no_live_distribution_outcome');

  const actualEvidenceComplete =
    input.jobs.length > 0 &&
    grossCashReceiptsUsd > 0 &&
    revenueCoverageComplete &&
    invoiceCoverageComplete &&
    allocationComplete &&
    reconciliationConflicts.length === 0 &&
    !input.reconciliationInvalid &&
    !input.sourceTruncated &&
    nonTerminalJobs === 0;
  const classification: EconomicsClassification = actualEvidenceComplete
    ? 'invoice_reconciled_actual'
    : input.jobs.length > 0 || configuredUsageGrossUsd > 0 || grossCashReceiptsUsd > 0
      ? 'configured_estimate'
      : 'insufficient_evidence';

  const byEngine = [...engineMap.values()]
    .map(finishBreakdown)
    .sort((a, b) => b.jobs - a.jobs || a.key.localeCompare(b.key));
  const byWorkflow = [...workflowMap.values()]
    .map(finishBreakdown)
    .sort((a, b) => b.configuredUsageUsd - a.configuredUsageUsd || a.key.localeCompare(b.key));

  const workspaceRows = [...workspaceMap.values()].sort(
    (a, b) => b.configuredUsageUsd - a.configuredUsageUsd || b.jobs - a.jobs || a.workspaceId.localeCompare(b.workspaceId)
  );
  const heavyCount = workspaceRows.length === 0 ? 0 : Math.max(1, Math.ceil(workspaceRows.length * 0.1));
  const heavyRows = workspaceRows.slice(0, heavyCount);
  const heavyMembers = heavyRows.map(row => ({
    workspaceId: row.workspaceId,
    jobs: row.jobs,
    retryAttempts: row.retryAttempts,
    configuredUsageUsd: round(row.configuredUsageUsd),
    estimatedProviderCostUsd: round(row.estimatedProviderCostUsd),
    invoiceActualProviderCostUsd:
      row.invoiceCoveredJobs === row.invoiceRequiredJobs
        ? round(row.invoiceActualProviderCostUsd)
        : null,
  }));

  const distributionCounts = statusCounts(input.distributionOutcomes);
  const distributionLiveEvents = distributionCounts.live ?? 0;

  return {
    schemaVersion: 1 as const,
    generatedAt: input.generatedAt,
    window: { from: input.from, to: input.to },
    readiness: {
      readyForInvestorDiligence: blockers.length === 0,
      classification,
      blockers,
      rule: 'Only complete cash, provider-invoice, allocated-cost, and live-distribution evidence may be labeled investor-ready actuals.',
    },
    cash: {
      classification: revenueCoverageComplete ? 'persisted_actual' : 'incomplete_actual',
      receiptCount: input.cashReceipts.length,
      adjustmentCount: effectiveCashAdjustments.length,
      grossReceiptsUsd: round(grossCashReceiptsUsd),
      refundsDisputesAndReversalsUsd: round(cashAdjustmentsUsd),
      netReceiptsUsd: revenueCoverageComplete ? round(netCashReceiptsUsd) : null,
      missingReceiptAmounts,
      missingAdjustmentAmounts,
      unsupportedCurrencyRecords: unsupportedReceiptCurrencies + unsupportedAdjustmentCurrencies,
      note: 'Cash comes only from persisted billing entitlements and latest active monetary adjustments. Cumulative refunds are de-duplicated, total exposure is capped by the persisted entitlement gross, and credit grants are not revenue.',
    },
    usage: {
      classification: 'configured_value_not_revenue',
      grossConfiguredUsageUsd: round(configuredUsageGrossUsd),
      configuredCreditRefundsUsd: round(input.configuredCreditRefundUsd),
      netConfiguredUsageUsd: round(configuredUsageNetUsd),
    },
    providerCosts: {
      jobs: input.jobs.length,
      nonTerminalJobs,
      estimatedCostUsd: round(estimatedProviderCostUsd),
      estimatedCoveragePercent: percentage(knownEstimateJobs, input.jobs.length),
      invoiceActualCostUsd: invoiceCoverageComplete ? round(actualProviderCostUsd) : null,
      invoiceRetryCostUsd: invoiceCoverageComplete ? round(invoiceRetryCostUsd) : null,
      retryAttempts: input.jobs.reduce((sum, job) => sum + job.retryAttempts, 0),
      invoiceRequiredJobs,
      invoiceCoveredJobs,
      invoiceCoveragePercent: percentage(invoiceCoveredJobs, invoiceRequiredJobs),
      missingProviderJobIds,
      estimateCoverageComplete,
      invoiceCoverageComplete,
      note: 'ProviderJob.cost remains an estimate. Actual cost exists only for explicitly reconciled invoice lines; retry cost is included in actual cost.',
    },
    allocatedCosts: allocation
      ? {
          coverageComplete: allocation.coverageComplete,
          periodStart: allocation.periodStart,
          periodEnd: allocation.periodEnd,
          storageUsd: round(allocation.storageUsd),
          egressUsd: round(allocation.egressUsd),
          supportUsd: round(allocation.supportUsd),
          paymentFeesUsd: round(allocation.paymentFeesUsd),
          otherUsd: round(allocation.otherUsd),
          otherLabel: allocation.otherLabel ?? null,
          totalUsd: round(allocatedCostTotalUsd),
          evidenceRef: allocation.evidenceRef,
        }
      : null,
    contribution: {
      estimatedPreAllocationCashContributionUsd:
        revenueCoverageComplete && estimateCoverageComplete
          ? round(netCashReceiptsUsd - estimatedProviderCostUsd)
          : null,
      estimatedFullyLoadedCashContributionUsd:
        revenueCoverageComplete && estimateCoverageComplete && allocationComplete
          ? round(netCashReceiptsUsd - estimatedProviderCostUsd - allocatedCostTotalUsd)
          : null,
      invoiceReconciledActualUsd: actualEvidenceComplete
        ? round(netCashReceiptsUsd - actualProviderCostUsd - allocatedCostTotalUsd)
        : null,
      actualMarginPercent:
        actualEvidenceComplete && netCashReceiptsUsd > 0
          ? round(
              ((netCashReceiptsUsd - actualProviderCostUsd - allocatedCostTotalUsd) /
                netCashReceiptsUsd) *
                100,
              2
            )
          : null,
      note: 'This is period cash contribution, not GAAP revenue recognition; configured credit usage is never substituted for cash receipts.',
    },
    byEngine,
    byWorkflow,
    heavyUserCohort: {
      definition: 'Top 10% of active workspaces by configured usage value in the reporting window; minimum one workspace.',
      activeWorkspaces: workspaceRows.length,
      memberCount: heavyMembers.length,
      thresholdConfiguredUsageUsd: heavyMembers.length
        ? heavyMembers[heavyMembers.length - 1]?.configuredUsageUsd ?? null
        : null,
      configuredUsageUsd: round(heavyRows.reduce((sum, row) => sum + row.configuredUsageUsd, 0)),
      estimatedProviderCostUsd: round(heavyRows.reduce((sum, row) => sum + row.estimatedProviderCostUsd, 0)),
      members: heavyMembers,
    },
    distribution: {
      outcomeEvents: input.distributionOutcomes.length,
      statusCounts: distributionCounts,
      liveEvents: distributionLiveEvents,
      liveReleases: input.liveReleaseCount,
      byDistributor: distributionByPartner(input.distributionOutcomes),
      evidencePresent: input.liveReleaseCount > 0,
    },
    evidenceQuality: {
      sourceTruncated: !!input.sourceTruncated,
      reconciliationInvalid: !!input.reconciliationInvalid,
      reconciliationConflicts,
    },
  };
}

type EconomicsReadinessReport = ReturnType<typeof buildEconomicsReadinessReport>;

export function redactEconomicsReadinessReport(report: EconomicsReadinessReport) {
  return {
    ...report,
    redacted: true as const,
    providerCosts: {
      ...report.providerCosts,
      missingProviderJobIds: report.providerCosts.missingProviderJobIds.length,
    },
    allocatedCosts: report.allocatedCosts
      ? { ...report.allocatedCosts, evidenceRef: '[redacted]' }
      : null,
    heavyUserCohort: {
      ...report.heavyUserCohort,
      members: report.heavyUserCohort.members.map((member, index) => ({
        rank: index + 1,
        jobs: member.jobs,
        retryAttempts: member.retryAttempts,
        configuredUsageUsd: member.configuredUsageUsd,
        estimatedProviderCostUsd: member.estimatedProviderCostUsd,
        invoiceActualProviderCostUsd: member.invoiceActualProviderCostUsd,
      })),
    },
    evidenceQuality: {
      ...report.evidenceQuality,
      reconciliationConflicts: report.evidenceQuality.reconciliationConflicts.length,
    },
  };
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function invoiceFromJobOutput(
  providerJobId: string,
  provider: string,
  outputJson: unknown
): InvoiceLineEvidence | null {
  const root = objectValue(outputJson);
  const economics = objectValue(root?.economics);
  const invoice = objectValue(economics?.invoice);
  if (!invoice) return null;
  const actualCostUsd = nonNegativeNumber(invoice.actualCostUsd);
  const retryCostUsd = nonNegativeNumber(invoice.retryCostUsd) ?? 0;
  const retryAttempts = nonNegativeNumber(invoice.retryAttempts) ?? 0;
  if (
    actualCostUsd == null ||
    retryCostUsd > actualCostUsd ||
    typeof invoice.invoiceId !== 'string' ||
    invoice.invoiceId.length < 1 ||
    invoice.currency !== 'USD' ||
    typeof invoice.reconciledAt !== 'string'
  ) {
    return null;
  }
  return {
    providerJobId,
    provider,
    invoiceId: invoice.invoiceId,
    ...(typeof invoice.lineItemId === 'string' ? { lineItemId: invoice.lineItemId } : {}),
    actualCostUsd,
    retryCostUsd,
    retryAttempts: Math.floor(retryAttempts),
    currency: 'USD',
    reconciledAt: invoice.reconciledAt,
  };
}

export function parseEconomicsReconciliationRegistry(
  value: string | null | undefined
): EconomicsReconciliationRegistry | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as EconomicsReconciliationRegistry;
    if (
      parsed.schemaVersion !== 1 ||
      !Array.isArray(parsed.invoiceLines) ||
      !Array.isArray(parsed.allocatedCosts) ||
      typeof parsed.recordedAt !== 'string' ||
      Number.isNaN(Date.parse(parsed.recordedAt)) ||
      typeof parsed.recordedByUserId !== 'string' ||
      parsed.recordedByUserId.length < 1
    ) {
      return null;
    }
    const seenJobs = new Set<string>();
    for (const line of parsed.invoiceLines) {
      if (
        !line ||
        typeof line.providerJobId !== 'string' ||
        line.providerJobId.length < 1 ||
        seenJobs.has(line.providerJobId) ||
        typeof line.provider !== 'string' ||
        line.provider.length < 1 ||
        typeof line.invoiceId !== 'string' ||
        line.invoiceId.length < 1 ||
        line.currency !== 'USD' ||
        nonNegativeNumber(line.actualCostUsd) == null ||
        nonNegativeNumber(line.retryCostUsd) == null ||
        line.retryCostUsd > line.actualCostUsd ||
        !Number.isInteger(line.retryAttempts) ||
        line.retryAttempts < 0 ||
        typeof line.reconciledAt !== 'string' ||
        Number.isNaN(Date.parse(line.reconciledAt))
      ) {
        return null;
      }
      seenJobs.add(line.providerJobId);
    }
    const seenPeriods = new Set<string>();
    for (const allocation of parsed.allocatedCosts) {
      const period = allocation?.periodStart + ':' + allocation?.periodEnd;
      if (
        !allocation ||
        !validDate(allocation.periodStart) ||
        !validDate(allocation.periodEnd) ||
        allocation.periodStart > allocation.periodEnd ||
        seenPeriods.has(period) ||
        allocation.currency !== 'USD' ||
        typeof allocation.coverageComplete !== 'boolean' ||
        nonNegativeNumber(allocation.storageUsd) == null ||
        nonNegativeNumber(allocation.egressUsd) == null ||
        nonNegativeNumber(allocation.supportUsd) == null ||
        nonNegativeNumber(allocation.paymentFeesUsd) == null ||
        nonNegativeNumber(allocation.otherUsd) == null ||
        (allocation.otherUsd > 0 && !allocation.otherLabel) ||
        typeof allocation.evidenceRef !== 'string' ||
        allocation.evidenceRef.length < 1
      ) {
        return null;
      }
      seenPeriods.add(period);
    }
    return parsed;
  } catch {
    return null;
  }
}

function requiresProviderInvoice(provider: string, estimatedCostUsd: number | null): boolean {
  const normalized = provider.trim().toLowerCase();
  const explicitlyLocal =
    normalized === 'internal' ||
    normalized === 'local' ||
    normalized === 'none' ||
    normalized.endsWith('-local');
  return !explicitlyLocal || (estimatedCostUsd != null && estimatedCostUsd > 0);
}

function unitsToUsd(units: number): number {
  return Math.abs(units) / CREDIT_UNITS_PER_USD;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function resolveEconomicsWindow(query: { days?: string; from?: string; to?: string }, now = new Date()) {
  if ((query.from && !query.to) || (!query.from && query.to)) {
    throw Object.assign(new Error('from and to must be supplied together'), { statusCode: 400 });
  }
  if (query.from && query.to) {
    if (!validDate(query.from) || !validDate(query.to) || query.from > query.to) {
      throw Object.assign(new Error('from and to must be valid YYYY-MM-DD dates in ascending order'), { statusCode: 400 });
    }
    const fromDate = new Date(query.from + 'T00:00:00.000Z');
    const toDate = new Date(query.to + 'T23:59:59.999Z');
    if (toDate.getTime() - fromDate.getTime() > 3660 * 86_400_000) {
      throw Object.assign(new Error('economics window cannot exceed 10 years'), { statusCode: 400 });
    }
    return { from: query.from, to: query.to, fromDate, toDate };
  }
  const parsedDays = Number(query.days ?? 30);
  const days = Number.isFinite(parsedDays) ? Math.min(Math.max(Math.floor(parsedDays), 1), 3650) : 30;
  const to = now.toISOString().slice(0, 10);
  const fromDateSeed = new Date(to + 'T00:00:00.000Z');
  fromDateSeed.setUTCDate(fromDateSeed.getUTCDate() - days + 1);
  const from = fromDateSeed.toISOString().slice(0, 10);
  return {
    from,
    to,
    fromDate: new Date(from + 'T00:00:00.000Z'),
    toDate: new Date(to + 'T23:59:59.999Z'),
  };
}

export async function loadEconomicsReadinessReport(options: {
  from: string;
  to: string;
  fromDate: Date;
  toDate: Date;
  generatedAt?: string;
}) {
  const range = { gte: options.fromDate, lte: options.toDate };
  const [jobRows, ledgerRows, receiptRows, adjustmentRows, outcomeRows, liveReleaseCount, setting] =
    await Promise.all([
      prisma.providerJob.findMany({
        where: { createdAt: range },
        select: {
          id: true,
          workspaceId: true,
          kind: true,
          provider: true,
          status: true,
          cost: true,
          creditsCents: true,
          chargeLedgerId: true,
          outputJson: true,
          outbox: { select: { attempts: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: MAX_SOURCE_ROWS + 1,
      }),
      prisma.creditLedger.findMany({
        where: {
          createdAt: range,
          OR: [{ delta: { lt: 0 } }, { reversalOfId: { not: null } }],
        },
        select: {
          id: true,
          workspaceId: true,
          delta: true,
          reason: true,
          creditKey: true,
          refId: true,
          reversalOfId: true,
        },
        orderBy: { createdAt: 'asc' },
        take: MAX_SOURCE_ROWS + 1,
      }),
      prisma.billingEntitlement.findMany({
        where: { occurredAt: range },
        select: { id: true, workspaceId: true, grossAmountCents: true, currency: true },
        orderBy: { occurredAt: 'asc' },
        take: MAX_SOURCE_ROWS + 1,
      }),
      prisma.billingAdjustment.findMany({
        where: { occurredAt: range },
        select: {
          entitlementId: true,
          kind: true,
          sourceId: true,
          amountCents: true,
          creditsAtRisk: true,
          occurredAt: true,
          entitlement: { select: { workspaceId: true, currency: true, grossAmountCents: true } },
        },
        orderBy: { occurredAt: 'asc' },
        take: MAX_SOURCE_ROWS + 1,
      }),
      prisma.distributionEvent.findMany({
        where: { occurredAt: range, applied: true },
        select: { status: true, release: { select: { distributor: true } } },
        orderBy: { occurredAt: 'asc' },
        take: MAX_SOURCE_ROWS + 1,
      }),
      prisma.release.count({ where: { liveAt: range } }),
      prisma.systemSetting.findUnique({
        where: { key: ECONOMICS_RECONCILIATION_SETTING_KEY },
        select: { value: true },
      }),
    ]);

  const sourceTruncated = [jobRows, ledgerRows, receiptRows, adjustmentRows, outcomeRows]
    .some(rows => rows.length > MAX_SOURCE_ROWS);
  const jobsLimited = jobRows.slice(0, MAX_SOURCE_ROWS);
  const ledgersLimited = ledgerRows.slice(0, MAX_SOURCE_ROWS);
  const registry = parseEconomicsReconciliationRegistry(setting?.value);
  const reconciliationInvalid = !!setting?.value && !registry;
  const registryInvoices = new Map((registry?.invoiceLines ?? []).map(line => [line.providerJobId, line]));
  const ledgerById = new Map(ledgersLimited.map(row => [row.id, row]));
  const ledgerByRef = new Map(
    ledgersLimited.filter(row => row.delta < 0 && row.refId).map(row => [row.refId as string, row])
  );
  const consumedLedgerIds = new Set<string>();
  const reconciliationConflicts: string[] = [];

  const jobs: EconomicsJobEvidence[] = jobsLimited.map(row => {
    const estimatedCostUsd = row.cost == null ? null : Number(row.cost);
    const linkedLedger =
      (row.chargeLedgerId ? ledgerById.get(row.chargeLedgerId) : undefined) ?? ledgerByRef.get(row.id);
    if (linkedLedger) consumedLedgerIds.add(linkedLedger.id);
    const registryInvoice = registryInvoices.get(row.id) ?? null;
    const embeddedInvoice = invoiceFromJobOutput(row.id, row.provider, row.outputJson);
    if (registryInvoice && registryInvoice.provider !== row.provider) {
      reconciliationConflicts.push(row.id);
    } else if (
      registryInvoice &&
      embeddedInvoice &&
      (registryInvoice.actualCostUsd !== embeddedInvoice.actualCostUsd ||
        registryInvoice.invoiceId !== embeddedInvoice.invoiceId)
    ) {
      reconciliationConflicts.push(row.id);
    }
    const invoice = registryInvoice?.provider === row.provider
      ? registryInvoice
      : embeddedInvoice;
    const outboxAttempts = Math.max(0, Number(row.outbox?.attempts ?? 0) - 1);
    const terminal = ['SUCCEEDED', 'FAILED', 'CANCELED'].includes(String(row.status));
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      kind: row.kind,
      provider: row.provider,
      status: String(row.status),
      chargeKey: linkedLedger?.creditKey ?? null,
      configuredChargeUsd: linkedLedger
        ? unitsToUsd(linkedLedger.delta)
        : unitsToUsd(row.creditsCents),
      estimatedCostUsd: Number.isFinite(estimatedCostUsd) ? estimatedCostUsd : null,
      retryAttempts: Math.max(outboxAttempts, invoice?.retryAttempts ?? 0),
      requiresInvoice: terminal && requiresProviderInvoice(row.provider, estimatedCostUsd),
      invoice,
    };
  });

  const unattributedCharges: EconomicsChargeEvidence[] = ledgersLimited
    .filter(row => row.delta < 0 && !consumedLedgerIds.has(row.id))
    .map(row => ({
      workspaceId: row.workspaceId,
      workflow: row.creditKey ?? row.reason ?? 'unattributed',
      configuredChargeUsd: unitsToUsd(row.delta),
    }));
  const configuredCreditRefundUsd = ledgersLimited
    .filter(row => row.reversalOfId && row.delta > 0)
    .reduce((sum, row) => sum + unitsToUsd(row.delta), 0);

  const matchingAllocation = (registry?.allocatedCosts ?? []).find(
    allocation => allocation.periodStart === options.from && allocation.periodEnd === options.to
  ) ?? null;

  return buildEconomicsReadinessReport({
    from: options.from,
    to: options.to,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    jobs,
    unattributedCharges,
    configuredCreditRefundUsd,
    cashReceipts: receiptRows.slice(0, MAX_SOURCE_ROWS).map(row => ({
      entitlementId: row.id,
      workspaceId: row.workspaceId,
      grossAmountCents: row.grossAmountCents,
      currency: row.currency,
    })),
    cashAdjustments: adjustmentRows.slice(0, MAX_SOURCE_ROWS).map(row => ({
      entitlementId: row.entitlementId,
      workspaceId: row.entitlement.workspaceId,
      kind: String(row.kind),
      sourceId: row.sourceId,
      amountCents: row.amountCents,
      entitlementGrossAmountCents: row.entitlement.grossAmountCents,
      currency: row.entitlement.currency,
      active: String(row.kind) !== 'DISPUTE' || row.creditsAtRisk > 0,
      occurredAt: row.occurredAt.toISOString(),
    })),
    allocatedCost: matchingAllocation,
    distributionOutcomes: outcomeRows.slice(0, MAX_SOURCE_ROWS).map(row => ({
      status: row.status,
      distributor: row.release.distributor,
    })),
    liveReleaseCount,
    reconciliationConflicts,
    reconciliationInvalid,
    sourceTruncated,
  });
}

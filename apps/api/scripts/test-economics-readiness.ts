import assert from 'node:assert/strict';
import {
  buildEconomicsReadinessReport,
  parseEconomicsReconciliationRegistry,
  redactEconomicsReadinessReport,
  resolveEconomicsWindow,
  type AllocatedCostEvidence,
  type EconomicsEvidenceInput,
  type EconomicsJobEvidence,
  type InvoiceLineEvidence,
} from '../src/lib/economics-readiness';

const period = {
  from: '2026-07-01',
  to: '2026-07-31',
  generatedAt: '2026-08-01T00:00:00.000Z',
};

function invoice(
  providerJobId: string,
  provider: string,
  actualCostUsd: number,
  retryCostUsd = 0,
  retryAttempts = 0
): InvoiceLineEvidence {
  return {
    providerJobId,
    provider,
    invoiceId: 'invoice_' + providerJobId,
    lineItemId: 'line_' + providerJobId,
    actualCostUsd,
    retryCostUsd,
    retryAttempts,
    currency: 'USD',
    reconciledAt: '2026-08-01T00:00:00.000Z',
  };
}

function job(overrides: Partial<EconomicsJobEvidence> = {}): EconomicsJobEvidence {
  return {
    id: 'job_1',
    workspaceId: 'workspace_1',
    kind: 'music',
    provider: 'replicate',
    status: 'SUCCEEDED',
    chargeKey: 'full_song_demo',
    configuredChargeUsd: 8,
    estimatedCostUsd: 2,
    retryAttempts: 0,
    requiresInvoice: true,
    invoice: null,
    ...overrides,
  };
}

function evidence(overrides: Partial<EconomicsEvidenceInput> = {}): EconomicsEvidenceInput {
  return {
    ...period,
    jobs: [job()],
    unattributedCharges: [],
    configuredCreditRefundUsd: 0,
    cashReceipts: [{ entitlementId: 'entitlement_1', workspaceId: 'workspace_1', grossAmountCents: 1_000, currency: 'USD' }],
    cashAdjustments: [],
    allocatedCost: null,
    distributionOutcomes: [{ status: 'live', distributor: 'partner' }],
    liveReleaseCount: 1,
    ...overrides,
  };
}

const estimateOnly = buildEconomicsReadinessReport(evidence());
assert.equal(estimateOnly.readiness.classification, 'configured_estimate');
assert.equal(estimateOnly.readiness.readyForInvestorDiligence, false);
assert.equal(estimateOnly.providerCosts.estimatedCostUsd, 2);
assert.equal(estimateOnly.providerCosts.invoiceActualCostUsd, null);
assert.equal(estimateOnly.providerCosts.invoiceCoveragePercent, 0);
assert.equal(estimateOnly.contribution.estimatedPreAllocationCashContributionUsd, 8);
assert.equal(estimateOnly.contribution.invoiceReconciledActualUsd, null);
assert.ok(estimateOnly.readiness.blockers.includes('missing_provider_invoice_coverage'));
assert.ok(estimateOnly.readiness.blockers.includes('missing_allocated_cost_coverage'));

const allocation: AllocatedCostEvidence = {
  periodStart: period.from,
  periodEnd: period.to,
  currency: 'USD',
  coverageComplete: true,
  storageUsd: 1,
  egressUsd: 0.5,
  supportUsd: 2,
  paymentFeesUsd: 1,
  otherUsd: 0.5,
  otherLabel: 'Compliance review',
  evidenceRef: 'finance://2026-07-fully-loaded',
};
const actualJob1 = invoice('job_1', 'replicate', 2.5, 0.5, 1);
const actualJob2 = invoice('job_2', 'openai', 1);
const actual = buildEconomicsReadinessReport(evidence({
  jobs: [
    job({ invoice: actualJob1, retryAttempts: 1 }),
    job({
      id: 'job_2',
      workspaceId: 'workspace_2',
      kind: 'image',
      provider: 'openai',
      chargeKey: 'cover_art',
      configuredChargeUsd: 5,
      estimatedCostUsd: 0.8,
      invoice: actualJob2,
    }),
  ],
  cashReceipts: [{ entitlementId: 'entitlement_1', workspaceId: 'workspace_1', grossAmountCents: 2_500, currency: 'USD' }],
  cashAdjustments: [{
    entitlementId: 'entitlement_1',
    workspaceId: 'workspace_1',
    kind: 'REFUND',
    sourceId: 'refund:one',
    amountCents: 300,
    entitlementGrossAmountCents: 2_500,
    currency: 'USD',
    active: true,
    occurredAt: '2026-07-20T00:00:00.000Z',
  }],
  allocatedCost: allocation,
}));
assert.equal(actual.readiness.classification, 'invoice_reconciled_actual');
assert.equal(actual.readiness.readyForInvestorDiligence, true);
assert.deepEqual(actual.readiness.blockers, []);
assert.equal(actual.cash.netReceiptsUsd, 22);
assert.equal(actual.providerCosts.invoiceActualCostUsd, 3.5);
assert.equal(actual.providerCosts.invoiceRetryCostUsd, 0.5);
assert.equal(actual.allocatedCosts?.totalUsd, 5);
assert.equal(actual.contribution.invoiceReconciledActualUsd, 13.5);
assert.equal(actual.contribution.actualMarginPercent, 61.36);
assert.equal(actual.byEngine.find(row => row.key === 'replicate')?.invoiceActualProviderCostUsd, 2.5);
assert.equal(actual.byWorkflow.find(row => row.key === 'cover_art')?.configuredUsageUsd, 5);
assert.equal(actual.heavyUserCohort.activeWorkspaces, 2);
assert.equal(actual.heavyUserCohort.memberCount, 1);
assert.equal(actual.heavyUserCohort.members[0].workspaceId, 'workspace_1');

const partiallyReconciled = buildEconomicsReadinessReport(evidence({
  jobs: [
    job({ invoice: actualJob1 }),
    job({ id: 'job_2', provider: 'openai', invoice: null }),
  ],
  allocatedCost: allocation,
}));
assert.equal(partiallyReconciled.readiness.classification, 'configured_estimate');
assert.equal(partiallyReconciled.providerCosts.invoiceCoveragePercent, 50);
assert.equal(partiallyReconciled.providerCosts.invoiceActualCostUsd, null);
assert.deepEqual(partiallyReconciled.providerCosts.missingProviderJobIds, ['job_2']);

const unknownRefund = buildEconomicsReadinessReport(evidence({
  jobs: [job({ invoice: actualJob1 })],
  allocatedCost: allocation,
  cashAdjustments: [{
    entitlementId: 'entitlement_1',
    workspaceId: 'workspace_1',
    kind: 'REFUND',
    sourceId: 'refund:unknown',
    amountCents: null,
    entitlementGrossAmountCents: 1_000,
    currency: 'USD',
    active: true,
    occurredAt: '2026-07-20T00:00:00.000Z',
  }],
}));
assert.equal(unknownRefund.cash.classification, 'incomplete_actual');
assert.equal(unknownRefund.cash.netReceiptsUsd, null);
assert.equal(unknownRefund.contribution.invoiceReconciledActualUsd, null);
assert.ok(unknownRefund.readiness.blockers.includes('incomplete_cash_revenue_or_refund_coverage'));

const cumulativeRefund = buildEconomicsReadinessReport(evidence({
  cashAdjustments: [
    {
      entitlementId: 'entitlement_1', workspaceId: 'workspace_1', kind: 'REFUND',
      sourceId: 'refund-total:payment_1', amountCents: 200, entitlementGrossAmountCents: 1_000,
      currency: 'USD', active: true, occurredAt: '2026-07-10T00:00:00.000Z',
    },
    {
      entitlementId: 'entitlement_1', workspaceId: 'workspace_1', kind: 'REFUND',
      sourceId: 'refund-total:payment_1', amountCents: 400, entitlementGrossAmountCents: 1_000,
      currency: 'USD', active: true, occurredAt: '2026-07-20T00:00:00.000Z',
    },
    {
      entitlementId: 'entitlement_1', workspaceId: 'workspace_1', kind: 'DISPUTE',
      sourceId: 'dispute:released', amountCents: 800, entitlementGrossAmountCents: 1_000,
      currency: 'USD', active: false, occurredAt: '2026-07-21T00:00:00.000Z',
    },
  ],
}));
assert.equal(cumulativeRefund.cash.adjustmentCount, 1);
assert.equal(cumulativeRefund.cash.refundsDisputesAndReversalsUsd, 4);
assert.equal(cumulativeRefund.cash.netReceiptsUsd, 6);

const noDistribution = buildEconomicsReadinessReport(evidence({
  jobs: [job({ invoice: actualJob1 })],
  allocatedCost: allocation,
  distributionOutcomes: [],
  liveReleaseCount: 0,
}));
assert.equal(noDistribution.readiness.classification, 'invoice_reconciled_actual');
assert.equal(noDistribution.readiness.readyForInvestorDiligence, false);
assert.ok(noDistribution.readiness.blockers.includes('no_live_distribution_outcome'));

const unsettled = buildEconomicsReadinessReport(evidence({
  jobs: [job({ status: 'RUNNING', requiresInvoice: false })],
  allocatedCost: allocation,
}));
assert.equal(unsettled.providerCosts.nonTerminalJobs, 1);
assert.equal(unsettled.readiness.readyForInvestorDiligence, false);
assert.ok(unsettled.readiness.blockers.includes('unsettled_provider_jobs'));

const redacted = redactEconomicsReadinessReport(actual);
assert.equal(redacted.redacted, true);
assert.equal(redacted.allocatedCosts?.evidenceRef, '[redacted]');
assert.equal('workspaceId' in redacted.heavyUserCohort.members[0], false);
assert.equal(redacted.heavyUserCohort.members[0].rank, 1);
assert.equal(redacted.providerCosts.missingProviderJobIds, 0);
assert.equal(JSON.stringify(redacted).includes('invoice_job_1'), false);
assert.equal(JSON.stringify(redacted).includes('workspace_1'), false);

const window = resolveEconomicsWindow(
  { days: '3' },
  new Date('2026-07-19T15:30:00.000Z')
);
assert.equal(window.from, '2026-07-17');
assert.equal(window.to, '2026-07-19');
assert.throws(() => resolveEconomicsWindow({ from: '2026-07-01' }), /supplied together/);
assert.throws(
  () => resolveEconomicsWindow({ from: '2026-08-01', to: '2026-07-01' }),
  /ascending order/
);

assert.equal(parseEconomicsReconciliationRegistry('{"schemaVersion":2}'), null);
assert.equal(parseEconomicsReconciliationRegistry(JSON.stringify({
  schemaVersion: 1,
  invoiceLines: [{ ...actualJob1, actualCostUsd: -1 }],
  allocatedCosts: [allocation],
  recordedAt: period.generatedAt,
  recordedByUserId: 'operator_1',
})), null);
const parsedRegistry = parseEconomicsReconciliationRegistry(JSON.stringify({
  schemaVersion: 1,
  invoiceLines: [actualJob1],
  allocatedCosts: [allocation],
  recordedAt: period.generatedAt,
  recordedByUserId: 'operator_1',
}));
assert.equal(parsedRegistry?.invoiceLines[0].actualCostUsd, 2.5);

console.log('Economics readiness evidence tests passed');

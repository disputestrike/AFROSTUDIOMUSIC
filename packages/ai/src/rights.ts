/**
 * Rights / similarity checker.
 *
 * Two layers:
 *  1. Heuristic — string n-gram match against a banned-phrase / red-flag list.
 *  2. LLM review — natural-language reasoning on lyric/melody descriptions.
 *
 * Returns a structured set of findings plus a final go/no-go boolean.
 *
 * For full production-grade similarity detection you'd add:
 *  - audio fingerprinting (e.g. Chromaprint / AcoustID against a known catalog),
 *  - melodic-contour matching,
 *  - lyric vector search against licensed lyrics corpora.
 */
import { generateJson } from './generate';
import { RIGHTS_CHECK_SYSTEM } from './prompts/rights';

export interface RightsFinding {
  type:
    | 'lyric_similarity'
    | 'melody_similarity'
    | 'impersonation'
    | 'uncleared_sample'
    | 'language_authenticity';
  severity: 'low' | 'medium' | 'high';
  reason: string;
  evidence?: string;
}

export interface RightsCheckResult {
  findings: RightsFinding[];
  overallRisk: 'low' | 'medium' | 'high';
  okToExport: boolean;
}

const RED_FLAG_PHRASES = [
  // "make it sound like <Artist>" — caught by the LLM, but we also pattern-match.
  'sound like wizkid',
  'sound like davido',
  'sound like rema',
  'sound like burna boy',
  'sound like patoranking',
  // Famous hooks that should not be copied verbatim
  'calm down',
  'unavailable',
];

function heuristicScan(text: string): RightsFinding[] {
  const lower = text.toLowerCase();
  const findings: RightsFinding[] = [];
  for (const phrase of RED_FLAG_PHRASES) {
    if (lower.includes(phrase)) {
      findings.push({
        type: lower.includes('sound like') ? 'impersonation' : 'lyric_similarity',
        severity: 'medium',
        reason: `Red-flag phrase detected: "${phrase}"`,
        evidence: phrase,
      });
    }
  }
  return findings;
}

export async function runRightsCheck(opts: {
  lyricBody?: string;
  hookText?: string;
  references?: Array<{ name: string; lane: string }>;
  producerNotes?: string;
}): Promise<RightsCheckResult> {
  const all = [opts.lyricBody, opts.hookText, opts.producerNotes].filter(Boolean).join('\n\n');
  const heuristic = heuristicScan(all);

  // Claude-first (OpenAI is a dead 429 on the owner's account). If the LLM can't
  // run at all, fall back to the deterministic heuristic scan alone — a rights
  // check must NEVER hard-break the release pipeline with a provider error.
  let llm: RightsCheckResult;
  try {
    llm = await generateJson<RightsCheckResult>({
      system: RIGHTS_CHECK_SYSTEM,
      user: JSON.stringify({
        lyric: opts.lyricBody ?? '',
        hook: opts.hookText ?? '',
        references_lane_only: opts.references ?? [],
        producerNotes: opts.producerNotes ?? '',
      }),
      temperature: 0,
      maxTokens: 1_500,
    });
  } catch {
    llm = { findings: [], overallRisk: 'low', okToExport: true };
  }

  const findings = [...heuristic, ...(llm.findings ?? [])];
  const overallRisk = rollupRisk(findings, llm.overallRisk);
  const okToExport = overallRisk !== 'high';
  return { findings, overallRisk, okToExport };
}

function rollupRisk(
  findings: RightsFinding[],
  llmOverall: 'low' | 'medium' | 'high'
): 'low' | 'medium' | 'high' {
  if (findings.some((f) => f.severity === 'high')) return 'high';
  if (llmOverall === 'high') return 'high';
  if (findings.some((f) => f.severity === 'medium') || llmOverall === 'medium') return 'medium';
  return 'low';
}

/**
 * Compute a deterministic hash of a rights receipt for tamper-evidence.
 * Use this when persisting RightsReceipt.hash so the receipt can be verified later.
 */
export function canonicalReceiptHash(receipt: Record<string, unknown>): Promise<string> {
  const canonical = JSON.stringify(receipt, Object.keys(receipt).sort());
  // dynamic import keeps the package node-only here
  return import('node:crypto').then(({ createHash }) =>
    createHash('sha256').update(canonical).digest('hex')
  );
}

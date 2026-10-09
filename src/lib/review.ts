// Explicit review state machine. Arbitrary status strings are rejected.
//
// Two transition tables exist:
// - TRANSITIONS: the original five-state machine. It is what the optional shared-workspace
//   server enforces (its database only accepts these statuses), so it must not change.
// - LOCAL_TRANSITIONS: the browser-local review workflow, which adds three more outcomes
//   ("needs more information", "temporal / expected change", "unable to determine") so a
//   reviewer is never forced into a definitive decision when evidence is insufficient.
import type { ReviewStatus } from './types';

export const TRANSITIONS: Record<ReviewStatus, ReviewStatus[]> = {
  unreviewed: ['in_review'],
  in_review: ['confirmed', 'resolved', 'dismissed'],
  confirmed: ['resolved', 'in_review'],
  resolved: ['in_review'],
  dismissed: ['in_review'],
  // Local-only statuses: never reachable through the shared workspace.
  needs_info: [],
  expected_change: [],
  undetermined: [],
};

export const LOCAL_TRANSITIONS: Record<ReviewStatus, ReviewStatus[]> = {
  unreviewed: ['in_review'],
  in_review: ['confirmed', 'dismissed', 'needs_info', 'expected_change', 'undetermined', 'resolved'],
  confirmed: ['resolved', 'in_review'],
  resolved: ['in_review'],
  dismissed: ['in_review'],
  needs_info: ['confirmed', 'dismissed', 'expected_change', 'undetermined', 'resolved', 'in_review'],
  expected_change: ['in_review'],
  undetermined: ['in_review'],
};

export type ReviewMode = 'shared' | 'local';

export function transitionsFor(mode: ReviewMode): Record<ReviewStatus, ReviewStatus[]> {
  return mode === 'local' ? LOCAL_TRANSITIONS : TRANSITIONS;
}

export const REVIEW_STATUSES = Object.keys(LOCAL_TRANSITIONS) as ReviewStatus[];

/** Statuses that still need reviewer attention ("pending"). */
export const PENDING_STATUSES: ReviewStatus[] = ['unreviewed', 'in_review', 'needs_info'];
/** Statuses that close a finding without it being an unresolved contradiction. */
export const CLOSED_STATUSES: ReviewStatus[] = ['resolved', 'dismissed', 'expected_change'];

export const MIN_REASON_LENGTH = 5;

export class ReviewError extends Error {}

export function isReviewStatus(s: unknown): s is ReviewStatus {
  return typeof s === 'string' && (REVIEW_STATUSES as string[]).includes(s);
}

const REOPENABLE: ReviewStatus[] = ['resolved', 'dismissed', 'confirmed', 'expected_change', 'undetermined'];

/**
 * A reason is required to resolve, dismiss, classify as an expected change, record that the
 * question cannot be determined, or reopen a decided finding. Confirming and asking for more
 * information accept an optional rationale.
 */
export function reasonRequired(from: ReviewStatus, to: ReviewStatus): boolean {
  if (to === 'resolved' || to === 'dismissed' || to === 'expected_change' || to === 'undetermined') return true;
  return to === 'in_review' && REOPENABLE.includes(from);
}

export function validateTransition(from: ReviewStatus, to: unknown, reason: string | undefined, mode: ReviewMode = 'shared'): asserts to is ReviewStatus {
  if (!isReviewStatus(to)) throw new ReviewError(`Unknown review status "${String(to)}".`);
  if (!transitionsFor(mode)[from]?.includes(to)) {
    throw new ReviewError(`A finding cannot move from "${from}" to "${to}".`);
  }
  if (reasonRequired(from, to) && (reason ?? '').trim().length < MIN_REASON_LENGTH) {
    throw new ReviewError(`A reason of at least ${MIN_REASON_LENGTH} characters is required for this decision.`);
  }
}

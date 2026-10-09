// Explicit review state machine. Arbitrary status strings are rejected.
import type { ReviewStatus } from './types';

export const TRANSITIONS: Record<ReviewStatus, ReviewStatus[]> = {
  unreviewed: ['in_review'],
  in_review: ['confirmed', 'resolved', 'dismissed'],
  confirmed: ['resolved', 'in_review'],
  resolved: ['in_review'],
  dismissed: ['in_review'],
};

export const REVIEW_STATUSES = Object.keys(TRANSITIONS) as ReviewStatus[];

export const MIN_REASON_LENGTH = 5;

export class ReviewError extends Error {}

export function isReviewStatus(s: unknown): s is ReviewStatus {
  return typeof s === 'string' && (REVIEW_STATUSES as string[]).includes(s);
}

/** A reason is required to resolve, dismiss, or reopen a closed finding. */
export function reasonRequired(from: ReviewStatus, to: ReviewStatus): boolean {
  return to === 'resolved' || to === 'dismissed' || (to === 'in_review' && (from === 'resolved' || from === 'dismissed' || from === 'confirmed'));
}

export function validateTransition(from: ReviewStatus, to: unknown, reason: string | undefined): asserts to is ReviewStatus {
  if (!isReviewStatus(to)) throw new ReviewError(`Unknown review status "${String(to)}".`);
  if (!TRANSITIONS[from].includes(to)) {
    throw new ReviewError(`A finding cannot move from "${from}" to "${to}".`);
  }
  if (reasonRequired(from, to) && (reason ?? '').trim().length < MIN_REASON_LENGTH) {
    throw new ReviewError(`A reason of at least ${MIN_REASON_LENGTH} characters is required for this decision.`);
  }
}

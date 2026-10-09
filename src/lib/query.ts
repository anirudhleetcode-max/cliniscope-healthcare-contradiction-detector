// Pure search / filter / sort helpers for the review queue.
import type { Category, EvidenceQuality, Finding, FindingType, ReviewStatus } from './types';
import { CATEGORY_LABEL, FINDING_TYPE_LABEL } from './types';

export interface FindingFilter {
  search?: string;
  status?: ReviewStatus | 'all';
  type?: FindingType | 'all';
  category?: Category | 'all';
  quality?: EvidenceQuality | 'all';
  dateFrom?: string;
  dateTo?: string;
  includeStale?: boolean;
}

export type FindingSort = 'newest' | 'oldest' | 'category' | 'status' | 'priority';

const STATUS_ORDER: ReviewStatus[] = ['unreviewed', 'in_review', 'needs_info', 'confirmed', 'undetermined', 'expected_change', 'resolved', 'dismissed'];
const PRIORITY_ORDER = ['prompt', 'routine', 'low'];

export function filterFindings(list: Finding[], f: FindingFilter): Finding[] {
  const q = (f.search ?? '').trim().toLowerCase();
  return list.filter((x) => {
    if (!f.includeStale && x.stale) return false;
    if (f.status && f.status !== 'all' && x.reviewStatus !== f.status) return false;
    if (f.type && f.type !== 'all' && x.findingType !== f.type) return false;
    if (f.category && f.category !== 'all' && x.category !== f.category) return false;
    if (f.quality && f.quality !== 'all' && x.evidenceQuality !== f.quality) return false;
    if (f.dateFrom || f.dateTo) {
      const dates = x.relevantDates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
      const inRange = dates.some((d) => (!f.dateFrom || d >= f.dateFrom) && (!f.dateTo || d <= f.dateTo));
      if (!inRange) return false;
    }
    if (q) {
      const hay = [
        x.title, x.displayId, CATEGORY_LABEL[x.category], FINDING_TYPE_LABEL[x.findingType], x.explanation,
        ...x.evidence.map((e) => `${e.quote} ${e.documentTitle}`),
      ].join(' \u0000 ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function sortFindings(list: Finding[], sort: FindingSort): Finding[] {
  const out = [...list];
  switch (sort) {
    case 'newest': return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.displayId.localeCompare(b.displayId));
    case 'oldest': return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.displayId.localeCompare(b.displayId));
    case 'category': return out.sort((a, b) => CATEGORY_LABEL[a.category].localeCompare(CATEGORY_LABEL[b.category]) || a.title.localeCompare(b.title));
    case 'status': return out.sort((a, b) => STATUS_ORDER.indexOf(a.reviewStatus) - STATUS_ORDER.indexOf(b.reviewStatus));
    case 'priority': return out.sort((a, b) => PRIORITY_ORDER.indexOf(a.reviewPriority) - PRIORITY_ORDER.indexOf(b.reviewPriority) || STATUS_ORDER.indexOf(a.reviewStatus) - STATUS_ORDER.indexOf(b.reviewStatus));
  }
}

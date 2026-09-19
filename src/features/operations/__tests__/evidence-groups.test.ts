import { describe, expect, it } from 'vitest';
import {
  EVIDENCE_GROUPS,
  evidenceGroupCategories,
  evidenceGroupKey,
  evidenceGroupLabel,
  groupEvidence,
  JOB_UPLOAD_CATEGORIES,
  parseEvidenceGroup
} from '../evidence-groups';

// Every category app.evidence_categories() allows.
const CATEGORIES = [
  'Contract',
  'CustomerDetails',
  'FinanceAgreement',
  'TaskEvidence',
  'DeliveryNote',
  'Other',
  'Progress',
  'Completion',
  'Commissioning',
  'Problem',
  'Variation',
  'Return'
];

describe('evidence groups', () => {
  it('puts every database category in exactly one group', () => {
    for (const category of CATEGORIES) {
      expect(
        EVIDENCE_GROUPS.filter((g) =>
          (g.categories as readonly string[]).includes(category)
        )
      ).toHaveLength(1);
    }
    expect(EVIDENCE_GROUPS.flatMap((g) => g.categories).sort()).toEqual(
      [...CATEGORIES].sort()
    );
  });

  it('maps categories to the staff groups', () => {
    expect(evidenceGroupKey({ category: 'Contract' })).toBe('contracts');
    expect(evidenceGroupKey({ category: 'CustomerDetails' })).toBe(
      'customer-finance'
    );
    expect(evidenceGroupKey({ category: 'FinanceAgreement' })).toBe(
      'customer-finance'
    );
    expect(evidenceGroupKey({ category: 'TaskEvidence' })).toBe('task');
    for (const c of ['Progress', 'Completion', 'Variation', 'Return'])
      expect(evidenceGroupKey({ category: c })).toBe('photos');
    expect(evidenceGroupKey({ category: 'Commissioning' })).toBe(
      'commissioning'
    );
    expect(evidenceGroupKey({ category: 'Problem' })).toBe('issues');
    expect(evidenceGroupKey({ category: 'DeliveryNote' })).toBe('materials');
    expect(evidenceGroupKey({ category: 'Other' })).toBe('other');
  });

  it('files an issue’s file under Issues whatever its category', () => {
    expect(
      evidenceGroupKey({ category: 'Progress', issue_id: 'issue-1' })
    ).toBe('issues');
    expect(evidenceGroupKey({ category: 'Progress', issue_id: null })).toBe(
      'photos'
    );
  });

  it('sends unknown or missing categories to Other', () => {
    expect(evidenceGroupKey({ category: 'Mystery' })).toBe('other');
    expect(evidenceGroupKey({ category: null })).toBe('other');
    expect(evidenceGroupKey({ category: undefined })).toBe('other');
  });

  it('groups files in the fixed order, keeping file order and skipping empty groups', () => {
    const files = [
      { id: 'a', category: 'Other' },
      { id: 'b', category: 'Progress' },
      { id: 'c', category: 'Contract' },
      { id: 'd', category: 'Completion' },
      { id: 'e', category: 'Variation', issue_id: 'i1' }
    ];
    const groups = groupEvidence(files);
    expect(groups.map((g) => g.label)).toEqual([
      'Contracts',
      'Photos & installation',
      'Issues',
      'Other'
    ]);
    expect(groups[1].files.map((f) => f.id)).toEqual(['b', 'd']);
    expect(groupEvidence([])).toEqual([]);
  });

  it('labels, parses and expands groups', () => {
    expect(evidenceGroupLabel('customer-finance')).toBe('Customer & finance');
    expect(parseEvidenceGroup('photos')).toBe('photos');
    expect(parseEvidenceGroup('nope')).toBeNull();
    expect(parseEvidenceGroup(undefined)).toBeNull();
    expect(evidenceGroupCategories('photos')).toEqual([
      'Progress',
      'Completion',
      'Variation',
      'Return'
    ]);
  });

  it('offers only real categories for direct job uploads', () => {
    for (const c of JOB_UPLOAD_CATEGORIES) expect(CATEGORIES).toContain(c);
    expect(JOB_UPLOAD_CATEGORIES).not.toContain('TaskEvidence');
    expect(JOB_UPLOAD_CATEGORIES).not.toContain('Return');
  });
});

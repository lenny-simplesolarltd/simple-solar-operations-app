import { describe, expect, it } from 'vitest';
import { classifyReadFailure, READ_FAILURE_MESSAGES } from '../read-failures';

describe('read failure wording', () => {
  it('calls the release gate "switched off", not a permissions problem', () => {
    for (const code of ['R1A_MODE_DENIED', 'R1A_MODE_MISSING']) {
      expect(classifyReadFailure(code)).toBe('not_enabled');
    }
    expect(READ_FAILURE_MESSAGES.not_enabled).toMatch(/switched off/i);
    expect(READ_FAILURE_MESSAGES.not_enabled).not.toMatch(/access/i);
  });

  it('still reports real authorization refusals as no access', () => {
    for (const code of [
      'R1A_ROLE_DENIED',
      'R1A_JOB_ACCESS_DENIED',
      'R1A_TASK_ACCESS_DENIED',
      'R1A_NO_ACTIVE_ROLE',
      'R1A_INACTIVE_ACTOR',
      'SOMETHING_NEW_DENIED'
    ]) {
      expect(classifyReadFailure(code)).toBe('forbidden');
    }
  });

  it('keeps the other kinds as they were', () => {
    expect(classifyReadFailure('R1A_JOB_NOT_FOUND')).toBe('not_found');
    expect(classifyReadFailure('R1A_INVALID_FIELDS')).toBe('invalid');
    expect(classifyReadFailure('R1A_DUE_DATE_INVALID')).toBe('invalid');
    expect(classifyReadFailure('SOMETHING_ELSE')).toBe('error');
  });
});

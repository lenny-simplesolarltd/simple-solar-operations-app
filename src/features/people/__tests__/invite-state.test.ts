import { describe, expect, it } from 'vitest';
import {
  INVITE_STALE_AFTER_HOURS,
  describeLogin,
  hasPendingInvite,
  type PersonLoginFacts
} from '../invite-state';

const NOW = new Date('2026-09-20T12:00:00Z');
const hoursAgo = (h: number) =>
  new Date(NOW.getTime() - h * 3_600_000).toISOString();

const facts = (over: Partial<PersonLoginFacts> = {}): PersonLoginFacts => ({
  email: 'ben@example.com',
  hasLogin: false,
  authUser: null,
  ...over
});

describe('the four states an administrator sees', () => {
  it('has no login when nobody has invited them', () => {
    const s = describeLogin(facts(), NOW);
    expect(s.state).toBe('NoLogin');
    expect(s.label).toBe('No login');
  });

  it('is an active login once the address is verified', () => {
    const s = describeLogin(facts({ hasLogin: true }), NOW);
    expect(s.state).toBe('ActiveLogin');
    expect(s.label).toBe('Active login');
  });

  it('is pending while the invite is fresh', () => {
    const s = describeLogin(
      facts({
        authUser: { emailConfirmedAt: null, invitedAt: hoursAgo(0.5) }
      }),
      NOW
    );
    expect(s.state).toBe('InvitePending');
    expect(s.detail).toMatch(/less than an hour ago/);
  });

  it('goes stale once the link has outlived its configured life', () => {
    const s = describeLogin(
      facts({
        authUser: {
          emailConfirmedAt: null,
          invitedAt: hoursAgo(INVITE_STALE_AFTER_HOURS + 0.1)
        }
      }),
      NOW
    );
    expect(s.state).toBe('InviteStale');
    expect(s.tone).toBe('attention');
  });

  it('says a person with no email cannot be invited at all', () => {
    const s = describeLogin(facts({ email: null }), NOW);
    expect(s.state).toBe('NoEmail');
  });
});

describe('what it refuses to claim', () => {
  // GoTrue never tells us an invite died. Saying so outright would be the same
  // mistake as claiming an email was delivered.
  it('never states expiry as a fact, only that the link may not work', () => {
    const s = describeLogin(
      facts({
        authUser: { emailConfirmedAt: null, invitedAt: hoursAgo(72) }
      }),
      NOW
    );
    expect(s.detail).toMatch(/may no longer work/i);
    expect(s.detail).not.toMatch(/\bhas expired\b|\bis expired\b/i);
    expect(s.label).not.toMatch(/expired/i);
  });

  it('does not guess an age when the provider gave no sent time', () => {
    const s = describeLogin(
      facts({ authUser: { emailConfirmedAt: null, invitedAt: null } }),
      NOW
    );
    expect(s.state).toBe('InvitePending');
    expect(s.invitedHoursAgo).toBeNull();
    expect(s.detail).toBe('Invited, not yet accepted.');
  });
});

describe('the confirmed-but-unlinked case', () => {
  // A confirmed auth user whose person row has no auth_user_id means the
  // trigger did not match (different address, or the person is inactive).
  // Re-inviting is still the right action, so it reads as never invited.
  it('reads as no login, not as pending', () => {
    const s = describeLogin(
      facts({
        hasLogin: false,
        authUser: {
          emailConfirmedAt: hoursAgo(5),
          invitedAt: hoursAgo(6)
        }
      }),
      NOW
    );
    expect(s.state).toBe('NoLogin');
  });
});

describe('hasPendingInvite', () => {
  it('is true only while an invite is outstanding', () => {
    const pending = describeLogin(
      facts({ authUser: { emailConfirmedAt: null, invitedAt: hoursAgo(0.1) } }),
      NOW
    );
    const stale = describeLogin(
      facts({ authUser: { emailConfirmedAt: null, invitedAt: hoursAgo(99) } }),
      NOW
    );
    expect(hasPendingInvite(pending)).toBe(true);
    expect(hasPendingInvite(stale)).toBe(true);
    expect(hasPendingInvite(describeLogin(facts(), NOW))).toBe(false);
    expect(
      hasPendingInvite(describeLogin(facts({ hasLogin: true }), NOW))
    ).toBe(false);
  });
});

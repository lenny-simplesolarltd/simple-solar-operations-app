// What a person's login actually is, derived from two independent facts:
//
//   people.auth_user_id   set by a database trigger when an emailed address is
//                         VERIFIED. This is the only thing that means "they can
//                         sign in and the app knows who they are".
//   auth.users            the invite itself, which only the service role may
//                         list. An unconfirmed row here is an invite nobody has
//                         accepted yet.
//
// The two can disagree, and the disagreements are the interesting states: an
// auth user with no confirmation is a pending invite; a confirmed auth user
// whose person row has no auth_user_id would be a person whose email does not
// match the login they accepted.
//
// ON EXPIRY, AND WHY IT IS NEVER STATED AS A FACT
//
// GoTrue does not tell us when an invite link dies. It exposes when the mail
// was sent and nothing else, and the lifetime is configured per project (and
// differs between the local stack and hosted). So we do NOT claim an invite has
// expired - we say how old it is and that the link MAY no longer work. The
// remedy is the same either way: resend. Claiming expiry we cannot evidence
// would be the same mistake as claiming an email was delivered.

export type LoginState =
  | 'NoEmail'
  | 'NoLogin'
  | 'InvitePending'
  | 'InviteStale'
  | 'ActiveLogin';

/**
 * How old a pending invite may get before we suggest resending it.
 *
 * Tracks `otp_expiry` in supabase/config.toml, which is 3600s - a Supabase
 * invite link is good for ONE HOUR, not a day. Getting this wrong in the
 * lenient direction is the harmful one: it tells an administrator the invite
 * is fine while the recipient is clicking a dead link. The hosted project can
 * be configured differently, which is the other reason this is worded as "may
 * no longer work" rather than an expiry we claim to know.
 */
export const INVITE_STALE_AFTER_HOURS = 1;

export interface AuthUserFacts {
  /** auth.users.email_confirmed_at - the moment the address became verified. */
  emailConfirmedAt: string | null;
  /** When the invite mail was last sent (invited_at, else confirmation_sent_at). */
  invitedAt: string | null;
}

export interface PersonLoginFacts {
  email: string | null;
  /** True once people.auth_user_id is set by the linking trigger. */
  hasLogin: boolean;
  /** The matching auth.users row, if any. Matched on email. */
  authUser?: AuthUserFacts | null;
}

export interface LoginStatus {
  state: LoginState;
  label: string;
  /** One sentence for the person reading the row. Never claims more than we know. */
  detail: string;
  tone: 'neutral' | 'progress' | 'done' | 'attention';
  /** Hours since the invite was sent, when there is a pending one. */
  invitedHoursAgo: number | null;
}

export function describeLogin(
  person: PersonLoginFacts,
  now: Date = new Date()
): LoginStatus {
  if (!person.email)
    return {
      state: 'NoEmail',
      label: 'No email',
      detail: 'This person has no email address, so they cannot be invited.',
      tone: 'neutral',
      invitedHoursAgo: null
    };

  if (person.hasLogin)
    return {
      state: 'ActiveLogin',
      label: 'Active login',
      detail: 'They have verified their email and can sign in.',
      tone: 'done',
      invitedHoursAgo: null
    };

  const auth = person.authUser;
  if (!auth || auth.emailConfirmedAt)
    // No invite outstanding. A confirmed auth user with no link on the person
    // row is not something this screen can fix, and inviting again is still the
    // right action, so it reads the same as never invited.
    return {
      state: 'NoLogin',
      label: 'No login',
      detail: 'They have not been invited yet.',
      tone: 'neutral',
      invitedHoursAgo: null
    };

  const hours = hoursSince(auth.invitedAt, now);
  if (hours !== null && hours >= INVITE_STALE_AFTER_HOURS)
    return {
      state: 'InviteStale',
      label: 'Invite pending',
      detail: `Invited ${describeAge(hours)} ago and not accepted. The link may no longer work — resend it.`,
      tone: 'attention',
      invitedHoursAgo: hours
    };

  return {
    state: 'InvitePending',
    label: 'Invite pending',
    detail:
      hours === null
        ? 'Invited, not yet accepted.'
        : `Invited ${describeAge(hours)} ago, not yet accepted.`,
    tone: 'progress',
    invitedHoursAgo: hours
  };
}

/** Whether there is an unaccepted invite that could be resent or withdrawn. */
export function hasPendingInvite(status: LoginStatus): boolean {
  return status.state === 'InvitePending' || status.state === 'InviteStale';
}

function hoursSince(at: string | null, now: Date): number | null {
  if (!at) return null;
  const then = new Date(at).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, (now.getTime() - then) / 3_600_000);
}

function describeAge(hours: number): string {
  if (hours < 1) return 'less than an hour';
  if (hours < 24) {
    const h = Math.floor(hours);
    return `${h} hour${h === 1 ? '' : 's'}`;
  }
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

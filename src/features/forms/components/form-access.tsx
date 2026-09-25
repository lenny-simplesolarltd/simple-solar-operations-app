'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { IconLoader2 } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { AccessMode, FormAccess } from '../server/access';
import { setFormAccessAction } from '../server/actions';

/**
 * Who may complete this form.
 *
 * Forms could say who may ADMINISTER them and nothing at all about who may fill
 * one in, so the only way to put a form in front of a colleague was to email
 * them a recipient link. This section is where that is decided, and it offers
 * exactly the three shapes the database allows - there is no fourth, and no
 * free-text audience.
 *
 * Workflow is not something a manager can choose: it is a fact about whether
 * another domain points at this form. The command refuses it otherwise
 * (FORMS_ACCESS_NOT_WORKFLOW_OWNED), because a form declared workflow-owned
 * with nothing owning it can be completed by nobody - a silent dead end.
 */

/** Plain wording for the role codes. Anything unrecognised shows its code. */
const ROLE_LABEL: Record<string, string> = {
  Admin: 'Admin',
  Director: 'Director',
  Finance: 'Finance',
  Installer: 'Installer',
  Manager: 'Manager',
  Office: 'Office',
  Scaffolder: 'Scaffolder',
  Store: 'Store',
  Surveyor: 'Surveyor',
  VariationApprover: 'Variation approver'
};

// A ReadOnly account writes nothing, anywhere, so it is not offered here. The
// FORM_COMPLETE command leaves it out too: naming it would put the form on
// somebody's list and then refuse their submission.
const NEVER_COMPLETES = ['ReadOnly'];

const MODES: {
  value: Exclude<AccessMode, 'Workflow'>;
  label: string;
  hint: string;
}[] = [
  {
    value: 'Invitation',
    label: 'Only people sent a link',
    hint: 'Customers and surveyors answer from an emailed link. Nobody sees this form in the app.'
  },
  {
    value: 'Roles',
    label: 'People with certain roles',
    hint: 'It appears under "To complete" for everyone holding a role you choose.'
  }
];

export function FormAccess({
  formId,
  access,
  canEdit
}: {
  formId: string;
  access: FormAccess;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<AccessMode>(access.mode);
  const [roles, setRoles] = useState<string[]>(access.roles);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    tone: 'error' | 'ok';
    text: string;
  } | null>(null);

  const choices = access.allRoles.filter((r) => !NEVER_COMPLETES.includes(r));
  const dirty =
    mode !== access.mode ||
    [...roles].sort().join(',') !== [...access.roles].sort().join(',');

  const toggle = (role: string) =>
    setRoles((current) =>
      current.includes(role)
        ? current.filter((r) => r !== role)
        : [...current, role]
    );

  const save = async () => {
    setMessage(null);
    setBusy(true);
    const result = await setFormAccessAction(
      { formId, mode, roleCodes: mode === 'Roles' ? roles : [] },
      // No expected version: who may complete a form is not part of the draft
      // being edited beside this, so a saved question should not make this
      // refuse. The command audits the change either way.
      null,
      crypto.randomUUID()
    );
    setBusy(false);
    if (!result.ok) {
      // The database's own refusal, shown as it came back. A manager needs to
      // know WHICH rule stopped the change, not that "something went wrong".
      setMessage({ tone: 'error', text: result.message });
      return;
    }
    setMessage({ tone: 'ok', text: 'Saved.' });
    router.refresh();
  };

  return (
    <section aria-labelledby='access-heading' className='flex flex-col gap-3'>
      <div>
        <h2 id='access-heading' className='text-lg font-semibold'>
          Access — who can complete this form?
        </h2>
        <p className='text-muted-foreground text-sm'>
          Separate from who may edit it. This decides whose list it appears on.
        </p>
      </div>

      {access.workflowOwned ? (
        <div className='bg-muted/60 rounded-lg px-4 py-3 text-sm'>
          <p className='font-medium'>
            {access.workflowName
              ? `${access.workflowName} decides`
              : 'A programme decides'}
          </p>
          <p className='text-muted-foreground mt-1'>
            This form is a programme&rsquo;s visit form, so the programme
            decides who completes it: the people it has assigned, with the
            properties they are allowed to see. That cannot be set here, and
            changing the programme&rsquo;s form is how it changes.
          </p>
        </div>
      ) : (
        <div className='flex flex-col gap-3'>
          <fieldset
            className='flex flex-col gap-1.5'
            disabled={!canEdit || busy}
          >
            <legend className='sr-only'>Who can complete this form</legend>
            {MODES.map((option) => (
              <label
                key={option.value}
                className={cn(
                  'hover:bg-accent/60 has-[:checked]:border-foreground flex min-h-11 cursor-pointer items-start gap-3 rounded-md border px-3 py-2 text-sm',
                  !canEdit && 'cursor-default'
                )}
              >
                <input
                  type='radio'
                  name='form-access-mode'
                  className='accent-foreground mt-1 size-4'
                  checked={mode === option.value}
                  disabled={!canEdit || busy}
                  onChange={() => setMode(option.value)}
                />
                <span className='min-w-0'>
                  <span className='block font-medium'>{option.label}</span>
                  <span className='text-muted-foreground block text-xs'>
                    {option.hint}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          {mode === 'Roles' && (
            <fieldset
              className='flex flex-col gap-1.5'
              disabled={!canEdit || busy}
            >
              <legend className='mb-1 text-sm font-medium'>
                Roles that may complete it
              </legend>
              <div className='grid gap-1.5 sm:grid-cols-2'>
                {choices.map((role) => (
                  <label
                    key={role}
                    className={cn(
                      'hover:bg-accent/60 has-[:checked]:border-foreground flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 text-sm',
                      !canEdit && 'cursor-default'
                    )}
                  >
                    <input
                      type='checkbox'
                      className='accent-foreground size-4'
                      checked={roles.includes(role)}
                      disabled={!canEdit || busy}
                      onChange={() => toggle(role)}
                    />
                    {ROLE_LABEL[role] ?? role}
                  </label>
                ))}
              </div>
              <p className='text-muted-foreground text-xs'>
                Read-only accounts are not listed: they cannot submit anything.
              </p>
            </fieldset>
          )}

          {canEdit && (
            <div className='flex flex-wrap items-center gap-3'>
              <Button
                onClick={() => void save()}
                disabled={!dirty || busy}
                className='min-h-11'
              >
                {busy && <IconLoader2 aria-hidden className='animate-spin' />}
                {dirty ? 'Save access' : 'Saved'}
              </Button>
              <p className='text-muted-foreground text-xs'>
                A form appears on someone&rsquo;s list only once it is
                published.
              </p>
            </div>
          )}
        </div>
      )}

      {message && (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={cn(
            'rounded-lg px-3 py-2 text-sm',
            message.tone === 'error'
              ? 'bg-destructive-soft text-destructive'
              : 'bg-success-soft text-success'
          )}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}

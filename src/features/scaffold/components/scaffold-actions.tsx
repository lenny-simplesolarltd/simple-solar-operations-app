'use client';

import { SimpleCommand } from '@/features/operations/simple-command';
import { IconPlus } from '@tabler/icons-react';

// Scaffold booking commands (R2 SCAFFOLD_*), offered by booking status. The
// booking's version guards every change; the server re-checks status rules.

type Booking = {
  id: string;
  job_id: string;
  version: number;
  status: string;
  erect_planned_at: string | null;
  strip_planned_at: string | null;
  erect_actual_at: string | null;
};

const pence = (v: string) => (v ? Math.round(Number(v) * 100) : undefined);

export function ScaffoldBookingActions({ booking }: { booking: Booking }) {
  const req = { job_id: booking.job_id, expected_version: booking.version };
  const withId = (v: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries({ booking_id: booking.id, ...v }).filter(
        ([, x]) => x !== undefined && x !== ''
      )
    );
  const s = booking.status;
  const erectedNotStruck = [
    'Erected',
    'StripAuthorised',
    'StripPlanned',
    'StripConfirmed'
  ].includes(s);

  return (
    <div className='flex flex-wrap gap-2'>
      {['Requested', 'Confirmed'].includes(s) && (
        <>
          {s === 'Requested' && (
            <SimpleCommand
              label='Scaffolder confirmed'
              variant='default'
              title='Record the scaffolder’s confirmation'
              request={{ command_type: 'SCAFFOLD_CONFIRM_ERECT', ...req }}
              fields={[
                { key: 'response_text', label: 'What they said', kind: 'note' }
              ]}
              payload={(v) => withId({ response_text: v.response_text })}
            />
          )}
          <SimpleCommand
            label='Scaffold is up'
            variant={s === 'Confirmed' ? 'default' : 'outline'}
            title='Record scaffold erected'
            request={{ command_type: 'SCAFFOLD_RECORD_ERECTED', ...req }}
            fields={[
              {
                key: 'erect_actual_at',
                label: 'Date it went up',
                kind: 'date',
                required: true,
                initial: booking.erect_planned_at ?? ''
              }
            ]}
            payload={(v) => withId({ erect_actual_at: v.erect_actual_at })}
          />
        </>
      )}
      {s === 'Erected' && (
        <SimpleCommand
          label='Authorise strip'
          variant='default'
          title='Authorise the scaffold to come down'
          description='Refused while the customer is not confirmed happy or a complaint blocks the strip.'
          request={{ command_type: 'SCAFFOLD_AUTHORISE_STRIP', ...req }}
          payload={() => withId({})}
        />
      )}
      {['StripAuthorised', 'StripPlanned', 'StripConfirmed'].includes(s) && (
        <SimpleCommand
          label={s === 'StripAuthorised' ? 'Plan strip' : 'Re-plan strip'}
          variant={s === 'StripAuthorised' ? 'default' : 'outline'}
          title='Plan the strip date'
          request={{ command_type: 'SCAFFOLD_PLAN_STRIP', ...req }}
          fields={[
            {
              key: 'strip_planned_at',
              label: 'Strip date',
              kind: 'date',
              required: true,
              initial: booking.strip_planned_at ?? ''
            }
          ]}
          payload={(v) => withId({ strip_planned_at: v.strip_planned_at })}
        />
      )}
      {s === 'StripPlanned' && (
        <SimpleCommand
          label='Scaffolder confirmed strip'
          title='Record the strip confirmation'
          request={{ command_type: 'SCAFFOLD_CONFIRM_STRIP', ...req }}
          fields={[
            { key: 'response_text', label: 'What they said', kind: 'note' }
          ]}
          payload={(v) => withId({ response_text: v.response_text })}
        />
      )}
      {['StripAuthorised', 'StripPlanned', 'StripConfirmed'].includes(s) && (
        <SimpleCommand
          label='Scaffold is down'
          title='Record scaffold stripped'
          request={{ command_type: 'SCAFFOLD_RECORD_STRIPPED', ...req }}
          fields={[
            {
              key: 'strip_actual_at',
              label: 'Date it came down',
              kind: 'date',
              required: true,
              initial: booking.strip_planned_at ?? ''
            },
            { key: 'actual_cost', label: 'Final cost (£)', kind: 'number' },
            { key: 'invoice_reference', label: 'Scaffolder invoice reference' }
          ]}
          payload={(v) =>
            withId({
              strip_actual_at: v.strip_actual_at,
              actual_cost_pence: pence(v.actual_cost),
              invoice_reference: v.invoice_reference
            })
          }
        />
      )}
      {!['Draft', 'Planned', 'Cancelled', 'Stripped'].includes(s) && (
        <SimpleCommand
          label='Change dates'
          title='Change scaffold dates'
          description='The scaffolder is asked to confirm the new dates again.'
          request={{ command_type: 'SCAFFOLD_CHANGE_DATES', ...req }}
          fields={[
            ...(booking.erect_actual_at
              ? []
              : [
                  {
                    key: 'erect_planned_at',
                    label: 'New erect date',
                    kind: 'date' as const,
                    initial: booking.erect_planned_at ?? ''
                  }
                ]),
            ...(['StripAuthorised', 'StripPlanned', 'StripConfirmed'].includes(
              s
            )
              ? [
                  {
                    key: 'strip_planned_at',
                    label: 'New strip date',
                    kind: 'date' as const,
                    initial: booking.strip_planned_at ?? ''
                  }
                ]
              : []),
            { key: 'reason', label: 'Reason', kind: 'note', required: true }
          ]}
          payload={(v) =>
            withId({
              reason: v.reason,
              erect_planned_at:
                v.erect_planned_at !== booking.erect_planned_at
                  ? v.erect_planned_at
                  : undefined,
              strip_planned_at:
                v.strip_planned_at !== booking.strip_planned_at
                  ? v.strip_planned_at
                  : undefined
            })
          }
        />
      )}
      {!['Cancelled', 'Stripped'].includes(s) && (
        <SimpleCommand
          label='Complaint'
          title='Raise a complaint about the scaffold'
          description='An unsafe-concern complaint blocks the strip until resolved.'
          request={{ command_type: 'SCAFFOLD_COMPLAINT', ...req }}
          fields={[
            {
              key: 'category',
              label: 'Category',
              kind: 'select',
              required: true,
              initial: 'Other',
              options: [
                'MissedAppointment',
                'Access',
                'Damage',
                'UnsafeConcern',
                'Other'
              ].map((c) => ({
                value: c,
                label: c.replace(/([a-z])([A-Z])/g, '$1 $2')
              }))
            },
            {
              key: 'description',
              label: 'What happened',
              kind: 'note',
              required: true
            }
          ]}
          payload={(v) =>
            withId({ category: v.category, description: v.description })
          }
        />
      )}
      {!['Cancelled', 'Stripped'].includes(s) && !erectedNotStruck && (
        <SimpleCommand
          label='Cancel booking'
          variant='destructive'
          title='Cancel scaffold booking'
          request={{ command_type: 'SCAFFOLD_CANCEL', ...req }}
          fields={[
            { key: 'reason', label: 'Reason', kind: 'note', required: true }
          ]}
          payload={(v) => withId({ reason: v.reason })}
        />
      )}
    </div>
  );
}

/** SCAFFOLD_REQUEST for a job that needs scaffold and has no live booking. */
export function RequestScaffold({
  jobId,
  jobVersion,
  scaffolders
}: {
  jobId: string;
  jobVersion: number;
  scaffolders: { id: string; name: string }[];
}) {
  return (
    <SimpleCommand
      label='Request scaffold'
      icon={<IconPlus />}
      title='Request scaffold'
      description='Blank fields are filled from the booking form or the scaffolder’s lead time.'
      request={{
        command_type: 'SCAFFOLD_REQUEST',
        job_id: jobId,
        expected_version: jobVersion
      }}
      fields={[
        {
          key: 'company_id',
          label: 'Scaffolder',
          kind: 'select',
          options: scaffolders.map((c) => ({ value: c.id, label: c.name }))
        },
        { key: 'erect_planned_at', label: 'Erect date', kind: 'date' },
        {
          key: 'strip_forecast_at',
          label: 'Expected strip date',
          kind: 'date'
        },
        { key: 'access_notes', label: 'Access notes', kind: 'note' },
        { key: 'quoted_cost', label: 'Quoted cost (£)', kind: 'number' }
      ]}
      payload={(v) =>
        Object.fromEntries(
          Object.entries({
            company_id: v.company_id,
            erect_planned_at: v.erect_planned_at,
            strip_forecast_at: v.strip_forecast_at,
            access_notes: v.access_notes,
            quoted_cost_pence: pence(v.quoted_cost)
          }).filter(([, x]) => x !== undefined && x !== '')
        )
      }
    />
  );
}

export function ScaffoldHousekeeping() {
  return (
    <div className='flex flex-wrap gap-2'>
      <SimpleCommand
        label='Weekly lists'
        title='Record weekly scaffold lists'
        description='One list per scaffolder for the week, recorded for sending; nothing is emailed from here.'
        request={{ command_type: 'SCAFFOLD_WEEKLY_LIST' }}
        fields={[
          {
            key: 'week_start',
            label: 'Week starting',
            kind: 'date',
            hint: 'Blank means next week.'
          }
        ]}
      />
      <SimpleCommand
        label='Chase overdue'
        title='Create chase tasks'
        description='Creates a chase task for every booking whose planned erect or strip date has passed without confirmation.'
        request={{ command_type: 'SCAFFOLD_CHASE' }}
        payload={() => ({})}
      />
    </div>
  );
}

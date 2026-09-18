'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { OutcomeAlert } from '@/features/operations/command-dialog';
import {
  NoteField,
  SelectField,
  TextField
} from '@/features/operations/fields';
import { useCommand } from '@/features/operations/use-command';
import type { BookingFormRead } from '@/lib/backend/models';
import type { CommandResponse } from '@/lib/backend/types';
import { IconLoader2 } from '@tabler/icons-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { fieldLabel, reasonLabel } from '../labels';

type Values = Record<string, string>;

const NONE = '__none__';

function initialValues(data: BookingFormRead): Values {
  const c = data.customer;
  const s = data.current.schedule;
  const t = data.current.technical;
  const member = (trade: string, role: string) =>
    s.team.find((m) => m.trade === trade && m.role === role)?.person_id ?? '';
  return {
    customer_first_name: c.first_name ?? '',
    customer_last_name: c.last_name ?? '',
    street_address: c.street_address ?? '',
    city: c.city ?? '',
    postcode: c.postcode ?? '',
    phone: c.phone ?? '',
    email: c.email ?? '',
    date_roofer: s.roof_date ?? '',
    date_sparky: s.electrical_date ?? '',
    date_scaffold:
      s.scaffold_date ?? data.current.scaffold?.erect_planned_at ?? '',
    roofer: member('Roof', 'Lead'),
    sparky: member('Electrical', 'Lead'),
    second_sparky: member('Electrical', 'Second'),
    scaffold_company: data.current.scaffold?.company_id ?? '',
    scaffold_notes: data.current.scaffold?.access_notes ?? '',
    merchant_name: data.current.merchant?.id ?? '',
    solar_kw: t?.solar_kw != null ? String(t.solar_kw) : '',
    annual_generation:
      t?.annual_generation != null ? String(t.annual_generation) : '',
    roofing_notes: t?.roofing_notes ?? '',
    electrical_notes: t?.electrical_notes ?? '',
    roof_hooks_type: t?.roof_hooks_type ?? ''
  };
}

const MATERIAL_GROUPS: { title: string; match: (key: string) => boolean }[] = [
  { title: 'Panels', match: (k) => k.startsWith('mat_panel') },
  {
    title: 'Renusol roof hooks & rail',
    match: (k) =>
      /slate|concrete|l_bracket|hook_rest|end_c|mid_clamps|mat_rail|mat_splice/.test(
        k
      )
  },
  {
    title: 'K2 system',
    match: (k) => k.startsWith('mat_k2') || k === 'mat_genius'
  },
  {
    title: 'Electrical',
    match: (k) => /optimisers|fox_jb|dongle|gateway|mat_ev/.test(k)
  },
  { title: 'Other', match: () => true }
];

export function BookingForm({ data }: { data: BookingFormRead }) {
  const [values, setValues] = useState<Values>(() => initialValues(data));
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const { run, pending, outcome } = useCommand();
  const set = (key: string) => (v: string) =>
    setValues((prev) => ({ ...prev, [key]: v === NONE ? '' : v }));
  const flag = data.commands.booking_intake;

  const installerOptions = useMemo(
    () => [
      { value: NONE, label: 'Not set' },
      ...data.options.installers.map((i) => ({ value: i.id, label: i.name }))
    ],
    [data.options.installers]
  );
  const groups = useMemo(() => {
    const inputs = data.materials.filter((m) => !m.derived_total);
    const used = new Set<string>();
    return MATERIAL_GROUPS.map((g) => {
      const items = inputs.filter((m) => !used.has(m.key) && g.match(m.key));
      items.forEach((m) => used.add(m.key));
      return { title: g.title, items };
    }).filter((g) => g.items.length > 0);
  }, [data.materials]);

  function submit() {
    // Only what was filled in; the server compares, resolves and validates.
    const payload = Object.fromEntries(
      Object.entries(values)
        .map(([k, v]) => [k, v.trim()])
        .filter(([, v]) => v !== '')
    );
    run(
      {
        command_type: 'BOOKING_INTAKE',
        job_id: data.job.id,
        expected_version: data.job.version,
        payload
      },
      (r: CommandResponse) => {
        if (r.ok) {
          setResult(r.result);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }
    );
  }

  if (result) return <BookingResult jobId={data.job.id} result={result} />;

  return (
    <form
      className='flex flex-col gap-4'
      onSubmit={(e) => {
        e.preventDefault();
        if (!pending && flag.available) submit();
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle className='text-base'>Customer</CardTitle>
          <CardDescription>
            Pre-filled from the sale. A change is never applied directly: it is
            sent to Intake Review.
          </CardDescription>
        </CardHeader>
        <CardContent className='grid gap-3 sm:grid-cols-2'>
          <TextField
            label='First name'
            value={values.customer_first_name}
            onChange={set('customer_first_name')}
          />
          <TextField
            label='Last name'
            value={values.customer_last_name}
            onChange={set('customer_last_name')}
          />
          <TextField
            label='Street address'
            value={values.street_address}
            onChange={set('street_address')}
          />
          <TextField label='Town' value={values.city} onChange={set('city')} />
          <TextField
            label='Postcode'
            value={values.postcode}
            onChange={set('postcode')}
          />
          <TextField
            label='Phone'
            value={values.phone}
            onChange={set('phone')}
          />
          <TextField
            label='Email'
            value={values.email}
            onChange={set('email')}
          />
          <TextField
            label='Price on the booking (£)'
            inputMode='decimal'
            value={values.cost ?? ''}
            onChange={set('cost')}
            hint='Leave blank unless it differs from the contract value; a difference goes to review.'
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>Dates & team</CardTitle>
          <CardDescription>
            Payment route: {data.job.finance_route} (set at sale; cannot be
            changed here).
          </CardDescription>
        </CardHeader>
        <CardContent className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
          <TextField
            label='Roof date'
            type='date'
            value={values.date_roofer}
            onChange={set('date_roofer')}
          />
          <SelectField
            label='Roofer'
            value={values.roofer || NONE}
            onChange={set('roofer')}
            options={installerOptions}
          />
          <div className='hidden lg:block' />
          <TextField
            label='Electrical date'
            type='date'
            value={values.date_sparky}
            onChange={set('date_sparky')}
          />
          <SelectField
            label='Electrician'
            value={values.sparky || NONE}
            onChange={set('sparky')}
            options={installerOptions}
          />
          <SelectField
            label='Second electrician'
            value={values.second_sparky || NONE}
            onChange={set('second_sparky')}
            options={installerOptions}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>Scaffold</CardTitle>
          {!data.job.scaffold_required && (
            <CardDescription>
              This job was sold without scaffold. Scaffold details will send it
              to review.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className='grid gap-3 sm:grid-cols-2'>
          <TextField
            label='Scaffold erect date'
            type='date'
            value={values.date_scaffold}
            onChange={set('date_scaffold')}
          />
          <SelectField
            label='Scaffolder'
            value={values.scaffold_company || NONE}
            onChange={set('scaffold_company')}
            options={[
              { value: NONE, label: 'Not set' },
              ...data.options.scaffolders.map((c) => ({
                value: c.id,
                label: c.name
              }))
            ]}
          />
          <div className='sm:col-span-2'>
            <NoteField
              label='Scaffold access notes'
              value={values.scaffold_notes}
              onChange={set('scaffold_notes')}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>System</CardTitle>
        </CardHeader>
        <CardContent className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
          <TextField
            label='System size (kW)'
            inputMode='decimal'
            value={values.solar_kw}
            onChange={set('solar_kw')}
          />
          <TextField
            label='Annual generation (kWh)'
            inputMode='decimal'
            value={values.annual_generation}
            onChange={set('annual_generation')}
          />
          <TextField
            label='Roof hooks type'
            value={values.roof_hooks_type}
            onChange={set('roof_hooks_type')}
          />
          <TextField
            label='Inverter'
            value={values.inverter ?? ''}
            onChange={set('inverter')}
          />
          <TextField
            label='Battery'
            value={values.battery ?? ''}
            onChange={set('battery')}
          />
          <TextField
            label='Battery quantity'
            inputMode='decimal'
            value={values.battery_qty ?? ''}
            onChange={set('battery_qty')}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>Materials</CardTitle>
          <CardDescription>
            Quantities to order. Renusol hook totals are worked out from the
            portrait and landscape counts.
          </CardDescription>
        </CardHeader>
        <CardContent className='flex flex-col gap-4'>
          <SelectField
            label='Merchant'
            value={values.merchant_name || NONE}
            onChange={set('merchant_name')}
            options={[
              { value: NONE, label: 'Not set' },
              ...data.options.merchants.map((c) => ({
                value: c.id,
                label: c.name
              }))
            ]}
          />
          {groups.map((g) => (
            <fieldset key={g.title} className='flex flex-col gap-2'>
              <legend className='text-sm font-semibold'>{g.title}</legend>
              <div className='grid gap-2 sm:grid-cols-2 lg:grid-cols-3'>
                {g.items.map((m) => (
                  <QuantityField
                    key={m.key}
                    label={m.description}
                    unit={m.unit}
                    value={values[m.key] ?? ''}
                    onChange={set(m.key)}
                  />
                ))}
              </div>
            </fieldset>
          ))}
          <div className='grid gap-3 sm:grid-cols-3'>
            <TextField
              label='Extras'
              value={values.extras ?? ''}
              onChange={set('extras')}
            />
            <TextField
              label='SIG extras'
              value={values.sig_extras ?? ''}
              onChange={set('sig_extras')}
            />
            <TextField
              label='Tesla extras'
              value={values.tesla_extras ?? ''}
              onChange={set('tesla_extras')}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>Notes</CardTitle>
        </CardHeader>
        <CardContent className='grid gap-3 md:grid-cols-3'>
          <NoteField
            label='Roofing notes'
            value={values.roofing_notes}
            onChange={set('roofing_notes')}
          />
          <NoteField
            label='Electrical notes'
            value={values.electrical_notes}
            onChange={set('electrical_notes')}
          />
          <NoteField
            label='Ordering notes'
            value={values.ordering_notes ?? ''}
            onChange={set('ordering_notes')}
          />
        </CardContent>
      </Card>

      {outcome && <OutcomeAlert outcome={outcome} />}
      <div className='bg-background/95 sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t px-4 py-3 backdrop-blur md:mx-0 md:rounded-lg md:border'>
        <Button asChild variant='outline'>
          <Link href={`/dashboard/jobs/${data.job.id}`}>Cancel</Link>
        </Button>
        <Button type='submit' disabled={pending || !flag.available}>
          {pending && <IconLoader2 className='size-4 animate-spin' />}
          {data.job.booking_submitted ? 'Update booking' : 'Submit booking'}
        </Button>
      </div>
    </form>
  );
}

function QuantityField({
  label,
  unit,
  value,
  onChange
}: {
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = `qty-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className='flex items-center justify-between gap-2 rounded-md border px-2 py-1.5'>
      <Label htmlFor={id} className='text-xs leading-snug font-normal'>
        {label}
      </Label>
      <div className='flex shrink-0 items-center gap-1'>
        <Input
          id={id}
          className='h-8 w-20 text-right tabular-nums'
          inputMode='numeric'
          pattern='[0-9]*'
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ''))}
        />
        <span className='text-muted-foreground w-5 text-xs'>{unit}</span>
      </div>
    </div>
  );
}

/** What BOOKING_INTAKE did - the old "booking result" screen. */
function BookingResult({
  jobId,
  result
}: {
  jobId: string;
  result: Record<string, unknown>;
}) {
  const status = String(result.status ?? '');
  const reasons = (result.review_reasons as string[] | undefined) ?? [];
  const changes =
    (result.customer_changes as {
      field_name: string;
      previous_value: string | null;
      incoming_value: string;
    }[]) ?? [];
  const mapping =
    (result.mapping_requirements as {
      key: string;
      description?: string;
      value?: string;
    }[]) ?? [];
  const created = ((result.booking_tasks as { created?: string[] } | null)
    ?.created ?? []) as string[];
  const review = status === 'Review';
  return (
    <div className='flex flex-col gap-4'>
      <Alert variant={review ? 'default' : undefined}>
        <AlertTitle>
          {review ? 'Booking saved – needs Intake Review' : 'Booking saved'}
        </AlertTitle>
        <AlertDescription>
          {String(result.message ?? '')} Job is now{' '}
          {String(result.workflow_stage ?? '')}.
        </AlertDescription>
      </Alert>
      {reasons.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Why it needs review</CardTitle>
          </CardHeader>
          <CardContent className='flex flex-wrap gap-1.5'>
            {reasons.map((r) => (
              <Badge key={r} variant='warning'>
                {reasonLabel(r)}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}
      {changes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>
              Customer changes proposed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className='flex flex-col gap-1 text-sm'>
              {changes.map((c) => (
                <li key={c.field_name}>
                  <span className='font-medium'>
                    {fieldLabel(c.field_name)}:
                  </span>{' '}
                  {c.previous_value ?? '—'} → {c.incoming_value}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      {mapping.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>
              Products needing mapping
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className='text-muted-foreground list-disc pl-5 text-sm'>
              {mapping.map((m) => (
                <li key={m.key}>{m.description ?? m.value ?? m.key}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      {created.length > 0 && (
        <p className='text-muted-foreground text-sm'>
          Booking tasks created: {created.join(', ')}.
        </p>
      )}
      <div className='flex flex-wrap gap-2'>
        <Button asChild>
          <Link href={`/dashboard/jobs/${jobId}`}>Open the job</Link>
        </Button>
        <Button asChild variant='outline'>
          <Link href='/dashboard/booking?view=in_progress'>
            Back to booking
          </Link>
        </Button>
      </div>
    </div>
  );
}

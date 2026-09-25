'use client';

import { Button } from '@/components/ui/button';
import {
  FormRenderer,
  type FieldControlProps
} from '@/features/forms/components/form-renderer';
import type { AnswerValue, FormDefinition } from '@/features/forms/definition';
import { cn } from '@/lib/utils';
import {
  IconAlertTriangle,
  IconCheck,
  IconInfoCircle,
  IconLoader2
} from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { signalBandsSentence } from '../labels';
import { compareSerials } from '../serial';
import { startVisitAction, submitVisitAction } from '../server/actions';
import type { ProgrammeProperty, SignalConfig } from '../types';
import { VisitPhotoField } from './photo-field';
import { PropertyLookupField } from './property-lookup';

/**
 * The installer's field workflow.
 *
 * It is the EXISTING Form Builder renderer, with the two controls a signed-in
 * field workflow needs injected into it - the photo control and the property
 * lookup. There is no PCH form component: which question is the property, and
 * which photo question collects which kind of evidence, comes from the
 * programme's field map, which the server hands down with the definition.
 *
 * The sequence, and why:
 *
 *   1. the person picks a property;
 *   2. picking one STARTS a draft visit (PROGRAMME_VISIT_START). A draft is on no
 *      board and in no count. It exists so the photographs taken next have
 *      something to belong to, and so the server can check that each one is this
 *      person's own registration for this visit;
 *   3. each photograph uploads as it is taken, not at submit time. On a doorstep
 *      the upload is the slow part, and a failed submit must not lose photos;
 *   4. submitting sends the answers. The server validates them against the form
 *      revision, derives every canonical value, re-applies the outcome's own
 *      requirements, and puts the visit in Awaiting review.
 *
 * Nothing here computes an outcome, a classification or a disposition. The
 * conditional questions are the form's; the RULES are the server's, and it
 * applies them again to whatever arrives.
 */

interface FieldMap {
  property?: string | string[];
  /** The question whose answer becomes programme_visits.actual_meter_serial. */
  actual_meter_serial?: string | string[];
  meter_reading?: string | string[];
  csq?: string | string[];
  evidence?: Record<string, string[] | string>;
}

export interface VisitFormProps {
  programmeId: string;
  form: {
    formId: string;
    revisionId: string;
    revision: number;
    title: string;
    description: string | null;
    definition: FormDefinition;
    signalConfig: SignalConfig;
  };
  fieldMap: FieldMap;
  /** Pre-chosen when the person came from the property list. */
  property?: ProgrammeProperty | null;
  /** Where to go once the visit is recorded: the next property. */
  doneHref: string;
  /**
   * The way out, for someone who has finished for the day. The programmes list
   * rather than this programme's overview: the overview is office reporting,
   * and a field account is not guaranteed to be able to open it.
   */
  exitHref: string;
}

/** Which evidence category a photo question collects, from the field map. */
function categoryOf(fieldMap: FieldMap, fieldId: string): string {
  for (const [category, spec] of Object.entries(fieldMap.evidence ?? {})) {
    const ids = Array.isArray(spec) ? spec : [spec];
    if (ids.includes(fieldId)) return category;
  }
  return 'ProgrammeOther';
}

const first = (spec: string | string[] | undefined) =>
  Array.isArray(spec) ? spec[0] : spec;

export function VisitForm({
  programmeId,
  form,
  fieldMap,
  property = null,
  doneHref,
  exitHref
}: VisitFormProps) {
  const propertyFieldId = first(fieldMap.property);
  const serialFieldId = first(fieldMap.actual_meter_serial);
  const readingFieldId = first(fieldMap.meter_reading);
  const csqFieldId = first(fieldMap.csq);

  const [visitId, setVisitId] = useState<string | null>(null);
  // The version the server reports for the draft, so the submit's optimistic
  // concurrency check uses what the database has rather than an assumption.
  const [visitVersion, setVisitVersion] = useState(1);
  const [picked, setPicked] = useState<ProgrammeProperty | null>(property);
  const [starting, setStarting] = useState(false);
  const [startProblem, setStartProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // One command id per attempt, kept until it succeeds, so a retry after a lost
  // response is replayed by the server rather than recorded twice.
  const submitCommandId = useRef(crypto.randomUUID());
  const startCommandId = useRef(crypto.randomUUID());

  /**
   * Opens the draft. Called as soon as a property is chosen, because the photo
   * control needs a visit to upload against.
   */
  const start = useCallback(
    async (chosen: ProgrammeProperty) => {
      setStartProblem(null);
      setStarting(true);
      const id = crypto.randomUUID();
      const response = await startVisitAction(
        { visitId: id, programmeId, propertyId: chosen.id },
        startCommandId.current
      );
      setStarting(false);
      if (!response.ok) {
        setStartProblem(response.outcome.message);
        setPicked(null);
        // A refusal wrote nothing, so the next attempt is a new visit.
        startCommandId.current = crypto.randomUUID();
        return;
      }
      setVisitId(id);
      const result = response.result as { visit_id?: string; version?: number };
      // A replay returns the draft that already exists, which may not be `id`.
      if (result.visit_id) setVisitId(result.visit_id);
      if (typeof result.version === 'number') setVisitVersion(result.version);
    },
    [programmeId]
  );

  const onPick = useCallback(
    (chosen: ProgrammeProperty | null) => {
      setPicked(chosen);
      if (chosen && !visitId) void start(chosen);
    },
    [start, visitId]
  );

  // A property handed down by the server (the person arrived from the property
  // list): open the draft straight away, so the camera is usable immediately.
  // In an effect, because starting a visit is a write, not part of rendering.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!property || autoStarted.current) return;
    autoStarted.current = true;
    // `start` sets its own pending state before awaiting, which is a setState in
    // an effect. It is unavoidable here: the draft has to be opened on arrival
    // (the camera is useless until it exists) and there is no user event to hang
    // it on when the property came from the property list.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
    void start(property);
  }, [property, start]);

  const lookupControl = useCallback(
    (props: FieldControlProps<string | undefined>) => (
      <PropertyLookupField
        {...props}
        programmeId={programmeId}
        initial={picked}
        locked={!!visitId}
        onPick={onPick}
      />
    ),
    [programmeId, picked, visitId, onPick]
  );

  const photoControl = useCallback(
    (props: FieldControlProps<string[]>) => (
      <VisitPhotoField
        {...props}
        visitId={visitId}
        category={categoryOf(fieldMap, props.field.id)}
      />
    ),
    [visitId, fieldMap]
  );

  // The expected serial is known before the installer types the actual one, so
  // it is put beside that question rather than left at the top of the form.
  const fieldAppendix = useCallback(
    (field: { id: string }, value: AnswerValue | undefined) =>
      field.id === serialFieldId ? (
        <MeterSerialCheck
          expected={picked?.expectedMeterSerial ?? null}
          actual={typeof value === 'string' ? value : ''}
        />
      ) : null,
    [serialFieldId, picked]
  );

  const submit = useCallback(
    async (answers: Record<string, AnswerValue>) => {
      if (!visitId)
        return {
          ok: false as const,
          message: 'Choose the property first.',
          field: propertyFieldId
        };
      const response = await submitVisitAction(
        {
          visitId,
          programmeId,
          formId: form.formId,
          revisionId: form.revisionId,
          submissionId: crypto.randomUUID(),
          expectedVersion: visitVersion,
          answers
        },
        submitCommandId.current
      );
      if (response.ok) {
        // Deliberately no redirect: the person is told what has happened to the
        // visit and chooses what to do next. Navigating for them hid the fact
        // that the visit is only AWAITING review, and left someone who had
        // finished for the day on the property list with nothing to do.
        setSaved(true);
        return { ok: true as const };
      }
      // A refusal wrote nothing. Keep the visit and its photographs; a new
      // command id, because the refused one is spent for a changed payload.
      submitCommandId.current = crypto.randomUUID();
      return { ok: false as const, message: response.outcome.message };
    },
    [visitId, visitVersion, programmeId, form, propertyFieldId]
  );

  if (saved) return <VisitRecorded doneHref={doneHref} exitHref={exitHref} />;

  return (
    <div className='flex flex-col gap-4'>
      {startProblem && (
        <p
          role='alert'
          className='bg-destructive-soft text-destructive rounded-lg px-3 py-2 text-sm font-medium'
        >
          {startProblem}
        </p>
      )}
      {starting && (
        <p className='text-muted-foreground flex items-center gap-2 text-sm'>
          <IconLoader2 aria-hidden className='size-4 animate-spin' />
          Starting the visit…
        </p>
      )}

      <FormRenderer
        title={form.title}
        description={form.description}
        definition={form.definition}
        mode='live'
        onSubmit={submit}
        photoControl={photoControl}
        lookupControl={lookupControl}
        fieldAppendix={fieldAppendix}
        // The reading is numeric(14,3), so it keeps a decimal keypad; CSQ is a
        // whole number between 0 and 31 and gets the digits-only one.
        numberInputModes={{
          ...(readingFieldId ? { [readingFieldId]: 'decimal' as const } : {}),
          ...(csqFieldId ? { [csqFieldId]: 'numeric' as const } : {})
        }}
        stickySubmit
        // Kept per visit form version, so a republished form never restores
        // answers keyed by questions that no longer exist.
        draftKey={`programme-visit:${programmeId}:${form.revisionId}`}
        footer={
          <div
            className={cn(
              'bg-muted/50 text-muted-foreground rounded-lg px-3 py-2 text-xs'
            )}
          >
            <p>{signalBandsSentence(form.signalConfig)}</p>
            <p className='mt-1'>
              A good CSQ is not the same as a working meter — the office checks
              the PCH portal before a property is finished.
            </p>
            <p className='mt-1'>Form version {form.revision}.</p>
          </div>
        }
      />
    </div>
  );
}

/**
 * The expected serial, beside the question that asks for the actual one.
 *
 * Advisory only, and it says so. The server decides meter_serial_matches when
 * the visit is submitted and the office reviews every mismatch, so this must
 * never read as a verdict - a screen that said "mismatch" as though it were the
 * finding would invite someone to change what they read off the meter to make
 * the screen agree, which is the opposite of what the evidence is for.
 */
export function MeterSerialCheck({
  expected,
  actual
}: {
  expected: string | null;
  actual: string;
}) {
  const state = compareSerials(expected, actual);
  const base = 'flex items-start gap-2 rounded-lg px-3 py-2 text-sm';

  if (state === 'no-expected')
    return (
      <p className={cn(base, 'bg-muted/60 text-muted-foreground')}>
        <IconInfoCircle aria-hidden className='mt-0.5 size-4 shrink-0' />
        <span>
          No expected serial was given for this property, so there is nothing to
          check it against here. Record what is on the meter; the office checks
          it on review.
        </span>
      </p>
    );

  if (state === 'not-typed')
    return (
      <p className={cn(base, 'bg-info-soft text-info')}>
        <IconInfoCircle aria-hidden className='mt-0.5 size-4 shrink-0' />
        <span>
          Expected serial{' '}
          <strong className='font-semibold break-all'>{expected}</strong>. Read
          the serial from the meter itself, even if it differs from this.
        </span>
      </p>
    );

  if (state === 'match')
    return (
      <p className={cn(base, 'bg-success-soft text-success')} role='status'>
        <IconCheck aria-hidden className='mt-0.5 size-4 shrink-0' />
        <span>
          Same as the expected serial. The office still confirms this on review.
        </span>
      </p>
    );

  return (
    <p
      className={cn(base, 'bg-destructive-soft text-destructive')}
      role='status'
    >
      <IconAlertTriangle aria-hidden className='mt-0.5 size-4 shrink-0' />
      <span>
        This is not the serial expected here, which is{' '}
        <strong className='font-semibold break-all'>{expected}</strong>. Check
        you are at the right meter. If the meter really does read differently,
        send what you read - the office reviews every mismatch.
      </span>
    </p>
  );
}

/**
 * What a recorded visit ends on. Two ways forward, because a round ends in one
 * of exactly two ways: the next property, or finished for now. The wording
 * stays honest about the visit being with the office rather than done.
 */
export function VisitRecorded({
  doneHref,
  exitHref
}: {
  doneHref: string;
  exitHref: string;
}) {
  return (
    <div className='flex flex-col items-center gap-3 py-10 text-center'>
      <IconCheck aria-hidden className='text-success size-10' />
      <p className='text-lg font-semibold'>Visit recorded</p>
      <p className='text-muted-foreground text-sm'>
        It is now with the office for review.
      </p>
      <div className='flex w-full max-w-xs flex-col gap-2 pt-2'>
        {/* Plain links, not router pushes: a full load starts the next visit
            from a clean form rather than reusing this one's state. */}
        <Button asChild className='h-12 w-full'>
          <a href={doneHref}>Record the next property</a>
        </Button>
        <Button asChild variant='outline' className='h-12 w-full'>
          <a href={exitHref}>Finish for now</a>
        </Button>
      </div>
    </div>
  );
}

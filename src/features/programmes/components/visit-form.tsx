'use client';

import { Button } from '@/components/ui/button';
import {
  FormRenderer,
  type FieldControlProps
} from '@/features/forms/components/form-renderer';
import type { AnswerValue, FormDefinition } from '@/features/forms/definition';
import { cn } from '@/lib/utils';
import { IconCheck, IconLoader2 } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { signalBandsSentence } from '../labels';
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
  /** Where to go once the visit is recorded. */
  doneHref: string;
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
  doneHref
}: VisitFormProps) {
  const router = useRouter();
  const propertyFieldId = first(fieldMap.property);

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
        setSaved(true);
        router.push(doneHref);
        return { ok: true as const };
      }
      // A refusal wrote nothing. Keep the visit and its photographs; a new
      // command id, because the refused one is spent for a changed payload.
      submitCommandId.current = crypto.randomUUID();
      return { ok: false as const, message: response.outcome.message };
    },
    [
      visitId,
      visitVersion,
      programmeId,
      form,
      propertyFieldId,
      router,
      doneHref
    ]
  );

  if (saved)
    return (
      <div className='flex flex-col items-center gap-3 py-10 text-center'>
        <IconCheck aria-hidden className='text-success size-10' />
        <p className='text-lg font-semibold'>Visit recorded</p>
        <p className='text-muted-foreground text-sm'>
          It is now with the office for review.
        </p>
        <Button asChild className='h-12'>
          <a href={doneHref}>Record another visit</a>
        </Button>
      </div>
    );

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

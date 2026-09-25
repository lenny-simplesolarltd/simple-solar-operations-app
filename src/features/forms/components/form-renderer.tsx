'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { IconLoader2 } from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  checkAnswers,
  isInputType,
  visibleFieldIds,
  type Answers,
  type AnswerValue,
  type FormDefinition,
  type FormField
} from '../definition';

/**
 * The controls for the two field types that need an authenticated actor, and
 * so cannot be part of the recipient-link renderer: a photo question needs
 * somewhere to upload to, a lookup question needs something to search.
 *
 * They are injected rather than built in, so Forms stays free of any knowledge
 * of what is being recorded. A caller that does not supply one gets a visible
 * refusal rather than a question that silently accepts nothing.
 */
export interface FieldControlProps<T> {
  field: FormField;
  value: T;
  onChange(value: T | undefined): void;
  /** Wire these to the control so the label, help and error stay connected. */
  inputId: string;
  describedBy?: string;
  invalid: boolean;
}

export interface FormRendererProps {
  title: string;
  description?: string | null;
  definition: FormDefinition;
  /** 'preview' never submits anything. */
  mode: 'preview' | 'live';
  onSubmit?: (
    answers: Record<string, AnswerValue>
  ) => Promise<{ ok: true } | { ok: false; message: string; field?: string }>;
  /** Renders a 'photo' question. Its value is a list of evidence ids. */
  photoControl?: (props: FieldControlProps<string[]>) => React.ReactNode;
  /** Renders an 'entity' question. Its value is one record id. */
  lookupControl?: (
    props: FieldControlProps<string | undefined>
  ) => React.ReactNode;
  /**
   * When set, answers are kept in this browser under this key and restored on
   * reload, so a field worker who loses signal, locks the phone or follows a
   * camera prompt does not lose what they have typed. Cleared once the form is
   * accepted. Never a substitute for the server's record.
   */
  draftKey?: string;
  /** Extra content above the submit button (e.g. a summary of what will be sent). */
  footer?: React.ReactNode;
}

/** Answers kept in this browser only. Failures are ignored: a draft is a convenience. */
function readDraft(key: string): Answers | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Answers) : null;
  } catch {
    return null;
  }
}

/**
 * What a recipient sees. Staff Preview renders exactly this component with
 * `mode="preview"`, so the preview is the real form, minus submission.
 */
export function FormRenderer({
  title,
  description,
  definition,
  mode,
  onSubmit,
  photoControl,
  lookupControl,
  draftKey,
  footer
}: FormRendererProps) {
  const [answers, setAnswers] = useState<Answers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'sending' | 'previewed'>('idle');
  const [restored, setRestored] = useState(false);
  // Restored once, after mount: localStorage does not exist on the server, and
  // reading it during render would make the first paint differ from the HTML.
  const loaded = useRef(false);
  useEffect(() => {
    if (!draftKey || loaded.current) return;
    loaded.current = true;
    const draft = readDraft(draftKey);
    if (draft && Object.keys(draft).length) {
      // Deliberately a mount-time setState in an effect, and it cannot be a lazy
      // initialiser: localStorage does not exist while this renders on the
      // server, so reading it there would make the first client render disagree
      // with the HTML. One extra render on mount is the correct trade for not
      // losing a field worker's unsent answers.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
      setAnswers(draft);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
      setRestored(true);
    }
  }, [draftKey]);
  useEffect(() => {
    if (!draftKey || !loaded.current) return;
    try {
      if (Object.keys(answers).length)
        window.localStorage.setItem(draftKey, JSON.stringify(answers));
      else window.localStorage.removeItem(draftKey);
    } catch {
      // A full or blocked store must not stop someone recording a visit.
    }
  }, [draftKey, answers]);
  const clearDraft = useCallback(() => {
    if (!draftKey) return;
    try {
      window.localStorage.removeItem(draftKey);
    } catch {
      /* nothing to clear */
    }
  }, [draftKey]);
  const visible = useMemo(
    () => visibleFieldIds(definition, answers),
    [definition, answers]
  );
  // Questions are numbered as shown: hidden ones do not leave gaps.
  const numbers = useMemo(() => {
    const map = new Map<string, number>();
    definition.fields
      .filter((f) => visible.has(f.id) && isInputType(f.type))
      .forEach((f, i) => map.set(f.id, i + 1));
    return map;
  }, [definition, visible]);

  const set = (id: string, value: AnswerValue | undefined) => {
    setAnswers((a) => ({ ...a, [id]: value }));
    if (errors[id]) setErrors((e) => ({ ...e, [id]: '' }));
  };

  const submit = async () => {
    setFormError(null);
    const checked = checkAnswers(definition, answers);
    const problems = Object.entries(checked.errors).filter(([, m]) => m);
    if (problems.length) {
      setErrors(checked.errors);
      setFormError('Please check the highlighted answers.');
      document.getElementById(`field-${problems[0][0]}`)?.focus();
      return;
    }
    if (mode === 'preview' || !onSubmit) {
      setState('previewed');
      return;
    }
    setState('sending');
    const result = await onSubmit(checked.clean);
    setState('idle');
    if (result.ok) {
      clearDraft();
      return;
    }
    if (!result.ok) {
      setFormError(result.message);
      if (result.field)
        setErrors((e) => ({ ...e, [result.field!]: result.message }));
    }
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className='flex flex-col gap-6'
    >
      <header className='flex flex-col gap-2'>
        <h1 className='text-2xl font-bold tracking-tight'>{title}</h1>
        {description && (
          <p className='text-muted-foreground text-sm whitespace-pre-wrap'>
            {description}
          </p>
        )}
        {definition.fields.some((f) => f.required) && (
          <p className='text-muted-foreground text-xs'>
            Questions marked{' '}
            <span aria-hidden className='text-destructive'>
              *
            </span>
            <span className='sr-only'>with an asterisk</span> are required.
          </p>
        )}
      </header>

      {definition.fields.map((field) => {
        if (!visible.has(field.id)) return null;
        return (
          <FieldView
            key={field.id}
            field={field}
            number={numbers.get(field.id) ?? null}
            value={answers[field.id]}
            error={errors[field.id]}
            onChange={(v) => set(field.id, v)}
            photoControl={photoControl}
            lookupControl={lookupControl}
          />
        );
      })}

      {restored && state === 'idle' && (
        <p
          role='status'
          className='bg-info-soft text-info rounded-lg px-3 py-2 text-sm'
        >
          Your unsent answers were restored on this device.
        </p>
      )}
      {footer}
      {formError && (
        <p
          role='alert'
          className='bg-destructive-soft text-destructive rounded-lg px-3 py-2 text-sm'
        >
          {formError}
        </p>
      )}
      {state === 'previewed' && (
        <p
          role='status'
          className='bg-info-soft text-info rounded-lg px-3 py-2 text-sm'
        >
          Preview only: these answers are valid, and nothing was sent.
        </p>
      )}
      <div>
        <Button
          type='submit'
          size='lg'
          disabled={state === 'sending'}
          className='w-full sm:w-auto'
        >
          {state === 'sending' && (
            <IconLoader2 aria-hidden className='animate-spin' />
          )}
          {mode === 'preview' ? 'Check answers (preview)' : 'Submit'}
        </Button>
      </div>
    </form>
  );
}

function FieldView({
  field,
  number,
  value,
  error,
  onChange,
  photoControl,
  lookupControl
}: {
  field: FormField;
  number: number | null;
  value: AnswerValue | undefined;
  error?: string;
  onChange(value: AnswerValue | undefined): void;
  photoControl?: FormRendererProps['photoControl'];
  lookupControl?: FormRendererProps['lookupControl'];
}) {
  const id = `field-${field.id}`;
  const helpId = field.help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined;

  if (field.type === 'section') {
    return (
      <div className='border-t pt-5'>
        <h2 className='text-lg font-semibold'>{field.label}</h2>
        {field.help && (
          <p className='text-muted-foreground mt-1 text-sm whitespace-pre-wrap'>
            {field.help}
          </p>
        )}
      </div>
    );
  }
  if (field.type === 'info') {
    return (
      <div className='bg-muted/60 rounded-lg px-4 py-3 text-sm'>
        <p className='font-medium'>{field.label}</p>
        {field.help && (
          <p className='text-muted-foreground mt-1 whitespace-pre-wrap'>
            {field.help}
          </p>
        )}
      </div>
    );
  }

  const label = (
    <>
      {number !== null && (
        <span className='text-muted-foreground mr-1.5 tabular-nums'>
          {number}.
        </span>
      )}
      {field.label}
      {field.required && (
        <>
          <span aria-hidden className='text-destructive ml-0.5'>
            *
          </span>
          <span className='sr-only'> (required)</span>
        </>
      )}
    </>
  );
  const help = field.help && (
    <p
      id={helpId}
      className='text-muted-foreground text-sm whitespace-pre-wrap'
    >
      {field.help}
    </p>
  );
  const errorText = error && (
    <p id={errorId} className='text-destructive text-sm font-medium'>
      {error}
    </p>
  );
  const common = {
    'aria-invalid': !!error || undefined,
    'aria-describedby': describedBy,
    'aria-required': field.required || undefined
  };
  const text = typeof value === 'string' ? value : '';

  // The two types that need an authenticated actor. A caller that did not
  // supply the control says so out loud rather than showing a dead question.
  if (field.type === 'photo' || field.type === 'entity') {
    const render = field.type === 'photo' ? photoControl : lookupControl;
    const common = { field, inputId: id, describedBy, invalid: !!error };
    return (
      <div className='flex flex-col gap-2'>
        <label htmlFor={id} className='text-sm font-medium'>
          {label}
        </label>
        {help}
        {render ? (
          field.type === 'photo' ? (
            photoControl!({
              ...common,
              value: Array.isArray(value) ? (value as string[]) : [],
              onChange: (v) => onChange(v && v.length ? v : undefined)
            })
          ) : (
            lookupControl!({
              ...common,
              value: typeof value === 'string' ? value : undefined,
              onChange: (v) => onChange(v)
            })
          )
        ) : (
          <p className='bg-muted/60 text-muted-foreground rounded-lg px-3 py-2 text-sm'>
            This question can only be answered in the app.
          </p>
        )}
        {errorText}
      </div>
    );
  }

  const grouped = [
    'yes_no',
    'single_choice',
    'multiple_choice',
    'scale',
    'address',
    'confirmation'
  ].includes(field.type);
  if (grouped) {
    return (
      <fieldset
        className='flex flex-col gap-2'
        aria-describedby={describedBy}
        aria-invalid={!!error || undefined}
      >
        <legend className='mb-1 text-sm font-medium'>{label}</legend>
        {help}
        {field.type === 'yes_no' && (
          <ChoiceButtons
            name={id}
            focusId={id}
            options={[
              { id: 'yes', label: 'Yes', value: true },
              { id: 'no', label: 'No', value: false }
            ]}
            value={value}
            onChange={onChange}
          />
        )}
        {field.type === 'scale' && (
          <ChoiceButtons
            name={id}
            focusId={id}
            dense
            options={Array.from(
              { length: (field.max ?? 10) - (field.min ?? 1) + 1 },
              (_, i) => {
                const n = (field.min ?? 1) + i;
                return { id: String(n), label: String(n), value: n };
              }
            )}
            value={value}
            onChange={onChange}
          />
        )}
        {field.type === 'single_choice' && (
          <div className='flex flex-col gap-1.5'>
            {field.options?.map((o, i) => (
              <label
                key={o.id}
                className='hover:bg-accent/60 has-[:checked]:border-foreground flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 text-sm'
              >
                <input
                  id={i === 0 ? id : undefined}
                  type='radio'
                  name={id}
                  checked={value === o.id}
                  onChange={() => onChange(o.id)}
                  className='accent-foreground size-4'
                />
                {o.label}
              </label>
            ))}
          </div>
        )}
        {field.type === 'multiple_choice' && (
          <div className='flex flex-col gap-1.5'>
            {field.options?.map((o, i) => {
              const list = Array.isArray(value) ? value : [];
              return (
                <label
                  key={o.id}
                  className='hover:bg-accent/60 has-[:checked]:border-foreground flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 text-sm'
                >
                  <input
                    id={i === 0 ? id : undefined}
                    type='checkbox'
                    checked={list.includes(o.id)}
                    onChange={(e) =>
                      onChange(
                        e.target.checked
                          ? [...list, o.id]
                          : list.filter((x) => x !== o.id)
                      )
                    }
                    className='accent-foreground size-4'
                  />
                  {o.label}
                </label>
              );
            })}
          </div>
        )}
        {field.type === 'address' && (
          <AddressInput id={id} value={value} onChange={onChange} />
        )}
        {field.type === 'confirmation' && (
          <label className='flex min-h-11 cursor-pointer items-center gap-3 text-sm'>
            <input
              id={id}
              type='checkbox'
              checked={value === true}
              onChange={(e) => onChange(e.target.checked)}
              className='accent-foreground size-5'
            />
            I confirm
          </label>
        )}
        {errorText}
      </fieldset>
    );
  }

  return (
    <div className='flex flex-col gap-2'>
      <label htmlFor={id} className='text-sm font-medium'>
        {label}
      </label>
      {help}
      {field.type === 'long_text' ? (
        <Textarea
          id={id}
          value={text}
          maxLength={5000}
          rows={4}
          onChange={(e) => onChange(e.target.value)}
          {...common}
        />
      ) : field.type === 'dropdown' ? (
        <select
          id={id}
          value={text}
          onChange={(e) => onChange(e.target.value || undefined)}
          className='border-input bg-background focus-visible:ring-ring/50 focus-visible:border-ring h-11 rounded-md border px-3 text-base outline-none focus-visible:ring-[3px] md:text-sm'
          {...common}
        >
          <option value=''>Choose…</option>
          {field.options?.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      ) : field.type === 'number' || field.type === 'currency' ? (
        <div className='relative max-w-xs'>
          {field.type === 'currency' && (
            <span
              aria-hidden
              className='text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2 text-sm'
            >
              £
            </span>
          )}
          <Input
            id={id}
            type='number'
            inputMode='decimal'
            step={field.type === 'currency' ? '0.01' : 'any'}
            min={field.min}
            max={field.max}
            value={typeof value === 'number' ? value : ''}
            onChange={(e) =>
              onChange(
                e.target.value === '' ? undefined : Number(e.target.value)
              )
            }
            className={cn('h-11', field.type === 'currency' && 'pl-7')}
            {...common}
          />
        </div>
      ) : (
        <Input
          id={id}
          type={
            field.type === 'email'
              ? 'email'
              : field.type === 'phone'
                ? 'tel'
                : field.type === 'date'
                  ? 'date'
                  : field.type === 'time'
                    ? 'time'
                    : 'text'
          }
          autoComplete={
            field.type === 'email'
              ? 'email'
              : field.type === 'phone'
                ? 'tel'
                : undefined
          }
          maxLength={500}
          placeholder={field.placeholder}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            'h-11',
            (field.type === 'date' || field.type === 'time') && 'max-w-xs'
          )}
          {...common}
        />
      )}
      {errorText}
    </div>
  );
}

function ChoiceButtons({
  name,
  focusId,
  options,
  value,
  onChange,
  dense
}: {
  name: string;
  focusId: string;
  options: { id: string; label: string; value: boolean | number }[];
  value: AnswerValue | undefined;
  onChange(value: AnswerValue): void;
  dense?: boolean;
}) {
  return (
    <div className={cn('flex flex-wrap gap-2', dense && 'gap-1.5')}>
      {options.map((o, i) => (
        <label
          key={o.id}
          className={cn(
            'has-[:focus-visible]:ring-ring/50 has-[:checked]:border-foreground has-[:checked]:bg-foreground has-[:checked]:text-background flex min-h-11 cursor-pointer items-center justify-center rounded-md border text-sm font-medium transition-colors has-[:focus-visible]:ring-[3px]',
            dense ? 'min-w-11 px-2' : 'min-w-20 px-4'
          )}
        >
          <input
            id={i === 0 ? focusId : undefined}
            type='radio'
            name={name}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            className='sr-only'
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

function AddressInput({
  id,
  value,
  onChange
}: {
  id: string;
  value: AnswerValue | undefined;
  onChange(value: AnswerValue): void;
}) {
  const address = (
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  ) as Record<string, string>;
  const part = (
    key: string,
    label: string,
    autoComplete: string,
    className?: string
  ) => (
    <div className={cn('flex flex-col gap-1', className)}>
      <label
        htmlFor={key === 'line1' ? id : `${id}-${key}`}
        className='text-muted-foreground text-xs'
      >
        {label}
      </label>
      <Input
        id={key === 'line1' ? id : `${id}-${key}`}
        autoComplete={autoComplete}
        maxLength={200}
        value={address[key] ?? ''}
        onChange={(e) => onChange({ ...address, [key]: e.target.value })}
        className='h-11'
      />
    </div>
  );
  return (
    <div className='grid gap-2 sm:grid-cols-2'>
      {part('line1', 'Address line 1', 'address-line1', 'sm:col-span-2')}
      {part('line2', 'Address line 2', 'address-line2', 'sm:col-span-2')}
      {part('town', 'Town or city', 'address-level2')}
      {part('postcode', 'Postcode', 'postal-code')}
    </div>
  );
}

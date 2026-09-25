'use client';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  IconArrowDown,
  IconArrowUp,
  IconCopy,
  IconDots,
  IconEye,
  IconGitBranch,
  IconLoader2,
  IconPlus,
  IconTrash,
  IconX
} from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  CHOICE_TYPES,
  ENTITY_KIND_LABEL,
  ENTITY_KINDS,
  FIELD_TYPE_INFO,
  FIELD_TYPES,
  PHOTO_DEFAULT_MAX,
  defaultField,
  definitionProblem,
  duplicateField,
  finaliseIds,
  isInputType,
  moveField,
  optionsFromLabels,
  removeField,
  updateField,
  addField,
  type FieldType,
  type FormDefinition,
  type FormField
} from '../definition';
import {
  createFormAction,
  publishFormAction,
  saveDraftAction,
  setFormStatusAction
} from '../server/actions';
import type { FormDetail } from '../types';
import { FormStatusBadge } from './badges';

export interface BuilderPermissions {
  edit: boolean;
  publish: boolean;
  create: boolean;
  templates: boolean;
}

interface Draft {
  title: string;
  description: string | null;
  definition: FormDefinition;
}

const GROUPS = ['Text', 'Choice', 'Number', 'Other', 'Layout'] as const;

/**
 * The manual form builder. It edits the draft with the same pure operations
 * SimpleBot's tools use and saves through the same FORMS_UPDATE_DRAFT command,
 * sending the version it loaded: if someone else (or SimpleBot) saved in the
 * meantime, the save is refused instead of overwriting their change.
 */
export function FormBuilder({
  form,
  can
}: {
  form: FormDetail;
  can: BuilderPermissions;
}) {
  const router = useRouter();
  const saved: Draft = useMemo(
    () => ({
      title: form.title,
      description: form.description,
      definition: form.definition
    }),
    [form]
  );
  const [draft, setDraft] = useState<Draft>(saved);
  const [version, setVersion] = useState(form.version);
  const [selectedId, setSelectedId] = useState<string | null>(
    form.definition.fields[0]?.id ?? null
  );
  const [busy, setBusy] = useState<
    null | 'save' | 'publish' | 'status' | 'copy'
  >(null);
  const [message, setMessage] = useState<{
    tone: 'error' | 'ok';
    text: string;
    stale?: boolean;
  } | null>(null);

  // A newer version from the server (after a save, or someone else's change on reload).
  const [loadedVersion, setLoadedVersion] = useState(form.version);
  if (form.version !== loadedVersion) {
    setLoadedVersion(form.version);
    setDraft(saved);
    setVersion(form.version);
  }

  const isTemplate = form.kind === 'template';
  const archived = form.status === 'archived';
  const editable = (isTemplate ? can.templates : can.edit) && !archived;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const problem = definitionProblem(draft.definition);
  const selected =
    draft.definition.fields.find((f) => f.id === selectedId) ?? null;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const setDefinition = (definition: FormDefinition) =>
    setDraft((d) => ({ ...d, definition }));

  const save = async (): Promise<number | null> => {
    if (!dirty) return version;
    if (problem) {
      setMessage({
        tone: 'error',
        text: `Fix this first: ${problem.problem}.`
      });
      if (problem.fieldId) setSelectedId(problem.fieldId);
      return null;
    }
    setBusy('save');
    // Readable ids for questions that still have a placeholder one.
    const selectedIndex = draft.definition.fields.findIndex(
      (f) => f.id === selectedId
    );
    const toSave = { ...draft, definition: finaliseIds(draft.definition) };
    setDraft(toSave);
    if (selectedIndex >= 0)
      setSelectedId(toSave.definition.fields[selectedIndex].id);
    const result = await saveDraftAction(
      form.id,
      version,
      toSave,
      crypto.randomUUID()
    );
    setBusy(null);
    if (!result.ok) {
      setMessage({
        tone: 'error',
        text: result.message,
        stale: result.code === 'FORMS_STALE_VERSION'
      });
      return null;
    }
    setVersion(result.result.version);
    setMessage({ tone: 'ok', text: 'Draft saved.' });
    router.refresh();
    return result.result.version;
  };

  const publish = async () => {
    const v = await save();
    if (v === null) return;
    setBusy('publish');
    const result = await publishFormAction(form.id, v, crypto.randomUUID());
    setBusy(null);
    if (!result.ok)
      return setMessage({
        tone: 'error',
        text: result.message,
        stale: result.code === 'FORMS_STALE_VERSION'
      });
    setMessage({
      tone: 'ok',
      text: `Published as version ${result.result.revision}. Existing links keep the version they were sent.`
    });
    router.refresh();
  };

  const changeStatus = async (
    status: 'closed' | 'published' | 'archived' | 'restore' | 'active'
  ) => {
    setBusy('status');
    const result = await setFormStatusAction(
      form.id,
      status,
      version,
      crypto.randomUUID()
    );
    setBusy(null);
    if (!result.ok)
      return setMessage({
        tone: 'error',
        text: result.message,
        stale: result.code === 'FORMS_STALE_VERSION'
      });
    router.refresh();
  };

  const copy = async (kind: 'form' | 'template', title: string) => {
    const v = await save();
    if (v === null) return;
    setBusy('copy');
    const result = await createFormAction(
      {
        kind,
        title,
        ...(isTemplate
          ? { sourceTemplateId: form.id }
          : { sourceFormId: form.id })
      },
      crypto.randomUUID()
    );
    setBusy(null);
    if (!result.ok) return setMessage({ tone: 'error', text: result.message });
    router.push(`/dashboard/forms/${result.result.form_id}`);
  };

  const add = (type: FieldType) => {
    const field = defaultField(
      type,
      type === 'section'
        ? 'New section'
        : type === 'info'
          ? 'Instructions'
          : 'New question',
      draft.definition
    );
    const at = selected
      ? draft.definition.fields.findIndex((f) => f.id === selected.id) + 1
      : undefined;
    setDefinition(addField(draft.definition, field, at));
    setSelectedId(field.id);
  };

  const inputNumber = new Map<string, number>();
  draft.definition.fields
    .filter((f) => isInputType(f.type))
    .forEach((f, i) => inputNumber.set(f.id, i + 1));

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <FormStatusBadge status={form.status} />
        <span className='text-muted-foreground text-sm'>
          {isTemplate
            ? 'Template'
            : form.revision > 0
              ? `Version ${form.revision} published${form.hasUnpublishedChanges || dirty ? ' · draft has unpublished changes' : ''}`
              : 'Not published yet'}
        </span>
        <div className='ml-auto flex flex-wrap items-center gap-2'>
          {editable && (
            <Button
              variant='outline'
              onClick={() => void save()}
              disabled={!dirty || busy !== null}
            >
              {busy === 'save' && (
                <IconLoader2 aria-hidden className='animate-spin' />
              )}
              {dirty ? 'Save draft' : 'Saved'}
            </Button>
          )}
          <Button
            variant='outline'
            disabled={busy !== null}
            onClick={async () => {
              if ((await save()) !== null)
                router.push(`/dashboard/forms/${form.id}/preview`);
            }}
          >
            <IconEye aria-hidden />
            Preview
          </Button>
          {!isTemplate &&
            can.publish &&
            !archived &&
            form.status !== 'closed' && (
              <Button
                onClick={() => void publish()}
                disabled={
                  busy !== null ||
                  (!dirty && !form.hasUnpublishedChanges && form.revision > 0)
                }
              >
                {busy === 'publish' && (
                  <IconLoader2 aria-hidden className='animate-spin' />
                )}
                {form.revision > 0
                  ? `Publish v${form.revision + 1}`
                  : 'Publish'}
              </Button>
            )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='outline' size='icon' disabled={busy !== null}>
                <IconDots aria-hidden />
                <span className='sr-only'>More actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuLabel>
                {isTemplate ? 'Template' : 'Form'}
              </DropdownMenuLabel>
              {isTemplate && can.create && !archived && (
                <DropdownMenuItem
                  onSelect={() => void copy('form', draft.title)}
                >
                  Create a form from this template
                </DropdownMenuItem>
              )}
              {can.templates && (
                <DropdownMenuItem
                  onSelect={() =>
                    void copy(
                      'template',
                      isTemplate ? `${draft.title} (copy)` : draft.title
                    )
                  }
                >
                  {isTemplate ? 'Duplicate template' : 'Save as template'}
                </DropdownMenuItem>
              )}
              {!isTemplate && can.create && (
                <DropdownMenuItem
                  onSelect={() => void copy('form', `${draft.title} (copy)`)}
                >
                  Duplicate form
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {!isTemplate && can.edit && form.status === 'published' && (
                <DropdownMenuItem onSelect={() => void changeStatus('closed')}>
                  Close (stop new responses)
                </DropdownMenuItem>
              )}
              {!isTemplate && can.edit && form.status === 'closed' && (
                <DropdownMenuItem
                  onSelect={() => void changeStatus('published')}
                >
                  Reopen
                </DropdownMenuItem>
              )}
              {(isTemplate ? can.templates : can.edit) &&
                (archived ? (
                  <DropdownMenuItem
                    onSelect={() =>
                      void changeStatus(isTemplate ? 'active' : 'restore')
                    }
                  >
                    Restore
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onSelect={() => void changeStatus('archived')}
                  >
                    Archive
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {message && (
        <div
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm',
            message.tone === 'error'
              ? 'bg-destructive-soft text-destructive'
              : 'bg-success-soft text-success'
          )}
        >
          <span className='flex-1'>{message.text}</span>
          {message.stale && (
            <Button
              size='sm'
              variant='outline'
              className='text-foreground h-7'
              onClick={() => window.location.reload()}
            >
              Reload
            </Button>
          )}
          <button
            type='button'
            onClick={() => setMessage(null)}
            className='rounded p-1'
            aria-label='Dismiss'
          >
            <IconX aria-hidden className='size-4' />
          </button>
        </div>
      )}
      {archived && (
        <p className='bg-muted rounded-lg px-3 py-2 text-sm'>
          This {isTemplate ? 'template' : 'form'} is archived. Restore it to
          make changes. Its responses are kept.
        </p>
      )}

      <div className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]'>
        <section
          aria-label='Form content'
          className='flex min-w-0 flex-col gap-3'
        >
          <div className='bg-card flex flex-col gap-3 rounded-lg border p-4'>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='form-title'>Title</Label>
              <Input
                id='form-title'
                value={draft.title}
                maxLength={200}
                disabled={!editable}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, title: e.target.value }))
                }
                className='text-base font-semibold'
              />
            </div>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='form-description'>
                Instructions for the recipient (optional)
              </Label>
              <Textarea
                id='form-description'
                value={draft.description ?? ''}
                maxLength={4000}
                rows={2}
                disabled={!editable}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    description: e.target.value || null
                  }))
                }
              />
            </div>
          </div>

          {draft.definition.fields.length === 0 && (
            <p className='text-muted-foreground rounded-lg border border-dashed px-4 py-8 text-center text-sm'>
              No questions yet. Add the first one below.
            </p>
          )}
          <ol className='flex flex-col gap-2'>
            {draft.definition.fields.map((field, index) => (
              <li key={field.id}>
                <FieldCard
                  field={field}
                  number={inputNumber.get(field.id) ?? null}
                  selected={field.id === selectedId}
                  editable={editable}
                  first={index === 0}
                  last={index === draft.definition.fields.length - 1}
                  problem={
                    problem?.fieldId === field.id ? problem.problem : null
                  }
                  onSelect={() => setSelectedId(field.id)}
                  onMove={(delta) =>
                    setDefinition(
                      moveField(draft.definition, field.id, index + delta)
                    )
                  }
                  onDuplicate={() =>
                    setDefinition(duplicateField(draft.definition, field.id))
                  }
                  onRemove={() => {
                    setDefinition(removeField(draft.definition, field.id));
                    if (selectedId === field.id) setSelectedId(null);
                  }}
                />
              </li>
            ))}
          </ol>

          {editable && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant='outline' className='self-start'>
                  <IconPlus aria-hidden />
                  Add question
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align='start'
                className='max-h-96 w-64 overflow-y-auto'
              >
                {GROUPS.map((group) => (
                  <div key={group}>
                    <DropdownMenuLabel className='text-muted-foreground text-xs'>
                      {group}
                    </DropdownMenuLabel>
                    {FIELD_TYPES.filter(
                      (t) => FIELD_TYPE_INFO[t].group === group
                    ).map((t) => (
                      <DropdownMenuItem key={t} onSelect={() => add(t)}>
                        <span className='flex flex-col'>
                          <span>{FIELD_TYPE_INFO[t].label}</span>
                          <span className='text-muted-foreground text-xs'>
                            {FIELD_TYPE_INFO[t].hint}
                          </span>
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </div>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </section>

        <aside
          aria-label='Question settings'
          className='lg:sticky lg:top-4 lg:self-start'
        >
          {selected ? (
            <FieldSettings
              key={selected.id}
              field={selected}
              definition={draft.definition}
              editable={editable}
              onChange={(change) =>
                setDefinition(
                  updateField(draft.definition, selected.id, change)
                )
              }
            />
          ) : (
            <p className='text-muted-foreground rounded-lg border border-dashed px-4 py-8 text-center text-sm'>
              Select a question to change its settings.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

function FieldCard({
  field,
  number,
  selected,
  editable,
  first,
  last,
  problem,
  onSelect,
  onMove,
  onDuplicate,
  onRemove
}: {
  field: FormField;
  number: number | null;
  selected: boolean;
  editable: boolean;
  first: boolean;
  last: boolean;
  problem: string | null;
  onSelect(): void;
  onMove(delta: number): void;
  onDuplicate(): void;
  onRemove(): void;
}) {
  const layout = !isInputType(field.type);
  return (
    <div
      className={cn(
        'bg-card flex items-start gap-3 rounded-lg border p-3 transition-colors',
        selected
          ? 'border-foreground ring-foreground/10 ring-2'
          : 'hover:border-foreground/40',
        problem && 'border-destructive'
      )}
    >
      <button
        type='button'
        onClick={onSelect}
        aria-pressed={selected}
        className='focus-visible:ring-ring min-w-0 flex-1 rounded text-left outline-none focus-visible:ring-2'
      >
        <span
          className={cn(
            'block text-sm',
            layout ? 'font-semibold' : 'font-medium'
          )}
        >
          {number !== null && (
            <span className='text-muted-foreground mr-1.5 tabular-nums'>
              {number}.
            </span>
          )}
          {field.label}
          {field.required && (
            <span className='text-destructive ml-0.5' aria-label='required'>
              *
            </span>
          )}
        </span>
        <span className='text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 text-xs'>
          <span>{FIELD_TYPE_INFO[field.type].label}</span>
          {field.options && <span>· {field.options.length} options</span>}
          {field.condition && (
            <span className='inline-flex items-center gap-1'>
              · <IconGitBranch aria-hidden className='size-3' /> shown only
              sometimes
            </span>
          )}
          <span className='font-mono'>· {field.id}</span>
        </span>
        {problem && (
          <span className='text-destructive mt-1 block text-xs'>{problem}</span>
        )}
      </button>
      {editable && (
        <div className='flex shrink-0 items-center'>
          <Button
            variant='ghost'
            size='icon'
            className='size-8'
            disabled={first}
            onClick={() => onMove(-1)}
          >
            <IconArrowUp aria-hidden />
            <span className='sr-only'>Move {field.label} up</span>
          </Button>
          <Button
            variant='ghost'
            size='icon'
            className='size-8'
            disabled={last}
            onClick={() => onMove(1)}
          >
            <IconArrowDown aria-hidden />
            <span className='sr-only'>Move {field.label} down</span>
          </Button>
          <Button
            variant='ghost'
            size='icon'
            className='size-8'
            onClick={onDuplicate}
          >
            <IconCopy aria-hidden />
            <span className='sr-only'>Duplicate {field.label}</span>
          </Button>
          <Button
            variant='ghost'
            size='icon'
            className='text-destructive size-8'
            onClick={onRemove}
          >
            <IconTrash aria-hidden />
            <span className='sr-only'>Remove {field.label}</span>
          </Button>
        </div>
      )}
    </div>
  );
}

function FieldSettings({
  field,
  definition,
  editable,
  onChange
}: {
  field: FormField;
  definition: FormDefinition;
  editable: boolean;
  onChange(change: Partial<Omit<FormField, 'id'>>): void;
}) {
  const index = definition.fields.findIndex((f) => f.id === field.id);
  const earlier = definition.fields
    .slice(0, index)
    .filter((f) => isInputType(f.type));
  const source = earlier.find((f) => f.id === field.condition?.field);
  const layout = !isInputType(field.type);
  const [optionsText, setOptionsText] = useState(
    (field.options ?? []).map((o) => o.label).join('\n')
  );

  return (
    <div className='bg-card flex flex-col gap-4 rounded-lg border p-4'>
      <h2 className='text-sm font-semibold'>
        {layout ? 'Block settings' : 'Question settings'}
      </h2>
      <fieldset disabled={!editable} className='flex flex-col gap-4'>
        <div className='flex flex-col gap-1.5'>
          <Label htmlFor='field-type'>Type</Label>
          <select
            id='field-type'
            value={field.type}
            onChange={(e) => onChange({ type: e.target.value as FieldType })}
            className='border-input bg-background focus-visible:ring-ring/50 h-9 rounded-md border px-3 text-sm outline-none focus-visible:ring-[3px]'
          >
            {FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {FIELD_TYPE_INFO[t].label}
              </option>
            ))}
          </select>
        </div>
        <div className='flex flex-col gap-1.5'>
          <Label htmlFor='field-label'>{layout ? 'Heading' : 'Question'}</Label>
          <Textarea
            id='field-label'
            rows={2}
            maxLength={300}
            value={field.label}
            onChange={(e) => onChange({ label: e.target.value })}
          />
        </div>
        <div className='flex flex-col gap-1.5'>
          <Label htmlFor='field-help'>
            {layout ? 'Text' : 'Helper text (optional)'}
          </Label>
          <Textarea
            id='field-help'
            rows={2}
            maxLength={2000}
            value={field.help ?? ''}
            onChange={(e) => onChange({ help: e.target.value || undefined })}
          />
        </div>
        {!layout && (
          <div className='flex items-center justify-between gap-3'>
            <Label htmlFor='field-required'>Required</Label>
            <Switch
              id='field-required'
              checked={!!field.required}
              onCheckedChange={(v) => onChange({ required: v })}
            />
          </div>
        )}
        {CHOICE_TYPES.includes(field.type) && (
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='field-options'>Options, one per line</Label>
            <Textarea
              id='field-options'
              rows={5}
              value={optionsText}
              onChange={(e) => {
                setOptionsText(e.target.value);
                const labels = e.target.value
                  .split('\n')
                  .map((l) => l.trim())
                  .filter(Boolean)
                  .slice(0, 50);
                if (labels.length)
                  onChange({ options: keepOptionIds(field, labels) });
              }}
            />
          </div>
        )}
        {field.type === 'entity' && (
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='field-entity'>Look up</Label>
            <select
              id='field-entity'
              value={field.entity ?? ENTITY_KINDS[0]}
              onChange={(e) =>
                onChange({
                  entity: e.target.value as (typeof ENTITY_KINDS)[number]
                })
              }
              className='border-input bg-background h-9 rounded-md border px-3 text-sm'
            >
              {ENTITY_KINDS.map((k) => (
                <option key={k} value={k}>
                  {ENTITY_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
        )}
        {field.type === 'photo' && (
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='field-max'>Most files allowed</Label>
            <select
              id='field-max'
              value={field.max ?? 4}
              onChange={(e) => onChange({ max: Number(e.target.value) })}
              className='border-input bg-background h-9 rounded-md border px-3 text-sm'
            >
              {Array.from({ length: PHOTO_DEFAULT_MAX }, (_, i) => i + 1).map(
                (n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                )
              )}
            </select>
            <p className='text-muted-foreground text-xs'>
              Photos and PDFs, up to 25 MB each. Turn on “Required” to insist on
              at least one.
            </p>
          </div>
        )}
        {(field.type === 'number' ||
          field.type === 'currency' ||
          field.type === 'scale') && (
          <div className='grid grid-cols-2 gap-3'>
            {(['min', 'max'] as const).map((key) => (
              <div key={key} className='flex flex-col gap-1.5'>
                <Label htmlFor={`field-${key}`}>
                  {key === 'min' ? 'Lowest' : 'Highest'}
                </Label>
                {field.type === 'scale' ? (
                  <select
                    id={`field-${key}`}
                    value={field[key] ?? ''}
                    onChange={(e) =>
                      onChange({ [key]: Number(e.target.value) })
                    }
                    className='border-input bg-background h-9 rounded-md border px-3 text-sm'
                  >
                    {(key === 'min'
                      ? [0, 1]
                      : [2, 3, 4, 5, 6, 7, 8, 9, 10]
                    ).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    id={`field-${key}`}
                    type='number'
                    value={field[key] ?? ''}
                    onChange={(e) =>
                      onChange({
                        [key]:
                          e.target.value === ''
                            ? undefined
                            : Number(e.target.value)
                      })
                    }
                  />
                )}
              </div>
            ))}
          </div>
        )}
        <div className='flex flex-col gap-2 border-t pt-4'>
          <p className='text-sm font-medium'>Show this only when…</p>
          {earlier.length === 0 ? (
            <p className='text-muted-foreground text-xs'>
              Conditions can refer to questions above this one.
            </p>
          ) : (
            <>
              <select
                aria-label='Condition question'
                value={field.condition?.field ?? ''}
                onChange={(e) =>
                  onChange({
                    condition: e.target.value
                      ? { field: e.target.value, op: 'answered' }
                      : undefined
                  })
                }
                className='border-input bg-background h-9 rounded-md border px-3 text-sm'
              >
                <option value=''>Always show</option>
                {earlier.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
              {source && field.condition && (
                <ConditionValue
                  source={source}
                  condition={field.condition}
                  onChange={(condition) => onChange({ condition })}
                />
              )}
            </>
          )}
        </div>
      </fieldset>
    </div>
  );
}

/** Keeps existing option ids when labels are edited, so conditions keep working. */
function keepOptionIds(field: FormField, labels: string[]) {
  const fresh = optionsFromLabels(labels);
  const existing = field.options ?? [];
  const used = new Set<string>();
  return fresh.map((o, i) => {
    const keep = existing.find((e) => e.label === o.label) ?? existing[i];
    const id = keep && !used.has(keep.id) ? keep.id : o.id;
    used.add(id);
    return { id, label: o.label };
  });
}

function ConditionValue({
  source,
  condition,
  onChange
}: {
  source: FormField;
  condition: NonNullable<FormField['condition']>;
  onChange(condition: NonNullable<FormField['condition']>): void;
}) {
  const ops =
    source.type === 'multiple_choice'
      ? [
          { value: 'includes', label: 'includes' },
          { value: 'answered', label: 'is answered' }
        ]
      : [
          { value: 'equals', label: 'is' },
          { value: 'not_equals', label: 'is not' },
          // Several answers, one rule: the alternative is the same follow-up
          // question repeated once per answer.
          { value: 'in', label: 'is one of' },
          { value: 'answered', label: 'is answered' }
        ];
  const values =
    source.type === 'yes_no'
      ? [
          { value: 'true', label: 'Yes' },
          { value: 'false', label: 'No' }
        ]
      : (source.options?.map((o) => ({ value: o.id, label: o.label })) ?? null);
  const toValue = (raw: string) =>
    source.type === 'yes_no' ? raw === 'true' : raw;
  const chosen = (condition.values ?? []).map(String);

  return (
    <div className='flex flex-col gap-2'>
      <select
        aria-label='Condition'
        value={condition.op}
        onChange={(e) => {
          const op = e.target.value as typeof condition.op;
          onChange(
            op === 'answered'
              ? { field: condition.field, op }
              : op === 'in'
                ? {
                    field: condition.field,
                    op,
                    values:
                      condition.values ??
                      (condition.value !== undefined
                        ? [condition.value]
                        : values
                          ? [toValue(values[0].value)]
                          : [''])
                  }
                : {
                    field: condition.field,
                    op,
                    value:
                      condition.value ??
                      condition.values?.[0] ??
                      (values ? toValue(values[0].value) : '')
                  }
          );
        }}
        className='border-input bg-background h-9 rounded-md border px-3 text-sm'
      >
        {ops.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {condition.op === 'in' ? (
        values ? (
          <fieldset className='flex flex-col gap-1.5'>
            <legend className='text-muted-foreground mb-1 text-xs'>
              Any one of these
            </legend>
            {values.map((v) => (
              <label
                key={v.value}
                className='flex min-h-9 cursor-pointer items-center gap-2 text-sm'
              >
                <input
                  type='checkbox'
                  className='accent-foreground size-4'
                  checked={chosen.includes(v.value)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...chosen, v.value]
                      : chosen.filter((x) => x !== v.value);
                    // Never leave it empty: an empty list is not a valid rule.
                    if (!next.length) return;
                    onChange({ ...condition, values: next.map(toValue) });
                  }}
                />
                {v.label}
              </label>
            ))}
          </fieldset>
        ) : (
          <Input
            aria-label='Condition values, comma separated'
            value={chosen.join(', ')}
            onChange={(e) =>
              onChange({
                ...condition,
                values: e.target.value
                  .split(',')
                  .map((x) => x.trim())
                  .filter(Boolean)
              })
            }
          />
        )
      ) : null}
      {condition.op !== 'answered' &&
        condition.op !== 'in' &&
        (values ? (
          <select
            aria-label='Condition value'
            value={String(condition.value ?? '')}
            onChange={(e) =>
              onChange({ ...condition, value: toValue(e.target.value) })
            }
            className='border-input bg-background h-9 rounded-md border px-3 text-sm'
          >
            {values.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
        ) : (
          <Input
            aria-label='Condition value'
            value={String(condition.value ?? '')}
            onChange={(e) =>
              onChange({
                ...condition,
                value:
                  ['number', 'currency', 'scale'].includes(source.type) &&
                  e.target.value !== ''
                    ? Number(e.target.value)
                    : e.target.value
              })
            }
          />
        ))}
    </div>
  );
}

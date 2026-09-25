// The form definition: field types, validation and pure editing operations.
//
// Safe to import anywhere (no server code). The manual builder and SimpleBot's
// tools both edit drafts with the operations below and save through the same
// FORMS_UPDATE_DRAFT command; the database validates every definition and every
// answer again (app.forms_validate_definition / app.forms_validate_answers),
// so these rules are the same rules, applied early for a better experience.
import { z } from 'zod';

export const INPUT_TYPES = [
  'short_text',
  'long_text',
  'email',
  'phone',
  'number',
  'currency',
  'date',
  'time',
  'yes_no',
  'single_choice',
  'multiple_choice',
  'dropdown',
  'scale',
  'address',
  'confirmation',
  // Staff-only: both need an authenticated actor, so a recipient link cannot
  // carry them (the database refuses one - FORMS_NOT_LINKABLE).
  'photo',
  'entity',
  // NOT staff-only, deliberately. A signature is the answer itself rather than
  // an uploaded file, so it needs no actor to own it and a recipient link can
  // carry one - which is the whole point, because the person signing is usually
  // the customer.
  'signature'
] as const;
export const LAYOUT_TYPES = ['section', 'info'] as const;
export const FIELD_TYPES = [...INPUT_TYPES, ...LAYOUT_TYPES] as const;

export type InputType = (typeof INPUT_TYPES)[number];
export type FieldType = (typeof FIELD_TYPES)[number];

export const CHOICE_TYPES: readonly FieldType[] = [
  'single_choice',
  'multiple_choice',
  'dropdown'
];
const BOUNDED_TYPES: readonly FieldType[] = [
  'number',
  'currency',
  'scale',
  // `max` only: "at least one" is what `required` already means.
  'photo'
];

/** Types a recipient with no account cannot answer. Mirrors app.forms_staff_only_types(). */
export const STAFF_ONLY_TYPES: readonly FieldType[] = ['photo', 'entity'];

/** What an `entity` question may look up. Mirrors app.forms_entity_kinds(). */
export const ENTITY_KINDS = ['programme_property'] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export const ENTITY_KIND_LABEL: Record<EntityKind, string> = {
  programme_property: 'Programme property'
};

/** Files one photo question may carry when it does not say. */
export const PHOTO_DEFAULT_MAX = 10;

/**
 * The box a signature is drawn in, and the longest path accepted.
 *
 * Every signature is captured in these coordinates whatever the size of the
 * screen it was drawn on, so the stored value is self-describing: it re-renders
 * at any width without storing the canvas it came from. Mirrors
 * app.forms_signature_max_length().
 */
export const SIGNATURE_BOX = { width: 600, height: 200 } as const;
export const SIGNATURE_MAX_LENGTH = 20000;

/**
 * Whether this is path data we are willing to put in an SVG `d` attribute.
 *
 * The same allow-list the database enforces. It is the only thing standing
 * between a value somebody posted and markup, so it permits move, line and
 * curve commands, digits and separators, and nothing else.
 */
export const isSignaturePath = (value: string) =>
  /^[Mm]/.test(value) &&
  /^[MLCQmlcq0-9 .,-]+$/.test(value) &&
  value.length <= SIGNATURE_MAX_LENGTH;

export const hasStaffOnlyField = (definition: FormDefinition) =>
  definition.fields.some((f) => STAFF_ONLY_TYPES.includes(f.type));

export const FIELD_TYPE_INFO: Record<
  FieldType,
  {
    label: string;
    hint: string;
    group: 'Text' | 'Choice' | 'Number' | 'Other' | 'Layout';
  }
> = {
  short_text: { label: 'Short text', hint: 'A single line', group: 'Text' },
  long_text: { label: 'Long text', hint: 'A paragraph', group: 'Text' },
  email: { label: 'Email', hint: 'An email address', group: 'Text' },
  phone: { label: 'Phone', hint: 'A phone number', group: 'Text' },
  address: {
    label: 'Address',
    hint: 'Address lines, town, postcode',
    group: 'Text'
  },
  number: { label: 'Number', hint: 'Any number', group: 'Number' },
  currency: { label: 'Currency', hint: 'An amount in pounds', group: 'Number' },
  scale: { label: 'Rating scale', hint: 'e.g. 1 to 10', group: 'Number' },
  date: { label: 'Date', hint: 'A calendar date', group: 'Other' },
  time: { label: 'Time', hint: 'A time of day', group: 'Other' },
  yes_no: { label: 'Yes / No', hint: 'Two buttons', group: 'Choice' },
  single_choice: { label: 'Single choice', hint: 'Pick one', group: 'Choice' },
  multiple_choice: {
    label: 'Multiple choice',
    hint: 'Pick any',
    group: 'Choice'
  },
  dropdown: {
    label: 'Dropdown',
    hint: 'Pick one from a list',
    group: 'Choice'
  },
  confirmation: {
    label: 'Confirmation',
    hint: 'A tick box to agree',
    group: 'Other'
  },
  photo: {
    label: 'Photo or file',
    hint: 'Take or attach photos',
    group: 'Other'
  },
  entity: {
    label: 'Record lookup',
    hint: 'Search and pick a record',
    group: 'Other'
  },
  signature: {
    label: 'Signature',
    hint: 'Sign with a finger or mouse',
    group: 'Other'
  },
  section: {
    label: 'Section heading',
    hint: 'Groups the questions below',
    group: 'Layout'
  },
  info: {
    label: 'Text block',
    hint: 'Instructions, no answer',
    group: 'Layout'
  }
};

export const isInputType = (type: string): type is InputType =>
  (INPUT_TYPES as readonly string[]).includes(type);

const ID = /^[a-z][a-z0-9_]{0,39}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPTION_ID = /^[a-z0-9][a-z0-9_]{0,39}$/;

export const optionSchema = z.strictObject({
  id: z.string().regex(OPTION_ID),
  label: z.string().trim().min(1).max(200)
});

const CONDITION_VALUE = z.union([z.string(), z.boolean(), z.number()]);

export const conditionSchema = z.strictObject({
  field: z.string().regex(ID),
  // 'in': true when the earlier answer is any one of `values`. Two outcomes that
  // share their follow-up questions need one condition, not duplicated fields.
  op: z.enum(['equals', 'not_equals', 'includes', 'answered', 'in']),
  value: CONDITION_VALUE.optional(),
  values: z.array(CONDITION_VALUE).min(1).max(50).optional()
});

export const fieldSchema = z.strictObject({
  id: z.string().regex(ID),
  type: z.enum(FIELD_TYPES),
  label: z.string().trim().min(1).max(300),
  help: z.string().max(2000).optional(),
  placeholder: z.string().max(200).optional(),
  required: z.boolean().optional(),
  options: z.array(optionSchema).min(1).max(50).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  condition: conditionSchema.optional(),
  entity: z.enum(ENTITY_KINDS).optional()
});

export type FormOption = z.infer<typeof optionSchema>;
export type FormCondition = z.infer<typeof conditionSchema>;
export type FormField = z.infer<typeof fieldSchema>;
export interface FormDefinition {
  fields: FormField[];
}

export const EMPTY_DEFINITION: FormDefinition = { fields: [] };

/** Mirrors app.forms_validate_definition. Returns the first problem, or null. */
export function definitionProblem(
  definition: FormDefinition
): { fieldId: string | null; problem: string } | null {
  const parsed = z
    .strictObject({ fields: z.array(fieldSchema).max(100) })
    .safeParse(definition);
  if (!parsed.success) {
    const index = parsed.error.issues[0]?.path[1];
    const id =
      typeof index === 'number' ? (definition.fields[index]?.id ?? null) : null;
    return {
      fieldId: id,
      problem: parsed.error.issues[0]?.message ?? 'Invalid form'
    };
  }
  const seen = new Set<string>();
  const inputs: FormField[] = [];
  for (const f of definition.fields) {
    const bad = (problem: string) => ({ fieldId: f.id, problem });
    if (seen.has(f.id)) return bad('Two questions share an id');
    seen.add(f.id);
    const choice = CHOICE_TYPES.includes(f.type);
    if (choice && !f.options?.length) return bad('Add at least one option');
    if (!choice && f.options) return bad('Only choice questions have options');
    if (
      choice &&
      new Set(f.options!.map((o) => o.id)).size !== f.options!.length
    )
      return bad('Two options share an id');
    if (f.type === 'entity') {
      if (!f.entity) return bad('Choose what this question looks up');
    } else if (f.entity) {
      return bad('Only a lookup question names an entity');
    }
    if (
      (f.min !== undefined || f.max !== undefined) &&
      !BOUNDED_TYPES.includes(f.type)
    )
      return bad(
        'Only number, currency, scale and photo questions have limits'
      );
    if (f.type === 'photo') {
      if (f.min !== undefined)
        return bad('A photo question has a maximum only');
      if (
        f.max !== undefined &&
        (!Number.isInteger(f.max) || f.max < 1 || f.max > PHOTO_DEFAULT_MAX)
      )
        return bad(`A photo question allows 1-${PHOTO_DEFAULT_MAX} files`);
    } else if (f.min !== undefined && f.max !== undefined && f.min >= f.max)
      return bad('The minimum must be less than the maximum');
    if (f.type === 'scale') {
      if (
        !Number.isInteger(f.min) ||
        !Number.isInteger(f.max) ||
        f.min! < 0 ||
        f.min! > 1 ||
        f.max! < 2 ||
        f.max! > 10
      )
        return bad('A scale runs from 0 or 1 up to 2-10');
    }
    if ((f.type === 'section' || f.type === 'info') && f.required)
      return bad('A heading or text block cannot be required');
    if (f.condition) {
      const { field, op, value, values } = f.condition;
      const source = inputs.find((i) => i.id === field);
      if (!source) return bad('A condition must refer to an earlier question');
      if (op === 'in') {
        if (value !== undefined)
          return bad('"Is one of" takes a list of values');
        if (!values?.length) return bad('"Is one of" needs at least one value');
        if (new Set(values.map(String)).size !== values.length)
          return bad('A condition value is repeated');
        if (source.type === 'multiple_choice')
          return bad('"Is one of" does not apply to multiple choice');
      } else {
        if (values !== undefined)
          return bad('Only "is one of" takes a list of values');
        if (op !== 'answered' && value === undefined)
          return bad('The condition needs a value');
      }
      if (op === 'includes' && source.type !== 'multiple_choice')
        return bad('"Includes" only applies to multiple choice');
      if (CHOICE_TYPES.includes(source.type) && op !== 'answered') {
        const wanted = op === 'in' ? values! : [value];
        if (wanted.some((v) => !source.options?.some((o) => o.id === v)))
          return bad('The condition refers to an option that does not exist');
      }
    }
    if (isInputType(f.type)) inputs.push(f);
  }
  return null;
}

export const questionCount = (definition: FormDefinition) =>
  definition.fields.filter((f) => isInputType(f.type)).length;

// -- Answers ---------------------------------------------------------------------

export type AnswerValue =
  | string
  | number
  | boolean
  | string[]
  | { line1?: string; line2?: string; town?: string; postcode?: string };
export type Answers = Record<string, AnswerValue | undefined>;

export function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object')
    return !Object.values(value).some(
      (v) => typeof v === 'string' && v.trim() !== ''
    );
  return false;
}

/** Which fields are shown, given the answers so far. Mirrors the database. */
export function visibleFieldIds(
  definition: FormDefinition,
  answers: Answers
): Set<string> {
  const visible = new Set<string>();
  const kept: Answers = {};
  for (const f of definition.fields) {
    let show = true;
    if (f.condition) {
      const src = kept[f.condition.field];
      const { op, value } = f.condition;
      const { values } = f.condition;
      show =
        op === 'answered'
          ? !isBlank(src)
          : op === 'equals'
            ? src !== undefined && JSON.stringify(src) === JSON.stringify(value)
            : op === 'not_equals'
              ? src !== undefined &&
                JSON.stringify(src) !== JSON.stringify(value)
              : op === 'in'
                ? src !== undefined &&
                  (values ?? []).some(
                    (v) => JSON.stringify(src) === JSON.stringify(v)
                  )
                : Array.isArray(src) && src.includes(String(value));
    }
    if (!show) continue;
    visible.add(f.id);
    if (isInputType(f.type) && !isBlank(answers[f.id]))
      kept[f.id] = answers[f.id];
  }
  return visible;
}

/** Mirrors app.forms_validate_answers: problems keyed by field id, and the answers to send. */
export function checkAnswers(
  definition: FormDefinition,
  answers: Answers
): { errors: Record<string, string>; clean: Record<string, AnswerValue> } {
  const visible = visibleFieldIds(definition, answers);
  const errors: Record<string, string> = {};
  const clean: Record<string, AnswerValue> = {};
  for (const f of definition.fields) {
    if (!isInputType(f.type) || !visible.has(f.id)) continue;
    const v = answers[f.id];
    const empty = isBlank(v) || (f.type === 'confirmation' && v === false);
    if (empty) {
      if (f.required)
        errors[f.id] =
          f.type === 'confirmation'
            ? 'Please confirm to continue'
            : 'This question is required';
      continue;
    }
    const text = typeof v === 'string' ? v.trim() : '';
    switch (f.type) {
      case 'short_text':
      case 'long_text':
        if (text.length > (f.type === 'long_text' ? 5000 : 500))
          errors[f.id] = 'This answer is too long';
        break;
      case 'email':
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text) || text.length > 254)
          errors[f.id] = 'Enter an email address';
        break;
      case 'phone':
        if (!/^\+?[0-9 ()-]{6,20}$/.test(text))
          errors[f.id] = 'Enter a phone number';
        break;
      case 'date':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text)))
          errors[f.id] = 'Enter a date';
        break;
      case 'time':
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text))
          errors[f.id] = 'Enter a time';
        break;
      case 'number':
      case 'currency':
      case 'scale': {
        const n = typeof v === 'number' ? v : Number.NaN;
        if (!Number.isFinite(n)) errors[f.id] = 'Enter a number';
        else if (
          f.type === 'currency' &&
          (n < 0 || Math.round(n * 100) !== n * 100)
        )
          errors[f.id] = 'Enter an amount in pounds and pence';
        else if (f.type === 'scale' && !Number.isInteger(n))
          errors[f.id] = 'Choose a whole number';
        else if (
          (f.min !== undefined && n < f.min) ||
          (f.max !== undefined && n > f.max)
        )
          errors[f.id] =
            `Enter a number from ${f.min ?? '…'} to ${f.max ?? '…'}`;
        break;
      }
      case 'signature':
        if (typeof v !== 'string' || !isSignaturePath(v))
          errors[f.id] = 'Please sign in the box';
        break;
      case 'yes_no':
      case 'confirmation':
        if (typeof v !== 'boolean') errors[f.id] = 'Choose an answer';
        break;
      case 'single_choice':
      case 'dropdown':
        if (!f.options?.some((o) => o.id === v))
          errors[f.id] = 'Choose one of the options';
        break;
      case 'multiple_choice':
        if (
          !Array.isArray(v) ||
          v.some((x) => !f.options?.some((o) => o.id === x))
        )
          errors[f.id] = 'Choose from the options';
        break;
      // A list of canonical evidence ids. Shape only: whether these are files
      // this person may attach to this record is the consuming command's
      // question, and it is asked again there.
      case 'photo': {
        const list = Array.isArray(v) ? v : null;
        if (!list || list.some((x) => !UUID.test(x)))
          errors[f.id] = 'Add the photos again';
        else if (list.length > (f.max ?? PHOTO_DEFAULT_MAX))
          errors[f.id] =
            `Add at most ${f.max ?? PHOTO_DEFAULT_MAX} ${(f.max ?? PHOTO_DEFAULT_MAX) === 1 ? 'file' : 'files'}`;
        else if (new Set(list).size !== list.length)
          errors[f.id] = 'The same file was added twice';
        break;
      }
      case 'entity':
        if (typeof v !== 'string' || !UUID.test(v))
          errors[f.id] = 'Choose a record';
        break;
      case 'address': {
        const a = (v ?? {}) as Record<string, string>;
        if (f.required && (isBlank(a.line1) || isBlank(a.postcode)))
          errors[f.id] = 'Enter at least the first line and postcode';
        break;
      }
    }
    if (!errors[f.id])
      clean[f.id] = typeof v === 'string' ? text : (v as AnswerValue);
  }
  return { errors, clean };
}

// -- Editing (pure; shared by the builder and SimpleBot) ------------------------------

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 30);

/** A stable, readable id that is unique within the form. */
export function newFieldId(label: string, definition: FormDefinition): string {
  const base = slug(label) || 'question';
  const taken = new Set(definition.fields.map((f) => f.id));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}_${i}`)) return `${base}_${i}`;
}

export function optionsFromLabels(labels: string[]): FormOption[] {
  const used = new Set<string>();
  return labels.map((label, i) => {
    let id = slug(label) || `option_${i + 1}`;
    if (!/^[a-z0-9]/.test(id)) id = `option_${i + 1}`;
    while (used.has(id)) id = `${id}_${i + 1}`;
    used.add(id);
    return { id, label: label.trim() };
  });
}

/** Sensible starting settings for a new question of a type. */
export function defaultField(
  type: FieldType,
  label: string,
  definition: FormDefinition
): FormField {
  const field: FormField = { id: newFieldId(label, definition), type, label };
  if (isInputType(type)) field.required = false;
  if (CHOICE_TYPES.includes(type))
    field.options = optionsFromLabels(['Option 1', 'Option 2']);
  if (type === 'scale') Object.assign(field, { min: 1, max: 10 });
  if (type === 'photo') field.max = 4;
  if (type === 'entity') field.entity = ENTITY_KINDS[0];
  return field;
}

export function addField(
  definition: FormDefinition,
  field: FormField,
  index = definition.fields.length
): FormDefinition {
  const fields = [...definition.fields];
  fields.splice(Math.max(0, Math.min(index, fields.length)), 0, field);
  return { fields };
}

export function updateField(
  definition: FormDefinition,
  id: string,
  change: Partial<Omit<FormField, 'id'>>
): FormDefinition {
  return {
    fields: definition.fields.map((f) => {
      if (f.id !== id) return f;
      const next: FormField = { ...f, ...change };
      // Keep only the settings that make sense for the (possibly new) type.
      if (!CHOICE_TYPES.includes(next.type)) delete next.options;
      else if (!next.options?.length)
        next.options = optionsFromLabels(['Option 1', 'Option 2']);
      if (!BOUNDED_TYPES.includes(next.type)) {
        delete next.min;
        delete next.max;
      }
      if (next.type === 'photo') {
        delete next.min;
        if (next.max === undefined) next.max = 4;
      }
      if (next.type !== 'entity') delete next.entity;
      else if (!next.entity) next.entity = ENTITY_KINDS[0];
      if (
        next.type === 'scale' &&
        (next.min === undefined || next.max === undefined)
      )
        Object.assign(next, { min: 1, max: 10 });
      if (!isInputType(next.type)) delete next.required;
      for (const key of Object.keys(next) as (keyof FormField)[])
        if (next[key] === undefined) delete next[key];
      return next;
    })
  };
}

/** An id the builder made up before the question had a label. */
export const isPlaceholderId = (id: string) =>
  /^(new_question|new_section|instructions)(_\d+)?$/.test(id);

/**
 * Renames a question's id (and every condition that refers to it). Used while
 * an id is still a placeholder, so saved forms get readable ids. Published
 * revisions keep their own copy, so their responses are unaffected.
 */
export function renameFieldId(
  definition: FormDefinition,
  id: string,
  label: string
): FormDefinition {
  const others: FormDefinition = {
    fields: definition.fields.filter((f) => f.id !== id)
  };
  const next = newFieldId(label, others);
  if (next === id) return definition;
  return {
    fields: definition.fields.map((f) => {
      if (f.id === id) return { ...f, id: next };
      if (f.condition?.field === id)
        return { ...f, condition: { ...f.condition, field: next } };
      return f;
    })
  };
}

const PLACEHOLDER_LABELS = new Set([
  'New question',
  'New section',
  'Instructions'
]);

/** Gives every placeholder id a readable one from its label (on save). */
export function finaliseIds(definition: FormDefinition): FormDefinition {
  let next = definition;
  for (const f of definition.fields) {
    const current = next.fields.find(
      (x) => x.label === f.label && isPlaceholderId(x.id) && x.id === f.id
    );
    if (current && !PLACEHOLDER_LABELS.has(current.label.trim())) {
      next = renameFieldId(next, current.id, current.label);
    }
  }
  return next;
}

/** Removes a question and any conditions that depended on it. */
export function removeField(
  definition: FormDefinition,
  id: string
): FormDefinition {
  return {
    fields: definition.fields
      .filter((f) => f.id !== id)
      .map((f) => {
        if (f.condition?.field !== id) return f;
        const next = { ...f };
        delete next.condition;
        return next;
      })
  };
}

export function duplicateField(
  definition: FormDefinition,
  id: string
): FormDefinition {
  const index = definition.fields.findIndex((f) => f.id === id);
  if (index < 0) return definition;
  const copy = {
    ...definition.fields[index],
    id: newFieldId(definition.fields[index].label, definition)
  };
  delete copy.condition;
  return addField(definition, copy, index + 1);
}

/**
 * Moves a question. A condition may only refer to an EARLIER question, so a
 * move that would break one drops that condition rather than leaving the form
 * invalid.
 */
export function moveField(
  definition: FormDefinition,
  id: string,
  toIndex: number
): FormDefinition {
  const from = definition.fields.findIndex((f) => f.id === id);
  if (from < 0) return definition;
  const fields = [...definition.fields];
  const [moved] = fields.splice(from, 1);
  fields.splice(Math.max(0, Math.min(toIndex, fields.length)), 0, moved);
  const seen = new Set<string>();
  return {
    fields: fields.map((f) => {
      const ok = !f.condition || seen.has(f.condition.field);
      seen.add(f.id);
      if (ok) return f;
      const next = { ...f };
      delete next.condition;
      return next;
    })
  };
}

// -- Operations as data (SimpleBot proposes these; the builder applies the same functions) --

export const fieldInputSchema = z.strictObject({
  type: z.enum(FIELD_TYPES),
  label: z.string().trim().min(1).max(300),
  help: z.string().max(2000).optional(),
  required: z.boolean().optional(),
  options: z.array(z.string().trim().min(1).max(200)).min(1).max(50).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  condition: conditionSchema.optional(),
  entity: z.enum(ENTITY_KINDS).optional()
});
export type FieldInput = z.infer<typeof fieldInputSchema>;

export const draftOperationSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('set_title'),
    title: z.string().trim().min(1).max(200)
  }),
  z.strictObject({
    op: z.literal('set_description'),
    description: z.string().max(4000)
  }),
  z.strictObject({
    op: z.literal('add_field'),
    field: fieldInputSchema,
    /** 1-based position; omit to add at the end. */
    position: z.number().int().min(1).max(101).optional()
  }),
  z.strictObject({
    op: z.literal('update_field'),
    field_id: z.string().regex(ID),
    changes: fieldInputSchema.partial()
  }),
  z.strictObject({
    op: z.literal('remove_field'),
    field_id: z.string().regex(ID)
  }),
  z.strictObject({
    op: z.literal('move_field'),
    field_id: z.string().regex(ID),
    position: z.number().int().min(1).max(100)
  })
]);
export type DraftOperation = z.infer<typeof draftOperationSchema>;

export function fieldFromInput(
  input: FieldInput,
  definition: FormDefinition
): FormField {
  const field = defaultField(input.type, input.label, definition);
  if (input.help) field.help = input.help;
  if (input.required !== undefined && isInputType(input.type))
    field.required = input.required;
  if (input.options && CHOICE_TYPES.includes(input.type))
    field.options = optionsFromLabels(input.options);
  if (input.min !== undefined && input.type !== 'photo') field.min = input.min;
  if (input.max !== undefined) field.max = input.max;
  if (input.condition) field.condition = input.condition;
  if (input.entity && input.type === 'entity') field.entity = input.entity;
  return field;
}

export interface DraftState {
  title: string;
  description: string | null;
  definition: FormDefinition;
}

/** Applies operations in order. Unknown field ids are reported, never guessed. */
export function applyOperations(
  state: DraftState,
  operations: DraftOperation[]
): { ok: true; state: DraftState } | { ok: false; problem: string } {
  let next = { ...state };
  for (const op of operations) {
    const exists = (id: string) =>
      next.definition.fields.some((f) => f.id === id);
    switch (op.op) {
      case 'set_title':
        next = { ...next, title: op.title };
        break;
      case 'set_description':
        next = { ...next, description: op.description.trim() || null };
        break;
      case 'add_field':
        next = {
          ...next,
          definition: addField(
            next.definition,
            fieldFromInput(op.field, next.definition),
            op.position ? op.position - 1 : undefined
          )
        };
        break;
      case 'update_field': {
        if (!exists(op.field_id))
          return {
            ok: false,
            problem: `There is no question with id "${op.field_id}".`
          };
        const { options, ...rest } = op.changes;
        const change: Partial<FormField> = { ...rest };
        if (options) change.options = optionsFromLabels(options);
        next = {
          ...next,
          definition: updateField(next.definition, op.field_id, change)
        };
        break;
      }
      case 'remove_field':
        if (!exists(op.field_id))
          return {
            ok: false,
            problem: `There is no question with id "${op.field_id}".`
          };
        next = {
          ...next,
          definition: removeField(next.definition, op.field_id)
        };
        break;
      case 'move_field':
        if (!exists(op.field_id))
          return {
            ok: false,
            problem: `There is no question with id "${op.field_id}".`
          };
        next = {
          ...next,
          definition: moveField(next.definition, op.field_id, op.position - 1)
        };
        break;
    }
  }
  const problem = definitionProblem(next.definition);
  if (problem)
    return {
      ok: false,
      problem: `${problem.fieldId ? `"${problem.fieldId}": ` : ''}${problem.problem}`
    };
  return { ok: true, state: next };
}

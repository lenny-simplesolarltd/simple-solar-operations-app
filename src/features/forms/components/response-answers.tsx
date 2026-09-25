import { SignatureImage } from './signature-pad';
import {
  isInputType,
  type FormDefinition,
  type FormField,
  isSignaturePath
} from '../definition';

/** Human-readable answer, interpreted with the revision's own field (never today's draft). */
export function formatAnswer(field: FormField, value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  switch (field.type) {
    case 'yes_no':
      return value === true ? 'Yes' : value === false ? 'No' : null;
    case 'confirmation':
      return value === true ? 'Confirmed' : null;
    case 'single_choice':
    case 'dropdown':
      return field.options?.find((o) => o.id === value)?.label ?? String(value);
    case 'multiple_choice':
      return Array.isArray(value)
        ? value
            .map(
              (v) => field.options?.find((o) => o.id === v)?.label ?? String(v)
            )
            .join(', ')
        : null;
    case 'currency':
      return typeof value === 'number'
        ? new Intl.NumberFormat('en-GB', {
            style: 'currency',
            currency: 'GBP'
          }).format(value)
        : null;
    case 'scale':
      return typeof value === 'number'
        ? `${value} out of ${field.max ?? 10}`
        : null;
    case 'date':
      return typeof value === 'string'
        ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'long' }).format(
            new Date(`${value}T12:00:00`)
          )
        : null;
    case 'address': {
      const a = value as Record<string, string>;
      return (
        [a.line1, a.line2, a.town, a.postcode].filter(Boolean).join(', ') ||
        null
      );
    }
    default:
      return String(value);
  }
}

export function ResponseAnswers({
  definition,
  answers
}: {
  definition: FormDefinition;
  answers: Record<string, unknown>;
}) {
  const numbers = new Map(
    definition.fields
      .filter((f) => isInputType(f.type))
      .map((f, i) => [f.id, i + 1])
  );
  const rows = definition.fields.map((field) => {
    if (field.type === 'section') {
      return (
        <h2
          key={field.id}
          className='border-t pt-4 text-base font-semibold first:border-t-0 first:pt-0'
        >
          {field.label}
        </h2>
      );
    }
    if (!isInputType(field.type)) return null;

    // A signature is a drawing, so it is shown as one. Path data read back as
    // text would be a wall of coordinates and would not be a signature at all.
    if (field.type === 'signature') {
      const drawn = answers[field.id];
      const valid = typeof drawn === 'string' && isSignaturePath(drawn);
      return (
        <dl key={field.id} className='flex flex-col gap-1'>
          <dt className='text-muted-foreground text-sm'>
            <span className='tabular-nums'>{numbers.get(field.id)}.</span>{' '}
            {field.label}
          </dt>
          <dd className='text-sm'>
            {valid ? (
              <SignatureImage value={drawn as string} className='max-w-sm' />
            ) : (
              <span className='text-muted-foreground italic'>Not signed</span>
            )}
          </dd>
        </dl>
      );
    }

    const text = formatAnswer(field, answers[field.id]);
    return (
      <dl key={field.id} className='flex flex-col gap-1'>
        <dt className='text-muted-foreground text-sm'>
          <span className='tabular-nums'>{numbers.get(field.id)}.</span>{' '}
          {field.label}
        </dt>
        <dd
          className={
            text
              ? 'text-sm whitespace-pre-wrap'
              : 'text-muted-foreground text-sm italic'
          }
        >
          {/* Rendered as text: nothing a recipient typed is ever interpreted as markup. */}
          {text ?? 'Not answered'}
        </dd>
      </dl>
    );
  });
  return (
    <div className='bg-card flex flex-col gap-4 rounded-lg border p-5'>
      {rows}
    </div>
  );
}

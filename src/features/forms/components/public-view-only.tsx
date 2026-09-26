import { Button } from '@/components/ui/button';
import { FIELD_TYPE_INFO, type FormDefinition } from '../definition';
import type { CompletionRoute } from '../server/public';
import Link from 'next/link';

/**
 * A form link whose questions need an account: shown, not asked.
 *
 * The three people who open this URL want different things, and the page
 * answers each of them rather than showing one message that suits none:
 *
 *   a visitor with no account  what the job asks for, and how to get access
 *   staff who hold the work    a way straight to where they do it
 *   staff who do not           who to ask, instead of a wall
 *
 * Nothing here is an input. The questions are listed so somebody can see what
 * will be asked - which is the whole reason the link exists - and the answers
 * are collected in the app, where an upload has an owner and a lookup has
 * something to search.
 */
export function PublicViewOnly({
  title,
  description,
  definition,
  signedIn,
  route
}: {
  title: string;
  description: string | null;
  definition: FormDefinition;
  signedIn: boolean;
  route: CompletionRoute | null;
}) {
  const questions = definition.fields.filter(
    (f) => f.type !== 'section' && f.type !== 'info'
  );

  return (
    <div className='flex flex-col gap-6 py-4'>
      <div className='flex flex-col gap-2'>
        <h1 className='text-xl font-bold'>{title}</h1>
        {description && (
          <p className='text-muted-foreground text-sm'>{description}</p>
        )}
      </div>

      {route ? (
        <div className='bg-info-soft flex flex-col gap-3 rounded-lg p-4'>
          <div>
            <p className='text-info font-semibold'>You can record this</p>
            <p className='text-sm'>
              {route.context}
              {route.programmeName && ` (${route.programmeName})`}
            </p>
          </div>
          <Button asChild className='self-start'>
            <Link href={route.href}>
              {route.kind === 'programme' ? 'Record a visit' : 'Open the form'}
            </Link>
          </Button>
        </div>
      ) : signedIn ? (
        <div className='bg-warning-soft text-warning rounded-lg p-4 text-sm'>
          <p className='font-semibold'>You cannot record this yet</p>
          <p>
            You are signed in, but this work has not been given to you. Ask the
            office to add you to the programme, then open this link again.
          </p>
        </div>
      ) : (
        <div className='bg-muted flex flex-col gap-3 rounded-lg p-4'>
          <div>
            <p className='font-semibold'>This form is filled in the app</p>
            <p className='text-muted-foreground text-sm'>
              It asks for photographs and for the property you attended, which
              need a signed-in account. Sign in to record it. If you do not have
              an account, ask the office for one.
            </p>
          </div>
          <Button asChild className='self-start'>
            <Link href='/auth/sign-in'>Sign in</Link>
          </Button>
        </div>
      )}

      <section className='flex flex-col gap-2'>
        <h2 className='text-sm font-semibold tracking-wide uppercase'>
          What you will be asked
        </h2>
        <ol className='divide-y rounded-lg border'>
          {questions.map((field, i) => (
            <li key={field.id} className='flex gap-3 px-4 py-3'>
              <span className='text-muted-foreground text-sm tabular-nums'>
                {i + 1}.
              </span>
              <span className='flex min-w-0 flex-col'>
                <span className='text-sm font-medium'>
                  {field.label}
                  {field.required && (
                    <span className='text-destructive' aria-label='required'>
                      {' '}
                      *
                    </span>
                  )}
                </span>
                <span className='text-muted-foreground text-xs'>
                  {FIELD_TYPE_INFO[field.type]?.label ?? field.type}
                </span>
              </span>
            </li>
          ))}
        </ol>
        <p className='text-muted-foreground text-xs'>
          {questions.length} question{questions.length === 1 ? '' : 's'}. This
          page shows what the form asks; it does not collect answers.
        </p>
      </section>
    </div>
  );
}

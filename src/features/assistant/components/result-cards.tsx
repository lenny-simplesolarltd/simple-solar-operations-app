import { TaskStatusBadge } from '@/components/task-status-badge';
import { Badge } from '@/components/ui/badge';
import { dueState, formatDateTime } from '@/features/jobs/format';
import { cn } from '@/lib/utils';
import { IconChevronRight } from '@tabler/icons-react';
import Link from 'next/link';
import type {
  DisplayCard,
  FileCardData,
  HelpCardArticle,
  JobCardData,
  ProgrammeCandidate,
  TaskCardData
} from '../protocol';
import { FormCardBody, FormLinkRow } from './form-cards';
import {
  ProgrammeCandidateRow,
  ProgrammePropertyBody,
  ProgrammeReviewBody,
  ProgrammeSummaryBody,
  ProgrammeVisitBody
} from './programme-cards';

// Structured tool results. These show exactly what the application returned,
// so staff can check the assistant's wording against the data.

function CardShell({
  title,
  meta,
  children,
  collapsible = false,
  preview
}: {
  title: string;
  meta?: string;
  children: React.ReactNode;
  /**
   * Reference material - what was consulted on the way to an answer - folds
   * away so it cannot push the answer off the screen. Anything the person
   * asked for stays open.
   */
  collapsible?: boolean;
  /** One line naming what is inside, shown while it is folded. */
  preview?: string;
}) {
  const header = (
    <>
      <h3 className='min-w-0 truncate text-xs font-semibold'>{title}</h3>
      {meta && (
        <span className='text-muted-foreground shrink-0 text-xs'>{meta}</span>
      )}
    </>
  );
  if (!collapsible) {
    return (
      <div className='bg-background overflow-hidden rounded-lg border'>
        <div className='flex items-baseline justify-between gap-3 border-b px-3 py-2'>
          {header}
        </div>
        {children}
      </div>
    );
  }
  // <details> rather than state: it is keyboard and screen-reader behaviour
  // for free, and it survives re-renders while a turn is still streaming.
  return (
    <details className='bg-background group/card overflow-hidden rounded-lg border'>
      <summary className='hover:bg-muted/50 flex cursor-pointer list-none items-baseline justify-between gap-3 px-3 py-2 marker:hidden'>
        <span className='flex min-w-0 items-baseline gap-1.5'>
          <IconChevronRight
            className='size-3 shrink-0 self-center transition-transform group-open/card:rotate-90'
            aria-hidden
          />
          {header}
        </span>
      </summary>
      {preview && (
        <p className='text-muted-foreground truncate px-3 pb-2 text-xs group-open/card:hidden'>
          {preview}
        </p>
      )}
      <div className='border-t'>{children}</div>
    </details>
  );
}

function HelpRow({
  article,
  onNavigate
}: {
  article: HelpCardArticle;
  onNavigate?: () => void;
}) {
  return (
    <li className='flex items-start justify-between gap-2 px-3 py-2'>
      <div className='min-w-0'>
        <p className='text-sm font-medium'>{article.title}</p>
        {!article.switchedOn && (
          <p className='text-warning text-xs'>Not switched on yet</p>
        )}
      </div>
      <Link
        href={article.href}
        onClick={onNavigate}
        className='hover:bg-accent focus-visible:ring-ring -mr-1 inline-flex shrink-0 items-center gap-0.5 rounded-md py-1 pr-1 pl-2 text-xs font-medium outline-none focus-visible:ring-2'
      >
        Open guide
        <span className='sr-only'> {article.title}</span>
        <IconChevronRight aria-hidden className='size-3.5' />
      </Link>
    </li>
  );
}

function ViewJobLink({
  job,
  onNavigate
}: {
  job: Pick<JobCardData, 'id' | 'jobRef'>;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={`/dashboard/jobs/${job.id}`}
      onClick={onNavigate}
      className='hover:bg-accent focus-visible:ring-ring -mr-1 inline-flex shrink-0 items-center gap-0.5 rounded-md py-1 pr-1 pl-2 text-xs font-medium outline-none focus-visible:ring-2'
    >
      View job
      <span className='sr-only'> {job.jobRef}</span>
      <IconChevronRight aria-hidden className='size-3.5' />
    </Link>
  );
}

function JobRow({
  job,
  onNavigate
}: {
  job: JobCardData;
  onNavigate?: () => void;
}) {
  return (
    <li className='flex items-center justify-between gap-3 px-3 py-2'>
      <div className='min-w-0'>
        <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
          <span className='font-mono text-xs font-semibold'>{job.jobRef}</span>
          <Badge variant='secondary' className='px-2 py-0 text-[11px]'>
            {job.workflowStage}
          </Badge>
        </div>
        <p className='truncate text-sm'>
          {job.customerName}
          <span className='text-muted-foreground'> · {job.postcode}</span>
        </p>
      </div>
      <ViewJobLink job={job} onNavigate={onNavigate} />
    </li>
  );
}

function TaskRow({
  task,
  showJob,
  onNavigate
}: {
  task: TaskCardData;
  showJob: boolean;
  onNavigate?: () => void;
}) {
  const due = dueState(task.dueAt);
  return (
    <li className='flex flex-col gap-1 px-3 py-2'>
      <div className='flex items-start justify-between gap-2'>
        <p className='min-w-0 text-sm'>
          <span className='font-mono text-xs font-semibold'>{task.code}</span>{' '}
          {task.title}
        </p>
        <TaskStatusBadge status={task.status} />
      </div>
      <p className='text-muted-foreground flex flex-wrap gap-x-2 text-xs'>
        <span
          className={cn(
            due === 'overdue' && 'text-destructive font-medium',
            due === 'today' && 'text-warning font-medium'
          )}
        >
          {task.dueAt
            ? `${formatDateTime(task.dueAt)}${due === 'overdue' ? ' · overdue' : due === 'today' ? ' · today' : ''}`
            : 'No due date'}
        </span>
        <span>· {task.ownerName}</span>
        {showJob && task.jobId && task.jobRef && (
          <Link
            href={`/dashboard/jobs/${task.jobId}`}
            onClick={onNavigate}
            className='text-foreground decoration-primary font-mono font-semibold underline decoration-2 underline-offset-2'
          >
            {task.jobRef}
          </Link>
        )}
      </p>
      {task.blockingReason && (
        <p className='text-destructive text-xs'>{task.blockingReason}</p>
      )}
    </li>
  );
}

function FileRow({
  file,
  showJob,
  onNavigate
}: {
  file: FileCardData;
  showJob: boolean;
  onNavigate?: () => void;
}) {
  const link =
    'hover:bg-accent focus-visible:ring-ring inline-flex shrink-0 items-center rounded-md px-1.5 py-1 text-xs font-medium outline-none focus-visible:ring-2';
  return (
    <li className='flex flex-col gap-1 px-3 py-2'>
      <div className='flex items-start justify-between gap-2'>
        <p className='min-w-0 truncate text-sm font-medium'>{file.filename}</p>
        <div className='-mr-1 flex shrink-0 items-center'>
          {/* Opens a one-minute signed link; the route re-checks access. */}
          <a
            href={`/api/evidence/${file.id}`}
            target='_blank'
            rel='noopener noreferrer'
            className={link}
          >
            Open<span className='sr-only'> {file.filename}</span>
          </a>
          <a href={`/api/evidence/${file.id}?download=1`} className={link}>
            Download<span className='sr-only'> {file.filename}</span>
          </a>
        </div>
      </div>
      <p className='text-muted-foreground flex flex-wrap gap-x-2 text-xs'>
        <span>{file.category}</span>
        {file.addedAt && <span>· {formatDateTime(file.addedAt)}</span>}
        {file.addedBy && <span>· {file.addedBy}</span>}
        {showJob && file.jobId && file.jobRef && (
          <Link
            href={`/dashboard/jobs/${file.jobId}?tab=files`}
            onClick={onNavigate}
            className='text-foreground decoration-primary font-mono font-semibold underline decoration-2 underline-offset-2'
          >
            {file.jobRef}
          </Link>
        )}
      </p>
    </li>
  );
}

const count = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

export function ResultCard({
  card,
  onNavigate,
  onSelectCandidate
}: {
  card: DisplayCard;
  /** Called when a link inside the card is followed (the mobile sheet closes). */
  onNavigate?: () => void;
  /**
   * Called when somebody picks one of an ambiguous search's candidates. It is
   * handed the canonical id and a message naming the property in words; what
   * it does with them is the drawer's business, and it is never a write.
   */
  onSelectCandidate?: (candidate: ProgrammeCandidate, prompt: string) => void;
}) {
  switch (card.kind) {
    case 'form':
      return (
        <CardShell title={card.form.kind === 'template' ? 'Template' : 'Form'}>
          <FormCardBody
            form={card.form}
            note={card.note}
            onNavigate={onNavigate}
          />
        </CardShell>
      );

    case 'form_list':
      return (
        <CardShell title={card.title} meta={count(card.total, 'item')}>
          {card.forms.length === 0 ? (
            <p className='text-muted-foreground px-3 py-3 text-sm'>None yet.</p>
          ) : (
            <ul className='divide-y'>
              {card.forms.map((form) => (
                <li key={form.id}>
                  <FormCardBody form={form} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          )}
        </CardShell>
      );

    case 'form_links':
      return (
        <CardShell title={card.title} meta={count(card.total, 'link')}>
          {card.links.length === 0 ? (
            <p className='text-muted-foreground px-3 py-3 text-sm'>No links.</p>
          ) : (
            <ul className='divide-y'>
              {card.links.map((link) => (
                <FormLinkRow
                  key={link.invitationId}
                  link={link}
                  onNavigate={onNavigate}
                />
              ))}
            </ul>
          )}
        </CardShell>
      );

    case 'job_list':
      return (
        <CardShell
          title={`Jobs matching “${card.query}”`}
          meta={
            card.total > card.jobs.length
              ? `${card.jobs.length} of ${card.total}+`
              : count(card.jobs.length, 'match', 'matches')
          }
        >
          {card.jobs.length === 0 ? (
            <p className='text-muted-foreground px-3 py-3 text-sm'>
              No job you have access to matched.
            </p>
          ) : (
            <ul className='divide-y'>
              {card.jobs.map((job) => (
                <JobRow key={job.id} job={job} onNavigate={onNavigate} />
              ))}
            </ul>
          )}
        </CardShell>
      );

    case 'job_summary':
      return (
        <CardShell title='Job' meta={card.job.jobRef}>
          <ul>
            <JobRow job={card.job} onNavigate={onNavigate} />
          </ul>
          <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t px-3 py-2 text-xs'>
            {card.facts.map((fact) => (
              <div key={fact.label} className='contents'>
                <dt className='text-muted-foreground'>{fact.label}</dt>
                <dd className='text-right font-medium'>{fact.value}</dd>
              </div>
            ))}
          </dl>
          <div className='flex flex-wrap gap-1.5 border-t px-3 py-2'>
            <Badge variant='secondary'>
              {count(card.taskCounts.open, 'open task')}
            </Badge>
            {card.taskCounts.blocked > 0 && (
              <Badge variant='danger'>{card.taskCounts.blocked} blocked</Badge>
            )}
            {card.taskCounts.overdue > 0 && (
              <Badge variant='warning'>{card.taskCounts.overdue} overdue</Badge>
            )}
          </div>
        </CardShell>
      );

    case 'task_list': {
      // A list for one job already names it in the title.
      const showJob = new Set(card.tasks.map((t) => t.jobId)).size > 1;
      return (
        <CardShell title={card.title} meta={count(card.total, 'task')}>
          {card.tasks.length === 0 ? (
            <p className='text-muted-foreground px-3 py-3 text-sm'>
              Nothing here.
            </p>
          ) : (
            <ul className='divide-y'>
              {card.tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  showJob={showJob}
                  onNavigate={onNavigate}
                />
              ))}
            </ul>
          )}
          {card.total > card.tasks.length && (
            <p className='text-muted-foreground border-t px-3 py-2 text-xs'>
              Showing {card.tasks.length} of {card.total}.{' '}
              <Link
                href='/dashboard/tasks'
                onClick={onNavigate}
                className='text-foreground decoration-primary underline decoration-2 underline-offset-2'
              >
                Open Tasks
              </Link>{' '}
              for the full list.
            </p>
          )}
        </CardShell>
      );
    }

    case 'help_articles':
      return (
        <CardShell
          title={card.title}
          collapsible
          preview={card.articles.map((a) => a.title).join(' · ')}
          meta={
            card.articles.length
              ? count(card.articles.length, 'guide')
              : undefined
          }
        >
          {card.articles.length ? (
            <ul className='divide-y'>
              {card.articles.map((a) => (
                <HelpRow key={a.href} article={a} onNavigate={onNavigate} />
              ))}
            </ul>
          ) : (
            <p className='text-muted-foreground px-3 py-2 text-xs'>
              Nothing in the Help Center matched.{' '}
              <Link
                href='/dashboard/help'
                onClick={onNavigate}
                className='underline'
              >
                Search the Help Center
              </Link>
            </p>
          )}
        </CardShell>
      );

    case 'help_article':
      return (
        <CardShell
          title='Help Center guide'
          collapsible
          preview={card.article.title}
        >
          <ul className='divide-y'>
            <HelpRow article={card.article} onNavigate={onNavigate} />
          </ul>
          {card.related.length > 0 && (
            <p className='text-muted-foreground border-t px-3 py-2 text-xs'>
              Related:{' '}
              {card.related.map((r, i) => (
                <span key={r.href}>
                  {i > 0 && ' · '}
                  <Link
                    href={r.href}
                    onClick={onNavigate}
                    className='underline'
                  >
                    {r.title}
                  </Link>
                </span>
              ))}
            </p>
          )}
        </CardShell>
      );

    case 'file_list': {
      const showJob = new Set(card.files.map((f) => f.jobId)).size > 1;
      return (
        <CardShell
          title={card.title}
          meta={
            card.total > card.files.length
              ? `${card.files.length} of ${card.total}`
              : count(card.total, 'file')
          }
        >
          {card.files.length === 0 ? (
            <p className='text-muted-foreground px-3 py-3 text-sm'>
              No files you have access to matched.
            </p>
          ) : (
            <ul className='divide-y'>
              {card.files.map((file) => (
                <FileRow
                  key={file.id}
                  file={file}
                  showJob={showJob}
                  onNavigate={onNavigate}
                />
              ))}
            </ul>
          )}
          <p className='text-muted-foreground border-t px-3 py-2 text-xs'>
            Files open with a link that works for 60 seconds.{' '}
            <Link
              href='/dashboard/files'
              onClick={onNavigate}
              className='text-foreground decoration-primary underline decoration-2 underline-offset-2'
            >
              Files & documents
            </Link>
          </p>
        </CardShell>
      );
    }

    case 'programme_summary':
      return (
        <CardShell title='Programme' meta={card.programme.code}>
          <ProgrammeSummaryBody programme={card.programme} />
        </CardShell>
      );

    case 'programme_property':
      return (
        <CardShell title='Property'>
          <ProgrammePropertyBody property={card.property} />
        </CardShell>
      );

    case 'programme_visit':
      return (
        <CardShell title='Visit'>
          <ProgrammeVisitBody visit={card.visit} />
        </CardShell>
      );

    case 'programme_review_item':
      return (
        <CardShell title='Visit review'>
          <ProgrammeReviewBody
            visit={card.visit}
            reviewStatus={card.reviewStatus}
            evidenceCount={card.evidenceCount}
            reviewReasons={card.reviewReasons}
          />
        </CardShell>
      );

    case 'programme_candidates':
      return (
        <CardShell
          title={card.title}
          meta={
            card.total > card.candidates.length
              ? `${card.candidates.length} of ${card.total}`
              : count(card.total, 'match', 'matches')
          }
        >
          {card.candidates.length === 0 ? (
            <p className='text-muted-foreground px-3 py-3 text-sm'>
              Nothing you have access to matched.
            </p>
          ) : (
            <ul className='divide-y'>
              {card.candidates.map((candidate) => (
                <ProgrammeCandidateRow
                  key={candidate.id}
                  candidate={candidate}
                  target={card.target}
                  onSelect={onSelectCandidate}
                />
              ))}
            </ul>
          )}
          {card.total > card.candidates.length && (
            <p className='text-muted-foreground border-t px-3 py-2 text-xs'>
              Showing {card.candidates.length} of {card.total}. Narrow the
              search, or ask for the next page.
            </p>
          )}
        </CardShell>
      );

    case 'workflow':
      return (
        <CardShell title={card.title} meta={count(card.steps.length, 'step')}>
          <ol className='divide-y'>
            {card.steps.map((step) => (
              <li key={step.label} className='px-3 py-2'>
                <p className='text-sm font-medium'>{step.label}</p>
                {step.detail && (
                  <p className='text-muted-foreground text-xs'>{step.detail}</p>
                )}
              </li>
            ))}
          </ol>
          {card.footnote && (
            <p className='text-muted-foreground border-t px-3 py-2 text-xs'>
              {card.footnote}
            </p>
          )}
        </CardShell>
      );
  }
}

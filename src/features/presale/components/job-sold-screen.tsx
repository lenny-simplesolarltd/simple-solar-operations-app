'use client';

import Link from 'next/link';

import { type FinanceRoute, type JobSoldResult } from '../contract';
import { fmt, formatDue, moneyFromPence } from '../lib/format';
import { Card } from './ui/card';

const FINANCE_LABELS: Record<FinanceRoute, string> = {
  Standard: 'No finance',
  Phoenix: 'Phoenix finance',
  OtherReview: 'Other finance'
};

/** What was just sold, as the wizard held it at the moment of submitting. */
export interface SoldSummary {
  systemKwp: number | null;
  netPanels: number | null;
  panelName: string | null;
  agreedPricePence: number | null;
  financeRoute: FinanceRoute | null;
}

export interface JobSoldScreenProps {
  result: JobSoldResult;
  onStartAnother: () => void;
  summary?: SoldSummary;
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className='sold-fact'>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

export function JobSoldScreen({
  result,
  onStartAnother,
  summary
}: JobSoldScreenProps) {
  const tasks = [...result.tasks].sort((a, b) => a.priority - b.priority);
  return (
    <section aria-label='Job sold' className='sold-screen'>
      <div className='sold-hero' role='status'>
        <h1>JOB SOLD</h1>
        <div className='sold-ref'>{result.job_ref}</div>
        <div className='sold-customer'>
          {result.customer.display_name} · {result.customer.postcode}
        </div>
        {result.replay ? (
          <p className='sold-note'>
            This sale had already been recorded — showing the original result.
          </p>
        ) : null}
      </div>

      {summary ? (
        <dl className='sold-facts'>
          <Fact
            k='System'
            v={
              summary.systemKwp !== null
                ? `${fmt(summary.systemKwp, 2)} kWp${summary.netPanels !== null ? ` · ${summary.netPanels} panels` : ''}`
                : '—'
            }
          />
          <Fact k='Panel' v={summary.panelName ?? '—'} />
          <Fact
            k='Agreed price'
            v={
              summary.agreedPricePence !== null
                ? moneyFromPence(summary.agreedPricePence)
                : '—'
            }
          />
          <Fact
            k='Finance'
            v={
              summary.financeRoute ? FINANCE_LABELS[summary.financeRoute] : '—'
            }
          />
        </dl>
      ) : null}

      <Card title='What happens next'>
        {tasks.length ? (
          <ol className='task-list'>
            {tasks.map((task) => (
              <li className='task-item' key={`${task.code}-${task.title}`}>
                <div className='task-top'>
                  <span className='task-code'>{task.code}</span>
                  <span className='task-title'>{task.title}</span>
                </div>
                <div className='task-meta'>
                  <span>
                    Owner: {task.owner_name}
                    {task.backup_name ? ` (backup: ${task.backup_name})` : ''}
                  </span>
                  <span>Due: {formatDue(task.due_at)}</span>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className='hint' style={{ margin: 0 }}>
            No follow-up tasks were created for this job.
          </p>
        )}
      </Card>

      <div className='sold-actions'>
        <Link
          href={`/dashboard/jobs/${result.job_id}`}
          className='btn btn-primary'
        >
          View job
        </Link>
        <Link href='/dashboard/presales' className='btn btn-secondary'>
          Back to presales
        </Link>
        <button
          type='button'
          className='btn btn-secondary'
          onClick={onStartAnother}
        >
          Start another presale
        </button>
      </div>
    </section>
  );
}

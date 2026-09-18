'use client';

import Link from 'next/link';

import { type JobSoldResult } from '../contract';
import { formatDue } from '../lib/format';
import { Card } from './ui/card';

export interface JobSoldScreenProps {
  result: JobSoldResult;
  onStartAnother: () => void;
}

export function JobSoldScreen({ result, onStartAnother }: JobSoldScreenProps) {
  const tasks = [...result.tasks].sort((a, b) => a.priority - b.priority);
  return (
    <section aria-label='Job sold'>
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

      <div className='nav-row'>
        <button
          type='button'
          className='btn btn-primary'
          onClick={onStartAnother}
        >
          Start another presale
        </button>
      </div>
      <div className='nav-row' style={{ marginTop: 10 }}>
        <Link
          href='/dashboard/presales'
          className='btn btn-secondary btn-block'
        >
          My presales
        </Link>
      </div>
    </section>
  );
}

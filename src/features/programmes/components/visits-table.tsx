import Link from 'next/link';
import {
  DISPOSITION_LABEL,
  OUTCOME_SHORT,
  PORTAL_LABEL,
  propertyAddress
} from '../labels';
import type { ProgrammeVisit } from '../types';
import { DispositionBadge, SignalBadge } from './badges';

/**
 * All visits, as a table.
 *
 * The board is for working through the queue; this is for finding one visit and
 * for checking totals. Both read the same rows through the same filters, so they
 * always agree.
 */
export function VisitsTable({
  visits,
  basePath
}: {
  visits: ProgrammeVisit[];
  basePath: string;
}) {
  if (visits.length === 0)
    return (
      <p className='text-muted-foreground py-8 text-center text-sm'>
        No visits match these filters.
      </p>
    );

  return (
    <div className='overflow-x-auto rounded-lg border'>
      <table className='w-full text-sm'>
        <caption className='sr-only'>
          Programme visits, newest first. {visits.length} rows.
        </caption>
        <thead className='bg-muted/50'>
          <tr className='text-left'>
            {[
              'Date',
              'Property',
              'Property ID',
              'Installer',
              'Outcome',
              'Meter serial',
              'Reading',
              'SIM serial',
              'CSQ',
              'Portal',
              'Status'
            ].map((h) => (
              <th key={h} scope='col' className='px-3 py-2 font-medium'>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visits.map((v) => (
            <tr key={v.id} className='hover:bg-muted/30 border-t align-top'>
              <td className='px-3 py-2 whitespace-nowrap tabular-nums'>
                {v.visitDate ?? '—'}
              </td>
              <td className='px-3 py-2'>
                <Link
                  href={`${basePath}/visits/${v.id}`}
                  className='font-medium hover:underline'
                >
                  {propertyAddress(v.property) || 'Unknown property'}
                </Link>
              </td>
              <td className='px-3 py-2 tabular-nums'>
                {v.property.externalRef}
              </td>
              <td className='px-3 py-2'>{v.installerName ?? '—'}</td>
              <td className='px-3 py-2'>
                {v.outcome ? OUTCOME_SHORT[v.outcome] : '—'}
              </td>
              <td className='px-3 py-2'>
                {v.actualMeterSerial ?? '—'}
                {v.meterSerialMatches === false && (
                  <span className='text-destructive block text-xs font-semibold'>
                    MISMATCH (expected {v.property.expectedMeterSerial})
                  </span>
                )}
              </td>
              <td className='px-3 py-2 tabular-nums'>
                {v.meterReading ?? '—'}
              </td>
              <td className='px-3 py-2'>{v.newSimSerial ?? '—'}</td>
              <td className='px-3 py-2'>
                <SignalBadge signal={v.signalClassification} csq={v.csq} />
              </td>
              <td className='px-3 py-2 text-xs'>
                {v.portalVerification
                  ? PORTAL_LABEL[v.portalVerification]
                  : v.portalCheckRequired
                    ? 'Not checked'
                    : '—'}
              </td>
              <td className='px-3 py-2'>
                <DispositionBadge disposition={v.disposition} />
                {v.actionNote && (
                  <span className='text-muted-foreground mt-1 block text-xs'>
                    {v.actionNote}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className='text-muted-foreground border-t px-3 py-2 text-xs'>
        {visits.length} {visits.length === 1 ? 'visit' : 'visits'}. Every status
        shown was set through an audited review;{' '}
        {DISPOSITION_LABEL.CompleteAndWorking} additionally required the office
        to confirm the meter live in the PCH portal.
      </p>
    </div>
  );
}

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type {
  ReadinessState,
  ReleaseReadiness
} from '@/lib/backend/admin-models';
import Link from 'next/link';

// R1 readiness (app.release_readiness): the conditions to meet before R1 is
// switched on - the new stack's version of the old S20 release contract.
// Unknown is never a pass.

const STATE: Record<ReadinessState, 'success' | 'danger' | 'outline'> = {
  Pass: 'success',
  Fail: 'danger',
  Unknown: 'outline'
};

export function ReadinessCard({
  readiness,
  link
}: {
  readiness: ReleaseReadiness;
  link?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex flex-wrap items-center justify-between gap-2 text-base'>
          R1 go-live readiness
          <Badge variant={readiness.ready ? 'success' : 'warning'}>
            {readiness.ready
              ? 'Ready'
              : `Not ready · ${readiness.counts.Fail ?? 0} failing · ${readiness.counts.Unknown ?? 0} unknown`}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className='flex flex-col gap-3 text-sm'>
        <ul className='flex flex-col gap-2'>
          {readiness.items.map((i) => (
            <li
              key={i.key}
              className='flex items-start justify-between gap-3 border-b pb-2 last:border-b-0'
            >
              <span>
                <span className='font-medium'>{i.label}</span>
                {i.detail && (
                  <span className='text-muted-foreground block text-xs'>
                    {i.detail}
                  </span>
                )}
              </span>
              <Badge variant={STATE[i.state]}>{i.state}</Badge>
            </li>
          ))}
        </ul>
        <div>
          <p className='font-medium'>Also needed outside the app</p>
          <ul className='text-muted-foreground list-disc pl-5 text-xs'>
            {readiness.external_prerequisites.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
        {link && (
          <Link
            href='/dashboard/release'
            className='text-sm underline underline-offset-4'
          >
            Open Release control
          </Link>
        )}
      </CardContent>
    </Card>
  );
}

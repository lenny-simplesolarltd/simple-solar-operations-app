import PageContainer from '@/components/layout/page-container';
import { Heading } from '@/components/ui/heading';
import { AssistantPageContext } from '@/features/assistant/components/page-context';
import { PlannerBoard } from '@/features/planner/components/planner-board';
import {
  isViewId,
  today,
  type ViewId
} from '@/features/planner/calendar/range';
import { getCurrentUser } from '@/lib/auth';
import { isOfficeClass } from '@/lib/roles';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Planner | Simple Solar Operations'
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) =>
  ((Array.isArray(v) ? v[0] : v) ?? '').trim();
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Three weeks is the default.
 *
 * It is the window the backend's own planner read was built around
 * (PLANNER_3_WEEKS is the canonical R1 read, and RP_TEAM_PLANNER defaults to
 * three weeks too), and it is the horizon the office actually works to:
 * scaffold goes up before an install and comes down after it, so a single
 * week rarely shows a whole job.
 */
const DEFAULT_VIEW: ViewId = '3w';

export default async function PlannerPage({
  searchParams
}: {
  searchParams: SearchParams;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  const params = await searchParams;

  const requested = first(params.view);
  const view = isViewId(requested) ? requested : DEFAULT_VIEW;
  const from = first(params.from);
  const anchor = DATE.test(from) ? from : today();

  return (
    <PageContainer>
      <AssistantPageContext
        page={{ kind: 'operations', surface: 'planner', view }}
      />
      <div className='flex w-full flex-col gap-4'>
        <Heading
          title='Planner'
          description='Everything scheduled, in date order. Drag work to move it or hand it to someone else - each change is checked against leave, skills and capacity before anything is saved.'
        />
        <PlannerBoard
          canPlan={isOfficeClass(user)}
          initialView={view}
          initialAnchor={anchor}
        />
      </div>
    </PageContainer>
  );
}

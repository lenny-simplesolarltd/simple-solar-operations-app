import PageContainer from '@/components/layout/page-container';
import { ReadFailureState } from '@/components/read-failure';
import { Heading } from '@/components/ui/heading';
import { AssistantPageContext } from '@/features/assistant/components/page-context';
import { ListFilters } from '@/features/operations/list-filters';
import { PlannerList } from '@/features/planner/components/planner-list';
import { TeamBoard } from '@/features/planner/components/team-board';
import type { PlannerRead, TeamPlannerRead } from '@/features/planner/types';
import { getCurrentUser } from '@/lib/auth';
import { readOps, readR1 } from '@/lib/backend/read';
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

const VIEWS = [
  { value: '3w', label: '3 weeks' },
  { value: '6w', label: '6 weeks' },
  { value: 'board', label: 'Team board' }
];

export default async function PlannerPage({
  searchParams
}: {
  searchParams: SearchParams;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  const params = await searchParams;
  const view = VIEWS.some((v) => v.value === first(params.view))
    ? first(params.view)
    : '3w';
  const from = DATE.test(first(params.from)) ? first(params.from) : undefined;

  const planner =
    view === 'board'
      ? null
      : await readR1<PlannerRead>(
          view === '6w' ? 'PLANNER_6_WEEKS' : 'PLANNER_3_WEEKS',
          { as_of: from }
        );
  const board =
    view === 'board'
      ? await readOps<TeamPlannerRead>('RP_TEAM_PLANNER', { start: from })
      : null;

  return (
    <PageContainer>
      <AssistantPageContext
        page={{
          kind: 'operations',
          surface: 'planner',
          view: VIEWS.find((v) => v.value === view)?.label
        }}
      />
      <div className='flex w-full flex-col gap-4'>
        <Heading
          title='Planner'
          description='Installs and scaffold in date order. Allocate, change or move work from a row; each change is checked against leave, skills and capacity.'
        />
        <ListFilters
          defaults={{ view: '3w' }}
          tabs={{ key: 'view', label: 'Planner view', options: VIEWS }}
          selects={[]}
        />
        {planner &&
          (planner.ok ? (
            <PlannerList data={planner.data} canPlan={isOfficeClass(user)} />
          ) : (
            <ReadFailureState failure={planner.error} />
          ))}
        {board &&
          (board.ok ? (
            <TeamBoard data={board.data} />
          ) : (
            <ReadFailureState failure={board.error} />
          ))}
      </div>
    </PageContainer>
  );
}

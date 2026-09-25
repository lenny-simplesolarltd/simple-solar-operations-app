import PageContainer from '@/components/layout/page-container';
import { ReviewPanel } from '@/features/programmes/components/review-panel';
import {
  ProgrammeShell,
  ProgrammesNotEnabled
} from '@/features/programmes/components/shell';
import {
  currentAccess,
  getProgramme,
  getVisit,
  programmesEnabled,
  visitEvidence
} from '@/features/programmes/server/queries';
import { propertyAddress } from '@/features/programmes/labels';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Visit | Simple Solar Operations'
};

/** One visit in full: what was recorded, its evidence, and its review. */
export default async function VisitPage({
  params
}: {
  params: Promise<{ programmeId: string; visitId: string }>;
}) {
  const session = await currentAccess();
  if (!session) redirect('/auth/sign-in');
  if (!(await programmesEnabled()))
    return (
      <PageContainer>
        <ProgrammesNotEnabled />
      </PageContainer>
    );

  const { programmeId, visitId } = await params;
  const [programme, visit] = await Promise.all([
    getProgramme(programmeId),
    getVisit(visitId)
  ]);
  // RLS already decided what this person may see; a visit they may not see, and
  // one that does not exist, are the same answer.
  if (!programme || !visit || visit.programmeId !== programmeId) notFound();

  const evidence = await visitEvidence(visit.id);

  return (
    <PageContainer>
      <ProgrammeShell
        programme={programme}
        access={session.access}
        current='/visits'
        description={`${propertyAddress(visit.property)} · ${visit.property.externalRef}`}
      >
        <ReviewPanel
          visit={visit}
          evidence={evidence}
          signalConfig={programme.signalConfig}
          canReview={session.access.review}
        />
      </ProgrammeShell>
    </PageContainer>
  );
}

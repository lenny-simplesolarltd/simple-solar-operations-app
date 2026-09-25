import { propertyAddress } from '@/features/programmes/labels';
import { ReviewPanel } from '@/features/programmes/components/review-panel';
import { VisitModal } from '@/features/programmes/components/visit-modal';
import {
  currentAccess,
  getProgramme,
  getVisit,
  programmesEnabled,
  visitEvidence
} from '@/features/programmes/server/queries';
import { notFound, redirect } from 'next/navigation';

/**
 * A visit opened from the board.
 *
 * This intercepts /visits/[visitId] only when the person arrived from the board;
 * a refresh, a bookmark or a pasted URL gets the real page. So the checks here
 * are the page's checks, not lighter ones - an interception must never be a way
 * to see something the page would refuse.
 */
export default async function BoardVisitModal({
  params
}: {
  params: Promise<{ programmeId: string; visitId: string }>;
}) {
  const session = await currentAccess();
  if (!session) redirect('/auth/sign-in');
  if (!(await programmesEnabled())) notFound();

  const { programmeId, visitId } = await params;
  const [programme, visit] = await Promise.all([
    getProgramme(programmeId),
    getVisit(visitId)
  ]);
  if (!programme || !visit || visit.programmeId !== programmeId) notFound();

  const evidence = await visitEvidence(visit.id);

  return (
    <VisitModal
      title={propertyAddress(visit.property)}
      subtitle={[
        visit.property.externalRef,
        visit.installerName,
        visit.visitDate
      ]
        .filter(Boolean)
        .join(' · ')}
      fullPageHref={`/dashboard/operations/programmes/${programmeId}/visits/${visitId}`}
    >
      <ReviewPanel
        visit={visit}
        evidence={evidence}
        signalConfig={programme.signalConfig}
        canReview={session.access.review}
      />
    </VisitModal>
  );
}

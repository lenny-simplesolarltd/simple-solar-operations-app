import PageContainer from '@/components/layout/page-container';
import { ReadFailureState } from '@/components/read-failure';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AssistantPageContext } from '@/features/assistant/components/page-context';
import { CommissioningForm } from '@/features/installs/components/commissioning-form';
import { InstallActions } from '@/features/installs/components/install-actions';
import type { WorkflowRead } from '@/features/installs/types';
import { EvidenceList } from '@/features/operations/evidence-list';
import { getCurrentUser } from '@/lib/auth';
import { readOps } from '@/lib/backend/read';
import { IconArrowLeft } from '@tabler/icons-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Install | Simple Solar Operations'
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function InstallPage({
  params
}: {
  params: Promise<{ workPackageId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  const { workPackageId } = await params;
  if (!UUID.test(workPackageId)) notFound();

  const result = await readOps<WorkflowRead>('INSTALLER_WORKFLOW', {
    work_package_id: workPackageId
  });
  // Office staff acting on an installer's work must give a reason (the
  // command enforces it for anyone without an allocation).
  const officeReason = !user.roles.includes('Installer');

  return (
    <PageContainer>
      <AssistantPageContext
        page={{ kind: 'operations', surface: 'my-installs', view: 'install' }}
      />
      <div className='flex w-full max-w-4xl flex-col gap-4'>
        <Button asChild variant='ghost' size='sm' className='-ml-2 w-fit'>
          <Link href='/dashboard/installs'>
            <IconArrowLeft /> My installs
          </Link>
        </Button>
        {!result.ok ? (
          <ReadFailureState failure={result.error} />
        ) : (
          <>
            <div className='flex flex-col gap-3'>
              <div>
                <h1 className='text-2xl font-bold'>
                  {result.data.trade} · {result.data.job_label}
                </h1>
                <p className='mt-1 flex items-center gap-2 text-sm'>
                  <Badge variant='outline'>{result.data.status}</Badge>
                  {result.data.evidence.length > 0 && (
                    <span className='text-muted-foreground'>
                      {result.data.evidence.length} photos on file
                    </span>
                  )}
                </p>
              </div>
              <InstallActions wf={result.data} officeReason={officeReason} />
            </div>
            <Card>
              <CardHeader>
                <CardTitle className='text-base'>Photos and files</CardTitle>
              </CardHeader>
              <CardContent>
                <EvidenceList
                  scope={{ work_package_id: result.data.work_package_id }}
                  empty='No photos have been added to this work yet.'
                />
              </CardContent>
            </Card>
            {result.data.commissioning_required && (
              <Card>
                <CardHeader>
                  <CardTitle className='text-base'>Commissioning</CardTitle>
                </CardHeader>
                <CardContent>
                  <CommissioningForm
                    wf={result.data}
                    officeReason={officeReason}
                  />
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </PageContainer>
  );
}

import PageContainer from '@/components/layout/page-container';
import { ReadFailureState } from '@/components/read-failure';
import { Heading } from '@/components/ui/heading';

/** Shown on every Forms page while the Forms release gate (FN-21) is off. */
export function FormsNotEnabled() {
  return (
    <PageContainer>
      <div className='flex w-full flex-col gap-4'>
        <Heading
          title='Forms'
          description='Build forms, send secure links and read responses.'
        />
        <ReadFailureState
          failure={{
            kind: 'not_enabled',
            code: 'R1A_MODE_DENIED',
            message:
              'Forms is switched off at the moment. Nothing is wrong with your account: it will work here once it has been switched on.'
          }}
        />
      </div>
    </PageContainer>
  );
}

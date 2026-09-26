'use client';

import { Button } from '@/components/ui/button';
import { IconPencilPlus, IconX } from '@tabler/icons-react';
import { useState } from 'react';
import type { EmailTemplates } from '../types';
import { ComposeEmail } from './compose-email';
import { ManageTemplatesButton } from './email-templates';

/**
 * Writing an email, the wording to write it from, and everything already sent,
 * on one screen.
 *
 * They were three screens for about an hour. Splitting them meant picking a
 * template was a different page from using it, and the list of what had been
 * sent was a different page again from the thing that sends. Composing is
 * collapsed by default so the screen still opens on the record, which is what
 * people come here to read.
 */
export function CommunicationsWorkspace({
  compose
}: {
  compose: EmailTemplates | null;
}) {
  const [open, setOpen] = useState(false);

  if (!compose) return null;

  return (
    <section className='rounded-lg border'>
      <div className='flex flex-wrap items-center justify-between gap-2 px-3 py-2'>
        <div className='flex items-center gap-2'>
          <Button
            size='sm'
            variant={open ? 'outline' : 'default'}
            onClick={() => setOpen(!open)}
            aria-expanded={open}
          >
            {open ? <IconX aria-hidden /> : <IconPencilPlus aria-hidden />}
            {open ? 'Close' : 'Write an email'}
          </Button>
          {!open && compose.sendingMailbox ? (
            <span className='text-muted-foreground text-sm'>
              from {compose.sendingMailbox}
            </span>
          ) : null}
        </div>
        {!open ? (
          <ManageTemplatesButton
            templates={compose.templates}
            mergeFields={compose.mergeFields}
            canManage={compose.canManage}
          />
        ) : null}
      </div>

      {open ? (
        <div className='border-t px-3 py-4'>
          <ComposeEmail
            templates={compose.templates}
            mergeFields={compose.mergeFields}
            sendingMailbox={compose.sendingMailbox}
            replyTo={compose.replyTo}
            canSend={compose.canSend}
            manageTemplates={
              <ManageTemplatesButton
                templates={compose.templates}
                mergeFields={compose.mergeFields}
                canManage={compose.canManage}
              />
            }
          />
        </div>
      ) : null}
    </section>
  );
}

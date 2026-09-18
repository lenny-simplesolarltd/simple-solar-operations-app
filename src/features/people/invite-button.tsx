'use client';

import { Button } from '@/components/ui/button';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { inviteStaff } from './server/invite-staff';

export function InviteButton({
  personId,
  resend
}: {
  personId: string;
  resend: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState(false);

  return (
    <Button
      size='sm'
      variant='outline'
      disabled={pending || sent}
      onClick={() =>
        startTransition(async () => {
          const result = await inviteStaff(personId);
          if (result.ok) {
            setSent(true);
            toast.success(result.message);
          } else {
            toast.error(result.message);
          }
        })
      }
    >
      {pending
        ? 'Sending…'
        : sent
          ? 'Invite sent'
          : resend
            ? 'Resend invite'
            : 'Invite'}
    </Button>
  );
}

'use client';

import { newCommandId } from '@/features/presale/lib/draft';
import { runCommand } from '@/lib/backend/command';
import type {
  CommandOutcome,
  CommandRequest,
  CommandResponse
} from '@/lib/backend/types';
import { useRouter } from 'next/navigation';
import { useCallback, useState, useTransition } from 'react';
import { toast } from 'sonner';

/**
 * One command dialog's lifecycle. A command_id is minted when the dialog opens
 * and kept until the command succeeds, so a retry after a dropped response is
 * replayed by the server instead of acting twice. Refusals write nothing, so
 * retrying the same id after fixing the input is safe.
 */
export function useCommand() {
  const router = useRouter();
  const [commandId, setCommandId] = useState(newCommandId);
  const [outcome, setOutcome] = useState<CommandOutcome | null>(null);
  const [pending, startTransition] = useTransition();

  const reset = useCallback(() => {
    setCommandId(newCommandId());
    setOutcome(null);
  }, []);

  const run = useCallback(
    (
      request: Omit<CommandRequest, 'command_id'>,
      onDone?: (r: CommandResponse) => void
    ) => {
      setOutcome(null);
      startTransition(async () => {
        let response: CommandResponse;
        try {
          response = await runCommand({ ...request, command_id: commandId });
        } catch {
          // Transport failure: the command may or may not have run. Keep the
          // id so "try again" is answered from the ledger.
          setOutcome({
            status: 'Failed',
            heading: 'CONNECTION PROBLEM',
            message:
              'We could not confirm the result. Try again - it will not be done twice.'
          });
          return;
        }
        if (response.ok) {
          // A stored answer: any further attempt must be a new command.
          setCommandId(newCommandId());
          if (response.outcome.status === 'ActionRequired') {
            // Nothing was written (e.g. NeedsReview): keep the dialog open
            // with the reason, and tell the caller it did not happen.
            setOutcome(response.outcome);
            onDone?.({ ok: false, outcome: response.outcome });
            return;
          } else {
            const tone =
              response.outcome.status === 'Succeeded'
                ? toast.success
                : toast.warning;
            tone(response.outcome.message);
            router.refresh();
          }
        } else {
          setOutcome(response.outcome);
        }
        onDone?.(response);
      });
    },
    [commandId, router]
  );

  return { run, pending, outcome, reset };
}

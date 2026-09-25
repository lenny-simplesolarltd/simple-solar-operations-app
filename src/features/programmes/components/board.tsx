'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { IconLoader2 } from '@tabler/icons-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  DISPOSITION_HINT,
  DISPOSITION_LABEL,
  OUTCOME_SHORT,
  PORTAL_LABEL
} from '../labels';
import { loadBoardColumnAction, reviewVisitAction } from '../server/actions';
import {
  COLUMN_CARDS,
  DISPOSITIONS,
  PORTAL_VERIFICATIONS,
  type Disposition,
  type PortalVerification,
  type ProgrammeVisit
} from '../types';
import { SignalBadge } from './badges';

/**
 * The operations board.
 *
 * Dragging a card is not a different way of changing a visit: the drop calls
 * reviewVisitAction - the same command the review screen calls - so every rule
 * applies to it. In particular a card dropped into "Complete & working" without
 * portal confirmation is refused, and the board says why and offers the portal
 * question rather than pretending the move worked.
 *
 * Drag-and-drop is an accelerator, never the only way: every card is a link to
 * its review screen, and the keyboard "Move" menu does the same thing, because a
 * board that can only be driven by dragging cannot be used one-handed or with a
 * keyboard.
 */

const DRAG_TYPE = 'application/x-programme-visit';

/** "Submitted 14:32, 24 Sep" — how long a card has been sitting there. */
function submittedLabel(iso: string | null) {
  if (!iso) return 'Not submitted';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Not submitted';
  return `Submitted ${d.toLocaleString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    day: 'numeric',
    month: 'short'
  })}`;
}

/**
 * One column: the cards it is showing, and how many there really are.
 *
 * The two are separate because at programme scale they diverge — a column can
 * legitimately hold four hundred visits — and a column that renders sixty of
 * them must say so rather than imply sixty is all there is.
 */
export interface BoardColumn {
  disposition: Disposition;
  cards: ProgrammeVisit[];
  total: number;
}

interface BoardProps {
  programmeId: string;
  columns: BoardColumn[];
  canReview: boolean;
  basePath: string;
  /** Where "see all N" goes, carrying the filters the board is showing. */
  listQuery: string;
}

export function VisitBoard({
  programmeId,
  columns,
  canReview,
  basePath,
  listQuery
}: BoardProps) {
  const router = useRouter();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<Disposition | null>(null);
  const [pending, startTransition] = useTransition();
  // A move that needs the portal question answered before it can happen.
  const [asking, setAsking] = useState<{
    visit: ProgrammeVisit;
    target: Disposition;
  } | null>(null);
  const [portal, setPortal] = useState<PortalVerification | null>(null);
  // Cards fetched by "Load more", per column, on top of the server's first page.
  const [extra, setExtra] = useState<
    Partial<Record<Disposition, ProgrammeVisit[]>>
  >({});
  const [loading, setLoading] = useState<Disposition | null>(null);

  function move(
    visit: ProgrammeVisit,
    target: Disposition,
    verification?: PortalVerification | null,
    /** False for the undo itself, so a move cannot be undone in a loop. */
    undoable = true
  ) {
    if (target === visit.disposition) return;
    // Asked here so the refusal is not the first thing the person sees; the
    // command and the table constraint are what actually enforce it.
    if (
      target === 'CompleteAndWorking' &&
      visit.portalVerification !== 'ConfirmedLive' &&
      verification !== 'ConfirmedLive'
    ) {
      setPortal(visit.portalVerification);
      setAsking({ visit, target });
      return;
    }
    startTransition(async () => {
      const response = await reviewVisitAction(
        {
          visitId: visit.id,
          programmeId,
          disposition: target,
          portalVerification: verification ?? undefined,
          reopen: target === 'AwaitingReview',
          expectedVersion: visit.version
        },
        crypto.randomUUID()
      );
      if (response.ok) {
        setAsking(null);
        // The command returns the row's new version. Without it an undo would
        // be refused as stale, so undo is only offered when it came back.
        const version = Number(
          (response.result as { version?: unknown })?.version
        );
        const from = visit.disposition;
        toast.success(
          undoable
            ? `Moved to ${DISPOSITION_LABEL[target]}.`
            : `Moved back to ${DISPOSITION_LABEL[target]}.`,
          undoable && Number.isInteger(version)
            ? {
                action: {
                  label: 'Undo',
                  // Undo is an ordinary move back, so it is audited and obeys
                  // every rule - it does not erase the move from the history.
                  onClick: () =>
                    move(
                      { ...visit, disposition: target, version },
                      from,
                      undefined,
                      false
                    )
                }
              }
            : undefined
        );
        // "Load more" pages are dropped here: the refresh re-reads each column
        // from the server, and a card that just changed column would otherwise
        // still be sitting in the old one's loaded page.
        setExtra({});
        router.refresh();
      } else {
        toast.error(response.outcome.message);
      }
    });
  }

  function loadMore(disposition: Disposition, shown: number) {
    setLoading(disposition);
    void loadBoardColumnAction({
      programmeId,
      disposition,
      query: listQuery,
      offset: shown
    }).then((r) => {
      setLoading(null);
      if (!r.ok) return toast.error('Could not load more cards.');
      setExtra((c) => ({
        ...c,
        [disposition]: [...(c[disposition] ?? []), ...r.visits]
      }));
    });
  }

  return (
    <>
      {/* Two bands, because the five columns are not five equivalent states:
          one is the inbox everything lands in, and the other four are what the
          office decided. Labelling them says which way work travels without
          changing a single disposition. */}
      <div className='flex gap-3 pb-1 text-xs font-semibold tracking-wide uppercase'>
        <span className='text-muted-foreground w-[17rem] shrink-0'>Inbox</span>
        <span className='text-muted-foreground shrink-0'>Outcome / action</span>
      </div>
      <div className='flex gap-3 overflow-x-auto pb-4'>
        {columns.map(({ disposition, cards: firstPage, total }) => {
          const cards = [...firstPage, ...(extra[disposition] ?? [])];
          return (
            <section
              key={disposition}
              aria-label={DISPOSITION_LABEL[disposition]}
              onDragOver={(e) => {
                if (!canReview || !e.dataTransfer.types.includes(DRAG_TYPE))
                  return;
                e.preventDefault();
                setOver(disposition);
              }}
              onDragLeave={() => setOver((c) => (c === disposition ? null : c))}
              onDrop={(e) => {
                if (!canReview) return;
                e.preventDefault();
                setOver(null);
                const id = e.dataTransfer.getData(DRAG_TYPE);
                const visit = columns
                  .flatMap((c) => c.cards)
                  .find((v) => v.id === id);
                if (visit) move(visit, disposition);
              }}
              className={cn(
                'bg-muted/40 flex w-[17rem] shrink-0 flex-col rounded-lg border',
                // The inbox is visually the source, not one of the outcomes.
                disposition === 'AwaitingReview' &&
                  'border-info/40 bg-info-soft/30',
                over === disposition && 'ring-primary bg-accent ring-2'
              )}
            >
              <header className='flex items-baseline justify-between gap-2 border-b px-3 py-2'>
                <h3 className='text-sm font-semibold'>
                  {DISPOSITION_LABEL[disposition]}
                </h3>
                <span className='text-muted-foreground text-sm tabular-nums'>
                  {cards.length < total
                    ? `${cards.length} of ${total.toLocaleString('en-GB')}`
                    : total.toLocaleString('en-GB')}
                </span>
              </header>
              <p className='text-muted-foreground px-3 pt-2 text-xs'>
                {DISPOSITION_HINT[disposition]}
              </p>
              <ul className='flex flex-col gap-2 p-2'>
                {cards.map((visit) => (
                  <li key={visit.id}>
                    <article
                      draggable={canReview}
                      onDragStart={(e) => {
                        e.dataTransfer.setData(DRAG_TYPE, visit.id);
                        e.dataTransfer.effectAllowed = 'move';
                        setDragging(visit.id);
                      }}
                      onDragEnd={() => setDragging(null)}
                      className={cn(
                        'bg-background flex flex-col gap-1.5 rounded-md border p-2.5 text-sm',
                        canReview && 'cursor-grab active:cursor-grabbing',
                        dragging === visit.id && 'opacity-50'
                      )}
                    >
                      <Link
                        href={`${basePath}/visits/${visit.id}`}
                        className='font-medium hover:underline'
                      >
                        {visit.property.addressLine1}
                      </Link>
                      <p className='text-muted-foreground text-xs'>
                        {[visit.property.postcode, visit.property.externalRef]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      <div className='flex flex-wrap items-center gap-1.5'>
                        {visit.outcome && (
                          <span className='bg-muted rounded px-1.5 py-0.5 text-xs'>
                            {OUTCOME_SHORT[visit.outcome]}
                          </span>
                        )}
                        {visit.signalClassification && (
                          <SignalBadge
                            signal={visit.signalClassification}
                            csq={visit.csq}
                            className='text-[11px]'
                          />
                        )}
                      </div>
                      {visit.meterSerialMatches === false && (
                        <p className='text-destructive text-xs font-semibold'>
                          Serial mismatch
                        </p>
                      )}
                      {/* The portal answer is the one fact that decides whether
                        this visit can ever be complete, so it is on the card
                        rather than one click away. */}
                      {visit.portalVerification ? (
                        <p
                          className={cn(
                            'text-xs',
                            visit.portalVerification === 'ConfirmedLive'
                              ? 'text-success font-medium'
                              : 'text-warning font-medium'
                          )}
                        >
                          {PORTAL_LABEL[visit.portalVerification]}
                        </p>
                      ) : (
                        visit.portalCheckRequired && (
                          <p className='text-muted-foreground text-xs'>
                            Portal not checked
                          </p>
                        )
                      )}
                      <p className='text-muted-foreground text-xs'>
                        {visit.installerName} · {visit.visitDate}
                      </p>
                      <p className='text-muted-foreground text-xs'>
                        {submittedLabel(visit.submittedAt)}
                      </p>
                      {canReview && (
                        <label className='mt-1 flex flex-col gap-1 text-xs'>
                          <span className='sr-only'>
                            Move {visit.property.addressLine1} to
                          </span>
                          <select
                            value={visit.disposition}
                            disabled={pending}
                            onChange={(e) =>
                              move(visit, e.target.value as Disposition)
                            }
                            className='border-input bg-background h-9 rounded-md border px-2 text-xs'
                          >
                            {DISPOSITIONS.map((d) => (
                              <option key={d} value={d}>
                                {DISPOSITION_LABEL[d]}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </article>
                  </li>
                ))}
                {cards.length === 0 && (
                  <li className='text-muted-foreground px-1 py-4 text-center text-xs'>
                    Nothing here.
                  </li>
                )}
              </ul>
              {cards.length < total && (
                <div className='flex flex-col border-t'>
                  <button
                    type='button'
                    disabled={loading === disposition}
                    onClick={() => loadMore(disposition, cards.length)}
                    className='hover:bg-accent flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium disabled:opacity-60'
                  >
                    {loading === disposition && (
                      <IconLoader2
                        aria-hidden
                        className='size-3.5 animate-spin'
                      />
                    )}
                    Load {Math.min(COLUMN_CARDS, total - cards.length)} more
                  </button>
                  {/* Still offered: past a few hundred cards the list, with its
                    sorting and paging, is the better tool than a long column. */}
                  <Link
                    href={`${basePath}/visits?${listQuery}${listQuery ? '&' : ''}disposition=${disposition}`}
                    className='text-muted-foreground border-t px-3 py-2 text-center text-xs hover:underline'
                  >
                    See all {total.toLocaleString('en-GB')} in a list
                  </Link>
                </div>
              )}
            </section>
          );
        })}
      </div>

      <Dialog
        open={!!asking}
        onOpenChange={(open) => {
          if (!open) setAsking(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Is the meter live in the PCH portal?</DialogTitle>
            <DialogDescription>
              A visit can only be Complete &amp; working once the office has
              confirmed the meter is live and reporting. A good CSQ is not the
              same thing.
            </DialogDescription>
          </DialogHeader>
          <div className='flex flex-col gap-2'>
            {PORTAL_VERIFICATIONS.map((v) => (
              <label
                key={v}
                className={cn(
                  'flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm',
                  portal === v && 'border-foreground bg-accent font-medium'
                )}
              >
                <input
                  type='radio'
                  name='board-portal'
                  className='accent-foreground size-4'
                  checked={portal === v}
                  onChange={() => setPortal(v)}
                />
                {PORTAL_LABEL[v]}
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setAsking(null)}>
              Cancel
            </Button>
            <Button
              disabled={portal !== 'ConfirmedLive' || pending}
              onClick={() =>
                asking && move(asking.visit, asking.target, portal)
              }
            >
              {pending && <IconLoader2 aria-hidden className='animate-spin' />}
              Confirm live and complete
            </Button>
          </DialogFooter>
          {portal && portal !== 'ConfirmedLive' && (
            <p className='text-muted-foreground text-sm'>
              Then this visit is not complete. Close this and move it to Action
              required instead — recording “{PORTAL_LABEL[portal]}” there keeps
              the reason.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

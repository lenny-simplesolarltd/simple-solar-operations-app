// Page context the assistant UI may send with a message. Safe to import from
// client components.
//
// This is a HINT about what the staff member is looking at - never authority.
// Pages publish it explicitly (see components/page-context.tsx); nothing is
// scraped from rendered HTML. The server re-validates it with this schema,
// which is strict on purpose: identity-shaped keys (role, person_id,
// permissions, ...) are rejected rather than ignored, and every tool still
// runs under the signed-in user's own session and RLS.
import { z } from 'zod';

const shortText = (max: number) => z.string().trim().min(1).max(max);

export const jobPageContextSchema = z.strictObject({
  kind: z.literal('job'),
  jobId: z.uuid(),
  jobRef: shortText(40),
  customerName: shortText(120),
  workflowStage: shortText(60)
});

export const tasksPageContextSchema = z.strictObject({
  kind: z.literal('tasks'),
  /** Which task lists the page is showing the user. */
  lists: z.array(z.enum(['my', 'team'])).max(2),
  /** Filters currently applied on the page, when it has any. */
  filters: z
    .strictObject({
      status: shortText(40).optional(),
      due: z.enum(['overdue', 'today']).optional(),
      owner: shortText(120).optional()
    })
    .optional()
});

export const presalesPageContextSchema = z.strictObject({
  kind: z.literal('presales'),
  scope: z.enum(['all', 'mine'])
});

const simplePage = <K extends string>(kind: K) =>
  z.strictObject({ kind: z.literal(kind) });

export const pageContextSchema = z.discriminatedUnion('kind', [
  jobPageContextSchema,
  tasksPageContextSchema,
  presalesPageContextSchema,
  simplePage('presale-new'),
  simplePage('people'),
  simplePage('dashboard'),
  simplePage('other')
]);

export const assistantContextSchema = z.strictObject({
  route: z.string().max(200),
  page: pageContextSchema
});

export type AssistantPageContext = z.infer<typeof pageContextSchema>;
export type AssistantContext = z.infer<typeof assistantContextSchema>;

/** One-line label for the drawer's context indicator. */
export function describeContext(page: AssistantPageContext): {
  label: string;
  detail?: string;
} {
  switch (page.kind) {
    case 'job':
      return {
        label: page.jobRef,
        detail: `${page.customerName} · ${page.workflowStage}`
      };
    case 'tasks':
      return { label: 'Tasks', detail: filterSummary(page.filters) };
    case 'presales':
      return {
        label: 'Presales',
        detail: page.scope === 'all' ? 'All sold jobs' : 'Your sold jobs'
      };
    case 'presale-new':
      return { label: 'New presale' };
    case 'people':
      return { label: 'People & access' };
    case 'dashboard':
      return { label: 'Dashboard' };
    default:
      return { label: 'Operations' };
  }
}

function filterSummary(
  filters: z.infer<typeof tasksPageContextSchema>['filters']
): string | undefined {
  if (!filters) return undefined;
  const parts = [filters.status, filters.due, filters.owner].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

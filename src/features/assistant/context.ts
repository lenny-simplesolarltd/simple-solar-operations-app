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
      due: z
        .enum(['overdue', 'today', 'soon', 'later', 'none', 'dated'])
        .optional(),
      queue: shortText(40).optional(),
      owner: shortText(120).optional(),
      q: shortText(120).optional()
    })
    .optional()
});

export const taskPageContextSchema = z.strictObject({
  kind: z.literal('task'),
  taskId: z.uuid(),
  title: shortText(160),
  status: shortText(40),
  jobId: z.uuid().optional(),
  jobRef: shortText(40).optional()
});

export const presalesPageContextSchema = z.strictObject({
  kind: z.literal('presales'),
  scope: z.enum(['all', 'mine'])
});

export const jobsPageContextSchema = z.strictObject({
  kind: z.literal('jobs'),
  query: shortText(120).optional(),
  stages: z.array(shortText(60)).max(20).optional()
});

/**
 * The operational list screens (booking, materials, planner, ...). `surface`
 * names the screen; `view` is its current tab or filter, when it has one.
 */
export const OPERATION_SURFACES = [
  'booking',
  'intake-review',
  'commissioning-review',
  'goods-in',
  'materials',
  'merchant-orders',
  'stock',
  'installer-skills',
  'my-installs',
  'planner',
  'scaffold',
  'availability',
  'system'
] as const;

export const operationsPageContextSchema = z.strictObject({
  kind: z.literal('operations'),
  surface: z.enum(OPERATION_SURFACES),
  view: shortText(60).optional()
});

/** The Forms area; `view` is Forms / Templates / Responses. */
export const formsPageContextSchema = z.strictObject({
  kind: z.literal('forms'),
  view: z.enum(['forms', 'templates', 'responses'])
});

/** One form or template open in the builder. A hint: tools re-read it by id. */
export const formPageContextSchema = z.strictObject({
  kind: z.literal('form'),
  formId: z.uuid(),
  formKind: z.enum(['form', 'template']),
  title: shortText(200),
  status: shortText(20)
});

/** The Help Center; `slug` is the article open, when one is. */
export const helpPageContextSchema = z.strictObject({
  kind: z.literal('help'),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .max(80)
    .optional()
});

const simplePage = <K extends string>(kind: K) =>
  z.strictObject({ kind: z.literal(kind) });

export const pageContextSchema = z.discriminatedUnion('kind', [
  jobPageContextSchema,
  tasksPageContextSchema,
  taskPageContextSchema,
  presalesPageContextSchema,
  jobsPageContextSchema,
  operationsPageContextSchema,
  formsPageContextSchema,
  formPageContextSchema,
  helpPageContextSchema,
  simplePage('requests'),
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
    case 'task':
      return {
        label: page.jobRef ?? 'Task',
        detail: `${page.title} · ${page.status}`
      };
    case 'jobs':
      return { label: 'Job search', detail: page.query };
    case 'operations':
      return { label: SURFACE_LABELS[page.surface], detail: page.view };
    case 'forms':
      return {
        label: 'Forms',
        detail: {
          forms: 'Forms',
          templates: 'Templates',
          responses: 'Responses'
        }[page.view]
      };
    case 'form':
      return {
        label: page.formKind === 'template' ? 'Template' : 'Form',
        detail: `${page.title} · ${page.status}`
      };
    case 'help':
      return { label: 'Help Center', detail: page.slug };
    case 'requests':
      return { label: 'My requests' };
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

const SURFACE_LABELS: Record<(typeof OPERATION_SURFACES)[number], string> = {
  booking: 'Booking',
  'intake-review': 'Intake review',
  'commissioning-review': 'Commissioning review',
  'goods-in': 'Goods in',
  materials: 'Materials',
  'merchant-orders': 'Merchant orders',
  stock: 'Stock',
  'installer-skills': 'Installer skills',
  'my-installs': 'My installs',
  planner: 'Planner',
  scaffold: 'Scaffold bookings',
  availability: 'Staff availability',
  system: 'System health'
};

function filterSummary(
  filters: z.infer<typeof tasksPageContextSchema>['filters']
): string | undefined {
  if (!filters) return undefined;
  const parts = [
    filters.status,
    filters.due,
    filters.queue,
    filters.owner,
    filters.q
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

import 'server-only';

import {
  MSG_CONFIRM_ELEVATIONS,
  STEP_KEYS,
  STEP_LABELS,
  type StepKey
} from '@/features/presale/lib/steps';
import { z } from 'zod';
import type { ReadTool } from '../registry';

// What each step is for. The step list, labels and gating messages come from
// the Presale feature itself, so this tool cannot drift from the real wizard.
const STEP_DETAIL: Record<StepKey, string> = {
  customer:
    'Customer name, address and postcode, plus a phone number or an email address.',
  parameters: 'AC cable run and annual consumption.',
  elevations: `Each roof elevation's pitch, shading, bearing and dimensions. ${MSG_CONFIRM_ELEVATIONS}`,
  obstructions: 'Roof obstructions that reduce the usable area.',
  panels: 'Choose the panel type.',
  layout: 'Review the panel layout and shift the array on each elevation.',
  price:
    'Inverter and battery lines, extras and adjustments; every inverter line needs a model.',
  performance: 'Estimated generation, savings and income.',
  sale: 'Agreed price, payment route, salesperson and required scope, then submit.'
};

export const getPresaleWorkflowTool: ReadTool<Record<string, never>> = {
  name: 'get_presale_workflow',
  summary: 'Explain the nine-step Presale (Job Sold) workflow',
  description:
    'Return the steps of the Presale / Job Sold form as the application defines them, what each step needs before the surveyor can continue, and what happens when the sale is submitted. Application rules, not data about any particular job.',
  domain: 'presales',
  kind: 'read',
  status: 'available',
  inputSchema: z.strictObject({}),
  authorization: {
    permissions: [],
    enforcedBy: 'Static application rules; no data access'
  },
  async execute() {
    const steps = STEP_KEYS.map((key, i) => ({
      label: `${i + 1}. ${STEP_LABELS[key]}`,
      detail: STEP_DETAIL[key]
    }));
    const onSubmit =
      'Submitting records the customer, the job (with its SS- reference), the presale snapshot and the follow-up tasks in one transaction. The presale is the record of what was sold and cannot be edited afterwards. Staff submit sales from Presales > New presale; SimpleBot cannot submit one.';
    return {
      ok: true,
      data: { kind: 'application_rules', steps, on_submit: onSubmit },
      display: {
        kind: 'workflow',
        title: 'Presale workflow',
        steps,
        footnote: onSubmit
      }
    };
  }
};

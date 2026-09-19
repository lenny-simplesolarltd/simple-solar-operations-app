// Starter actions for the drawer. Safe to import from client components.
import type { AssistantPageContext } from './context';

export interface AssistantSuggestion {
  label: string;
  /** Text sent (or placed in the composer) when the suggestion is chosen. */
  prompt: string;
  /** 'prefill' puts the text in the composer for the staff member to finish. */
  mode: 'send' | 'prefill';
  /** Every tool named here must be available to this staff member, or the suggestion is not shown. */
  requires: string[];
}

const BY_PAGE: Record<AssistantPageContext['kind'], AssistantSuggestion[]> = {
  job: [
    {
      label: 'Summarise this job',
      prompt: 'Summarise this job.',
      mode: 'send',
      requires: ['get_job']
    },
    {
      label: 'Show open tasks',
      prompt: 'Show the open tasks on this job.',
      mode: 'send',
      requires: ['get_job_tasks']
    },
    {
      label: 'Which tasks are blocked?',
      prompt: 'Which tasks on this job are blocked or waiting, and why?',
      mode: 'send',
      requires: ['get_job_tasks']
    },
    // Hidden until the quote workstream lands get_quote_history.
    {
      label: 'Show quote history',
      prompt: 'Show the quote history for this job.',
      mode: 'send',
      requires: ['get_quote_history']
    }
  ],
  tasks: [
    {
      label: 'What should I work on next?',
      prompt: 'What should I work on next?',
      mode: 'send',
      requires: ['get_my_tasks']
    },
    {
      label: 'Show my overdue tasks',
      prompt: 'Show my overdue tasks.',
      mode: 'send',
      requires: ['get_my_tasks']
    },
    {
      label: 'Show the team’s overdue tasks',
      prompt: 'Show the team’s overdue tasks.',
      mode: 'send',
      requires: ['get_team_tasks']
    }
  ],
  task: [
    {
      label: 'Summarise this job',
      prompt: 'Summarise the job this task belongs to.',
      mode: 'send',
      requires: ['get_job']
    },
    {
      label: 'Show open tasks on the job',
      prompt: 'Show the other open tasks on this job.',
      mode: 'send',
      requires: ['get_job_tasks']
    }
  ],
  jobs: [
    {
      label: 'Find a job',
      prompt: 'Find the job for ',
      mode: 'prefill',
      requires: ['find_job']
    }
  ],
  operations: [],
  help: [
    {
      label: 'Ask how to do something',
      prompt: 'How do I ',
      mode: 'prefill',
      requires: ['search_help_articles']
    }
  ],
  requests: [],
  presales: [
    {
      label: 'Find a sold job',
      prompt: 'Find the job for ',
      mode: 'prefill',
      requires: ['find_job']
    },
    {
      label: 'Explain the Presale workflow',
      prompt: 'Explain the Presale workflow.',
      mode: 'send',
      requires: ['get_presale_workflow']
    }
  ],
  'presale-new': [
    {
      label: 'Explain the Presale workflow',
      prompt: 'Explain the Presale workflow.',
      mode: 'send',
      requires: ['get_presale_workflow']
    }
  ],
  forms: [
    {
      label: 'List my forms',
      prompt: 'List the forms.',
      mode: 'send',
      requires: ['list_forms']
    },
    {
      label: 'Create a form',
      prompt: 'Create a form asking ',
      mode: 'prefill',
      requires: ['create_form']
    }
  ],
  form: [
    {
      label: 'Describe this form',
      prompt: 'Describe this form and its questions.',
      mode: 'send',
      requires: ['get_form']
    },
    {
      label: 'Add a question',
      prompt: 'Add a question to this form asking ',
      mode: 'prefill',
      requires: ['edit_form_draft']
    }
  ],
  people: [],
  dashboard: [],
  other: []
};

const GENERAL: AssistantSuggestion[] = [
  {
    label: 'Find a job',
    prompt: 'Find the job for ',
    mode: 'prefill',
    requires: ['find_job']
  },
  {
    label: 'Show my overdue tasks',
    prompt: 'Show my overdue tasks.',
    mode: 'send',
    requires: ['get_my_tasks']
  }
];

/** Suggestions for this page, limited to what this staff member's tools can really do. */
export function suggestionsFor(
  page: AssistantPageContext['kind'],
  availableTools: readonly string[]
): AssistantSuggestion[] {
  const available = new Set(availableTools);
  const seen = new Set<string>();
  return [...BY_PAGE[page], ...GENERAL]
    .filter((s) => s.requires.every((tool) => available.has(tool)))
    .filter((s) => (seen.has(s.label) ? false : (seen.add(s.label), true)))
    .slice(0, 4);
}

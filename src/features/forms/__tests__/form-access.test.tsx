import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {} })
}));
vi.mock('../server/actions', () => ({ setFormAccessAction: async () => ({}) }));

import { FormAccess } from '../components/form-access';
import type { FormAccess as Access } from '../server/access';

/**
 * The editor's "who can complete this form?" section.
 *
 * Two things it must not get wrong. A programme's visit form is decided by the
 * programme - its assignments and its property visibility - so offering a
 * manager a choice here would either be ignored or would break the programme's
 * own form. And a ReadOnly account writes nothing anywhere, so naming it as a
 * completing role would put the form on somebody's list and then refuse their
 * submission: a dead end built in the UI.
 */

const base: Access = {
  formId: '11111111-1111-1111-1111-111111111111',
  mode: 'Invitation',
  workflowOwned: false,
  workflowName: null,
  roles: [],
  allRoles: ['Admin', 'Installer', 'Manager', 'ReadOnly', 'Surveyor']
};

const markup = (access: Access, canEdit = true) =>
  renderToStaticMarkup(
    <FormAccess formId={access.formId} access={access} canEdit={canEdit} />
  );

describe('FormAccess', () => {
  it('says in plain words that the programme decides, and offers no choice', () => {
    const html = markup({
      ...base,
      mode: 'Workflow',
      workflowOwned: true,
      workflowName: 'PCH Meter SIM Replacement'
    });

    expect(html).toContain('PCH Meter SIM Replacement decides');
    expect(html).toContain('the programme decides');
    // Read-only means no controls at all, not disabled ones that look editable.
    expect(html).not.toContain('type="radio"');
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('Save access');
  });

  it('offers the two modes a manager may actually choose', () => {
    const html = markup(base);
    expect(html).toContain('Only people sent a link');
    expect(html).toContain('People with certain roles');
    // Workflow is a fact about what points at the form, not a setting: the
    // command refuses it (FORMS_ACCESS_NOT_WORKFLOW_OWNED), so it is not offered.
    expect(html).not.toContain('>Workflow<');
  });

  it('lists the roles when the mode is Roles, and never offers ReadOnly', () => {
    const html = markup({ ...base, mode: 'Roles', roles: ['Installer'] });

    expect(html).toContain('Installer');
    expect(html).toContain('Surveyor');
    expect(html).not.toContain('>ReadOnly<');
    expect(html).toContain('cannot submit anything');
    // Ticked from the saved configuration, not from a default.
    expect(html).toMatch(/checked=""[\s\S]{0,200}Installer/);
  });

  it('shows the roles but no save button to somebody who cannot edit the form', () => {
    const html = markup({ ...base, mode: 'Roles', roles: ['Manager'] }, false);
    expect(html).toContain('Manager');
    expect(html).not.toContain('Save access');
  });

  it('keeps every interactive row at a phone-sized target', () => {
    const html = markup({ ...base, mode: 'Roles' });
    const rows = html.match(/<label class="[^"]*"/g) ?? [];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row).toContain('min-h-11');
  });
});

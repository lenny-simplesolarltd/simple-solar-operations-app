import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {} })
}));
vi.mock('../server/actions', () => ({ setFormAccessAction: async () => ({}) }));

import {
  FormAccess,
  RoleMemberList,
  roleMemberLabel
} from '../components/form-access';
import type { FormAccess as Access } from '../server/access';

/**
 * Choosing "Installer" is choosing nine people, and the checkbox never said
 * who. The faces answer that at a glance and the hover card carries the names
 * and addresses; what matters in these assertions is that neither of them
 * invents anybody, and that a person who cannot read the directory simply sees
 * the roles without faces rather than a confident "0".
 */
const access: Access = {
  formId: 'ffffffff-1111-4111-8111-ffffffffffff',
  mode: 'Roles',
  workflowOwned: false,
  workflowName: null,
  roles: ['Installer'],
  allRoles: ['Admin', 'Installer', 'Office', 'ReadOnly']
};

const person = (id: string, name: string, email: string | null) => ({
  id,
  name,
  email
});

const html = (members: Record<string, ReturnType<typeof person>[]>) =>
  renderToStaticMarkup(
    <FormAccess
      formId={access.formId}
      access={access}
      canEdit
      roleMembers={members}
    />
  );

describe('who holds each role', () => {
  it('shows the faces, with initials, beside the role', () => {
    const out = html({
      Installer: [
        person('p1', 'John Doyle', 'john@simplesolarltd.co.uk'),
        person('p2', 'Rick Stone', 'rick@simplesolarltd.co.uk')
      ]
    });
    expect(out).toContain('JD');
    expect(out).toContain('RS');
    expect(out).toContain('2 people hold the Installer role');
  });

  it('names everyone, with their addresses, in the list behind the faces', () => {
    const members = [
      person('p1', 'John Doyle', 'john@simplesolarltd.co.uk'),
      person('p2', 'Rick Stone', 'rick@simplesolarltd.co.uk')
    ];
    // Rendered directly: Radix mounts hover content only once it opens, so it
    // is not in the closed card's markup.
    const out = renderToStaticMarkup(
      <RoleMemberList
        label={roleMemberLabel('Installer', members.length)}
        members={members}
      />
    );
    expect(out).toContain('John Doyle');
    expect(out).toContain('john@simplesolarltd.co.uk');
    expect(out).toContain('Rick Stone');
  });

  it('counts the overflow rather than drawing everybody', () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      person(`p${i}`, `Person ${i}`, `p${i}@simplesolarltd.co.uk`)
    );
    const out = html({ Installer: many });
    // Four faces and "+5", not nine faces squeezed into a row.
    expect(out).toContain('+5');
    expect(out).toContain('9 people hold the Installer role');
    // Everybody is still reachable in the list behind it.
    const list = renderToStaticMarkup(
      <RoleMemberList label={roleMemberLabel('Installer', 9)} members={many} />
    );
    for (const p of many) expect(list).toContain(p.name);
  });

  it('says "person" for one and "people" for more', () => {
    expect(html({ Admin: [person('a', 'Lenny', 'lenny@x')] })).toContain(
      '1 person holds the Admin role'
    );
  });

  it('shows the roles without faces when the directory cannot be read', () => {
    // An installer sees only themselves under RLS, so the query returns {}.
    const out = html({});
    expect(out).toContain('Installer');
    expect(out).not.toContain('person holds');
    expect(out).not.toContain('people hold');
    // And never a made-up zero.
    expect(out).not.toMatch(/0 people/);
  });

  it('invents nobody for a role with no members', () => {
    const out = html({ Installer: [person('p1', 'John Doyle', null)] });
    expect(out).toContain('1 person holds the Installer role');
    // Admin was given nobody, so it gets no group at all.
    expect(out).not.toContain('holds the Admin role');
  });

  it('keeps a person with no address readable', () => {
    const out = renderToStaticMarkup(
      <RoleMemberList
        label={roleMemberLabel('Installer', 1)}
        members={[person('p1', 'John Doyle', null)]}
      />
    );
    expect(out).toContain('John Doyle');
    expect(out).not.toContain('null');
  });
});

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { renderToStaticMarkup } from 'react-dom/server';
import type { DisplayCard, ProgrammeCandidate } from '../../protocol';
import { candidatePrompt } from '../programme-cards';
import { ResultCard } from '../result-cards';

/**
 * Programme cards show what the programme tools already read under the asking
 * person's own access. These tests hold the three promises that makes:
 * everything the card was given is on it, nothing it was not given is invented,
 * and no canonical id is ever put in front of somebody to read or retype.
 *
 * There is no DOM here, so the assertions are made against the rendered markup.
 * That suits the mobile check too: an installer reads these on a phone, and the
 * cheapest honest guard is that no width class wider than a phone is emitted.
 */

const PROPERTY_ID = '4a2d0e4c-1f4a-4d0b-9b3c-2b4e1c5d6f70';
const VISIT_ID = '8c9b7a61-3e55-4c9a-8d21-77f0a9b1c2d3';

const render = (card: DisplayCard) =>
  renderToStaticMarkup(<ResultCard card={card} />);

/** Everything a person actually reads, with the mark-up taken away. */
const text = (markup: string) =>
  markup
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Every class name the card emitted, as individual tokens. */
function classTokens(markup: string): string[] {
  const tokens: string[] = [];
  const pattern = /class="([^"]*)"/g;
  let match = pattern.exec(markup);
  while (match !== null) {
    tokens.push(...match[1].split(/\s+/).filter(Boolean));
    match = pattern.exec(markup);
  }
  return tokens;
}

const visit = {
  id: VISIT_ID,
  reference: 'PCH-0142',
  address: '24 King Street, Exeter',
  postcode: 'EX1 2AB',
  installer: 'Dale Fielding',
  visitDate: '2026-09-15',
  submittedAt: '2026-09-15T16:20:00.000Z',
  outcome: 'SIM changed — meter appears working',
  disposition: 'Awaiting review',
  portalVerification: 'Confirmed live/reporting',
  csq: 21,
  csqBand: 'Good',
  serialMismatch: true
};

const candidate = (n: number): ProgrammeCandidate => ({
  id: `${n}a2d0e4c-1f4a-4d0b-9b3c-2b4e1c5d6f70`,
  reference: `PCH-010${n}`,
  address: `${n} King Street, Exeter`,
  postcode: 'EX1 2AB'
});

describe('programme_summary card', () => {
  const card: DisplayCard = {
    kind: 'programme_summary',
    programme: {
      code: 'PCH-SIM',
      name: 'PCH Meter SIM Replacement',
      client: 'Plymouth Community Homes',
      status: 'Active',
      testData: false,
      attended: 120,
      remaining: 157,
      completedAndLive: 96,
      target: 277,
      runRate: 8.4
    }
  };

  it('renders the programme, its progress and its run rate', () => {
    const body = text(render(card));
    expect(body).toContain('PCH Meter SIM Replacement');
    expect(body).toContain('PCH-SIM');
    expect(body).toContain('Plymouth Community Homes');
    expect(body).toContain('120');
    expect(body).toContain('157');
    expect(body).toContain('96 of 277 complete and live');
    expect(body).toContain('35% of target');
    expect(body).toContain('8.4 a day');
  });

  it('quotes no percentage when no target has been agreed', () => {
    const body = text(
      render({
        kind: 'programme_summary',
        programme: { ...card.programme, target: null, runRate: null }
      })
    );
    expect(body).not.toContain('% of target');
    expect(body).not.toContain('Target');
    expect(body).not.toContain('Run rate');
    // The counts it was given are still there.
    expect(body).toContain('120');
  });
});

describe('programme_property card', () => {
  const card: DisplayCard = {
    kind: 'programme_property',
    property: {
      id: PROPERTY_ID,
      reference: 'PCH-0142',
      address: '24 King Street, Exeter',
      postcode: 'EX1 2AB',
      expectedMeterSerial: 'M12345678',
      state: 'Action required',
      visited: true
    }
  };

  it('renders the address, reference, serial and state', () => {
    const body = text(render(card));
    expect(body).toContain('24 King Street, Exeter');
    expect(body).toContain('PCH-0142');
    expect(body).toContain('EX1 2AB');
    expect(body).toContain('M12345678');
    expect(body).toContain('Action required');
    expect(body).toContain('Visited');
  });

  it('says not visited, and never prints the property id', () => {
    const markup = render({
      kind: 'programme_property',
      property: {
        ...card.property,
        state: null,
        visited: false
      }
    });
    expect(text(markup)).toContain('Not visited yet');
    expect(markup).not.toMatch(UUID);
  });

  it('invents nothing for a property with no serial and no visit', () => {
    const body = text(
      render({
        kind: 'programme_property',
        property: {
          ...card.property,
          expectedMeterSerial: null,
          state: null,
          visited: false
        }
      })
    );
    expect(body).not.toContain('Meter expected here');
    expect(body).not.toContain('undefined');
    expect(body).not.toContain('null');
  });
});

describe('programme_visit card', () => {
  it('renders the visit, the portal result and the serial mismatch', () => {
    const body = text(render({ kind: 'programme_visit', visit }));
    expect(body).toContain('24 King Street, Exeter');
    expect(body).toContain('PCH-0142');
    expect(body).toContain('EX1 2AB');
    expect(body).toContain('Dale Fielding');
    expect(body).toContain('15 Sept 2026');
    expect(body).toContain('SIM changed — meter appears working');
    expect(body).toContain('Awaiting review');
    expect(body).toContain('Portal: Confirmed live/reporting');
    expect(body).toContain('CSQ 21 · Good');
    expect(body).toContain('meter serial recorded is not the one expected');
  });

  it('never prints the visit id', () => {
    expect(render({ kind: 'programme_visit', visit })).not.toMatch(UUID);
  });

  it('shows no outcome, portal, signal or mismatch it was not given', () => {
    const body = text(
      render({
        kind: 'programme_visit',
        visit: {
          ...visit,
          installer: null,
          visitDate: null,
          submittedAt: null,
          outcome: null,
          portalVerification: null,
          csq: null,
          csqBand: null,
          serialMismatch: false
        }
      })
    );
    expect(body).not.toContain('Portal:');
    expect(body).not.toContain('CSQ');
    expect(body).not.toContain('submitted');
    expect(body).not.toContain('not the one expected');
    expect(body).not.toContain('undefined');
    // What it was given is still shown.
    expect(body).toContain('Awaiting review');
  });
});

describe('programme_review_item card', () => {
  const card: DisplayCard = {
    kind: 'programme_review_item',
    visit,
    reviewStatus: 'Reviewed',
    evidenceCount: 3,
    reviewReasons: ['The meter serial did not match the one expected.']
  };

  it('renders the visit, its review state, evidence and reasons', () => {
    const body = text(render(card));
    expect(body).toContain('24 King Street, Exeter');
    expect(body).toContain('PCH-0142');
    expect(body).toContain('Awaiting review');
    expect(body).toContain('Reviewed');
    expect(body).toContain('3 files attached');
    expect(body).toContain('The meter serial did not match the one expected.');
    expect(body).toContain('Portal: Confirmed live/reporting');
  });

  it('says nothing about evidence when the surface did not read any', () => {
    const body = text(
      render({ kind: 'programme_review_item', visit, reviewStatus: 'Reviewed' })
    );
    expect(body).not.toContain('attached');
    expect(body).not.toContain('No evidence');
    expect(body).toContain('Reviewed');
  });

  it('never prints the visit id', () => {
    expect(render(card)).not.toMatch(UUID);
  });
});

describe('programme_candidates card', () => {
  const card: DisplayCard = {
    kind: 'programme_candidates',
    target: 'property',
    title: 'Properties matching “King Street”',
    total: 43,
    candidates: [1, 2, 3, 4, 5, 6, 7, 8].map(candidate)
  };

  it('lists the bounded page and says the true total', () => {
    const body = text(render(card));
    expect(body).toContain('Properties matching “King Street”');
    expect(body).toContain('8 of 43');
    expect(body).toContain('Showing 8 of 43');
    expect(body).toContain('1 King Street, Exeter');
    expect(body).toContain('PCH-0108');
    expect(body).toContain('EX1 2AB');
    // Eight rows listed, and the total is the query's, not a count of them.
    expect(body).not.toContain('9 King Street');
  });

  it('offers a choice only when the drawer gave it somewhere to go', () => {
    const withSelect = renderToStaticMarkup(
      <ResultCard card={card} onSelectCandidate={() => {}} />
    );
    expect(text(withSelect)).toContain('Choose');
    expect(text(render(card))).not.toContain('Choose');
  });

  it('carries the id in props, never in what is read', () => {
    const markup = renderToStaticMarkup(
      <ResultCard card={card} onSelectCandidate={() => {}} />
    );
    expect(markup).not.toMatch(UUID);
    // The message a choice drafts names the property in words a person uses.
    const prompt = candidatePrompt(candidate(1), 'property');
    expect(prompt).toContain('1 King Street, Exeter');
    expect(prompt).toContain('EX1 2AB');
    expect(prompt).toContain('PCH-0101');
    expect(prompt).not.toMatch(UUID);
  });

  it('says so plainly when nothing matched', () => {
    const body = text(
      render({ ...card, candidates: [], total: 0 } as DisplayCard)
    );
    expect(body).toContain('Nothing you have access to matched.');
    expect(body).not.toContain('Showing');
  });
});

describe('every programme card at phone width', () => {
  const cards: DisplayCard[] = [
    {
      kind: 'programme_summary',
      programme: {
        code: 'PCH-SIM',
        name: 'PCH Meter SIM Replacement',
        client: 'Plymouth Community Homes',
        status: 'Active',
        testData: true,
        attended: 120,
        remaining: 157,
        completedAndLive: 96,
        target: 277,
        runRate: 8.4
      }
    },
    {
      kind: 'programme_property',
      property: {
        id: PROPERTY_ID,
        reference: 'PCH-0142',
        address: '24 King Street, Exeter',
        postcode: 'EX1 2AB',
        expectedMeterSerial: 'M12345678',
        state: 'Complete & working',
        visited: true
      }
    },
    { kind: 'programme_visit', visit },
    {
      kind: 'programme_review_item',
      visit,
      reviewStatus: 'Reviewed',
      evidenceCount: 0
    },
    {
      kind: 'programme_candidates',
      target: 'visit',
      title: 'Visits matching “King Street”',
      total: 12,
      candidates: [1, 2].map((n) => ({
        ...candidate(n),
        detail: 'Dale Fielding · 2026-09-15'
      }))
    }
  ];

  it('sets no width a 400px screen could not hold', () => {
    for (const card of cards) {
      const tokens = classTokens(
        renderToStaticMarkup(
          <ResultCard card={card} onSelectCandidate={() => {}} />
        )
      );
      for (const token of tokens) {
        // A minimum width is what actually forces a sideways scroll; min-w-0 is
        // the opposite - it lets long addresses truncate.
        if (token.startsWith('min-w-')) expect(token).toBe('min-w-0');
        const arbitrary = /^w-\[(\d+)px\]$/.exec(token);
        if (arbitrary) expect(Number(arbitrary[1])).toBeLessThanOrEqual(400);
        // Tailwind's numeric widths are quarter-rem steps: w-100 is 400px.
        const step = /^w-(\d+)$/.exec(token);
        if (step) expect(Number(step[1])).toBeLessThanOrEqual(100);
      }
    }
  });

  it('puts no table in a programme card without a scroller of its own', () => {
    for (const card of cards) {
      const markup = renderToStaticMarkup(<ResultCard card={card} />);
      if (markup.includes('<table')) {
        expect(markup).toContain('overflow-x-auto');
      }
    }
  });
});

// Render example customer documents from fixture data, for manual inspection
// and for the visual-regression comparison.
//
//   npx jiti scripts/documents/render-samples.ts
//
// Output lands in `tmp/document-samples/`. Nothing here touches the database,
// storage or any hosted environment: it builds a `DocumentSource` by hand,
// resolves it and renders. That is the whole point - the renderer is a pure
// function of a snapshot, so it can be exercised without any of the rest.

import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { fixtureKitchenSink } from '../../src/features/presale/designer/calc/__tests__/fixtures';
import { computePricing } from '../../src/features/presale/designer/calc/pricing';
import { snapshotFromPricing } from '../../src/features/presale/designer/calc/summary';
import type { DesignState } from '../../src/features/presale/designer/types';
import {
  resolveDocument,
  type DocumentSource
} from '../../src/features/documents/resolve';
import { renderDocument } from '../../src/features/documents/render/render';
import { TEMPLATE_DIRS } from '../../src/features/documents/render/regions';
import {
  DOCUMENT_TYPES,
  type DocumentType
} from '../../src/features/documents/types';

const OUT = 'tmp/document-samples';

/** A design that prices, generates and has a consumption figure. */
function completeDesign(): DesignState {
  const design = fixtureKitchenSink();
  design.performance = {
    ...design.performance,
    annualConsumptionKwh: 4200,
    tariffPence: 27.49,
    segRatePence: 12,
    selfConsumptionPct: 70
  };
  // Give every elevation a radiance so the generation forecast exists.
  design.slopes = design.slopes.map((s) => ({
    ...s,
    radiance: s.radiance || 950,
    shadingPct: s.shadingPct === '' ? 5 : s.shadingPct
  }));
  return design;
}

interface Scenario {
  name: string;
  customer: DocumentSource['customer'];
  salesperson: DocumentSource['salesperson'];
  design?: DesignState;
}

/**
 * Variable-length content, as the brief requires it to be tested: the short
 * case, the long case, and a multi-line address.
 */
const SCENARIOS: Scenario[] = [
  {
    name: 'typical',
    customer: {
      firstName: 'Jane',
      lastName: 'Okonkwo',
      addressLine1: '14 Meadow Rise',
      addressLine2: null,
      town: 'Plymouth',
      postcode: 'PL4 6AB',
      email: 'jane.okonkwo@example.com',
      phone: '07700 900123'
    },
    salesperson: {
      displayName: 'Tom Reed',
      email: 'tom.reed@example.com',
      phone: '07700 900456'
    }
  },
  {
    name: 'short',
    customer: {
      firstName: 'Al',
      lastName: 'Ng',
      addressLine1: '1 Fore St',
      addressLine2: null,
      town: 'Looe',
      postcode: 'PL13 1AA',
      email: 'al@ng.uk',
      phone: '07700 900001'
    },
    salesperson: {
      displayName: 'Jo Fox',
      email: 'jo@example.com',
      phone: '07700 900002'
    }
  },
  {
    name: 'long',
    customer: {
      firstName: 'Alexandra-Josephine',
      lastName: 'Fitzwilliam-Harcourt',
      addressLine1: 'The Old Coach House, Bartholomew Lane',
      addressLine2: 'Higher Compton Barton',
      town: 'Newton Ferrers',
      postcode: 'PL8 1BZ',
      email: 'alexandra.fitzwilliam-harcourt@verylongdomainexample.co.uk',
      phone: '07700 900987'
    },
    salesperson: {
      displayName: 'Christopher Featherstonehaugh-Bellingham',
      email: 'christopher.featherstonehaugh-bellingham@example.com',
      phone: '07700 900654'
    }
  }
];

async function masterSha(documentType: DocumentType): Promise<string> {
  const bytes = await readFile(
    path.join(TEMPLATE_DIRS[documentType], 'master.pdf')
  );
  return createHash('sha256').update(bytes).digest('hex');
}

function sourceFor(scenario: Scenario): DocumentSource {
  const design = scenario.design ?? completeDesign();
  const pricing = computePricing(design)!;
  const computed = snapshotFromPricing(pricing);

  return {
    job: {
      id: '00000000-0000-4000-8000-000000000001',
      reference: 'SS-WDDG-5412',
      isHistoricalImport: false
    },
    customer: scenario.customer,
    salesperson: scenario.salesperson,
    presale: {
      id: '00000000-0000-4000-8000-000000000002',
      submittedAt: '2026-09-20T09:00:00.000Z',
      design,
      designSchemaVersion: 1,
      catalogueVersion: 'artifact-v0.12-2026-09-16',
      systemKwp: computed.system_kwp,
      netPanels: computed.net_panels,
      agreedPricePence: computed.computed_total_pence
    },
    settings: { electricityInflationPct: 5, segInflates: false },
    generatedAt: new Date('2026-09-20T10:30:00.000Z'),
    generatedByPersonId: '00000000-0000-4000-8000-000000000003'
  };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const shas: Record<string, string> = {};
  for (const t of DOCUMENT_TYPES) shas[t] = await masterSha(t);

  let failures = 0;

  for (const scenario of SCENARIOS) {
    const source = sourceFor(scenario);
    for (const documentType of DOCUMENT_TYPES) {
      const label = `${scenario.name}-${documentType}`;
      try {
        const { input, absent } = resolveDocument(
          documentType,
          source,
          shas[documentType]
        );
        const result = await renderDocument(input);
        const file = path.join(OUT, `${label}.pdf`);
        await writeFile(file, result.bytes);
        await writeFile(
          path.join(OUT, `${label}.input.json`),
          JSON.stringify(input, null, 2)
        );
        console.log(
          `  ok   ${label.padEnd(34)} ${result.pageCount} pages, ` +
            `${result.regionsDrawn} regions drawn` +
            (result.omittedPages.length
              ? `, ${result.omittedPages.length} withheld`
              : '') +
            (absent.length ? `, ${absent.length} optional absent` : '')
        );
      } catch (error) {
        failures++;
        const err = error as Error & { code?: string; unresolved?: unknown[] };
        console.log(
          `  FAIL ${label.padEnd(34)} ${err.code ?? ''} ${err.message}`
        );
        if (err.unresolved?.length) {
          for (const u of err.unresolved.slice(0, 8)) {
            console.log(`         - ${JSON.stringify(u)}`);
          }
        }
      }
    }
  }

  console.log(
    failures ? `\n${failures} scenario(s) failed.` : '\nAll scenarios rendered.'
  );
  if (failures) process.exitCode = 1;
}

main();

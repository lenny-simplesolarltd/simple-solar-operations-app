'use client';

import {
  layoutStats,
  maxCountFor,
  netCountForSlope,
  obstructionsFor,
  resolveComplexLayout,
  slopeGeometry,
  type SlopeGeometry
} from '../../designer/calc';
import { type PanelSpec } from '../../designer/catalogue';
import {
  editComplexLayout,
  patchSlope,
  toggleExclusion
} from '../../designer/mutations';
import {
  numOr0,
  type DesignState,
  type FixedOrientation,
  type Orientation,
  type Slope
} from '../../designer/types';
import { fmt } from '../../lib/format';
import { ComplexLayoutSvg } from '../svg/complex-layout-svg';
import { RoofGridSvg } from '../svg/roof-grid-svg';
import { BackButton, NextButton, StepFooter } from '../ui/nav-row';
import { StatStrip } from '../ui/stat-strip';
import { TogglePair } from '../ui/toggle-pair';
import { ObstructionList } from './obstructions-step';
import { type DesignStepProps, type DesignUpdater } from './types';
import { cx } from '../ui/cx';

const ORIENTATIONS: { value: Orientation; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'portrait', label: 'Portrait' },
  { value: 'landscape', label: 'Landscape' }
];

const FIXED_ORIENTATIONS: { value: FixedOrientation; label: string }[] = [
  { value: 'portrait', label: 'Portrait' },
  { value: 'landscape', label: 'Landscape' }
];

function ShiftRow({
  label,
  ariaLabel,
  value,
  onChange
}: {
  label: string;
  ariaLabel: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className='shift-row'>
      <span>{label}</span>
      <input
        type='range'
        min={-1}
        max={1}
        step={0.02}
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      />
      <button type='button' className='shift-reset' onClick={() => onChange(0)}>
        Center
      </button>
    </div>
  );
}

function Readout({ k, v, net }: { k: string; v: string; net?: boolean }) {
  return (
    <div className='readout'>
      <span className='k'>{k}</span>
      <span className={cx('v', net && 'net', 'num')}>{v}</span>
    </div>
  );
}

function RectLayoutCard({
  design,
  slope,
  geom,
  panel,
  update
}: {
  design: DesignState;
  slope: Slope;
  geom: SlopeGeometry;
  panel: PanelSpec;
  update: DesignUpdater;
}) {
  const r = netCountForSlope(design, slope, geom, panel);
  const fit = r.fit;
  // Sliders only appear when there is at least 2mm of slack on that axis.
  const hasH = fit.leftoverW >= 2;
  const hasV = fit.leftoverS >= 2;

  return (
    <article className='result-card card'>
      <div className='result-head'>
        <h3 className='display'>{slope.label}</h3>
      </div>
      <div className='result-body layout-grid'>
        <div className='layout-controls'>
          <TogglePair
            options={ORIENTATIONS}
            value={slope.orientation || 'auto'}
            ariaLabel={`Panel orientation on ${slope.label}`}
            style={{ marginBottom: 12 }}
            onChange={(orientation) =>
              update((d) => patchSlope(d, slope.id, { orientation }))
            }
          />
          {!hasH && !hasV ? (
            <p className='grid-hint' style={{ marginTop: 0, marginBottom: 12 }}>
              No spare room to shift on this slope — panels already fill the
              available space edge to edge.
            </p>
          ) : null}
          {hasH ? (
            <ShiftRow
              label='Shift array ←→'
              ariaLabel={`Shift array left or right on ${slope.label}`}
              value={slope.shiftBias || 0}
              onChange={(shiftBias) =>
                update((d) => patchSlope(d, slope.id, { shiftBias }))
              }
            />
          ) : null}
          {hasV ? (
            <ShiftRow
              label='Shift array ↕ (ridge/eave)'
              ariaLabel={`Shift array towards the ridge or the eave on ${slope.label}`}
              value={slope.shiftBiasV || 0}
              onChange={(shiftBiasV) =>
                update((d) => patchSlope(d, slope.id, { shiftBiasV }))
              }
            />
          ) : null}
          <div className='fit-summary'>
            <Readout k='Layout' v={`${fit.cols} × ${fit.rows}`} />
            <Readout k='Fit' v={String(fit.count)} />
            <Readout k='Excluded' v={String(r.excluded)} />
            <Readout k='Net' v={String(r.net)} net />
          </div>
          <ObstructionList obstructions={obstructionsFor(design, slope.id)} />
        </div>
        <div className='layout-canvas'>
          {fit.count <= 0 ? (
            <p className='empty-fit'>
              Nothing fits with the current dimensions / clearances — check your
              numbers.
            </p>
          ) : (
            <div className='grid-wrap'>
              <RoofGridSvg
                geom={geom}
                fit={fit}
                autoExcluded={r.autoExcluded}
                manualExcluded={r.manualExcluded}
                obstructions={obstructionsFor(design, slope.id)}
                onTogglePanel={(idx) =>
                  update((d) => toggleExclusion(d, slope.id, panel.id, idx))
                }
              />
              <p className='grid-hint'>
                Tap a panel to leave it out; tap again to put it back. Panels
                hatched red overlap a marked obstruction — change those on the
                Obstructions step. Ridge at top, gutter at bottom; small labels
                are the real gap on each side, bold labels the slope dimensions.
              </p>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function ComplexLayoutCard({
  design,
  slope,
  panel,
  update
}: {
  design: DesignState;
  slope: Slope;
  panel: PanelSpec;
  update: DesignUpdater;
}) {
  const maxCount = maxCountFor(slope, panel);
  if (maxCount <= 0) {
    return (
      <article className='result-card card'>
        <div className='result-head'>
          <h3 className='display'>{slope.label}</h3>
        </div>
        <div className='result-body'>
          <p className='hint'>
            Enter a max panel count for {panel.name} on this elevation’s Complex
            tab to build a layout here.
          </p>
        </div>
      </article>
    );
  }
  const layout = resolveComplexLayout(design, slope, panel);
  return (
    <article className='result-card card'>
      <div className='result-head'>
        <h3 className='display'>{slope.label}</h3>
      </div>
      <div className='result-body'>
        <TogglePair
          options={FIXED_ORIENTATIONS}
          value={layout.orientation || 'portrait'}
          ariaLabel={`Panel orientation on ${slope.label}`}
          style={{ marginBottom: 12 }}
          onChange={(orientation) =>
            update((d) =>
              editComplexLayout(d, slope.id, panel.id, {
                type: 'orientation',
                orientation
              })
            )
          }
        />
        <div className='fit-summary'>
          <Readout
            k='Panels in this layout'
            v={`${layout.cells.length} / ${maxCount}`}
            net
          />
        </div>
        <ComplexLayoutSvg
          panel={panel}
          layout={layout}
          maxCount={maxCount}
          gapMm={numOr0(design.params.gapMm)}
          onAdd={(cell) =>
            update((d) =>
              editComplexLayout(d, slope.id, panel.id, { type: 'add', cell })
            )
          }
          onRemove={(cell) =>
            update((d) =>
              editComplexLayout(d, slope.id, panel.id, { type: 'remove', cell })
            )
          }
        />
        <p className='grid-hint'>
          Tap a dashed + to add a panel next to any edge, or tap an existing
          panel to remove it.
        </p>
      </div>
    </article>
  );
}

export function LayoutStep({
  design,
  update,
  nav,
  panel
}: DesignStepProps & { panel: PanelSpec }) {
  const stats = layoutStats(design, panel);
  const cards = design.slopes
    .map((slope) => {
      if (slope.shapeMode === 'complex') {
        return (
          <ComplexLayoutCard
            key={slope.id}
            design={design}
            slope={slope}
            panel={panel}
            update={update}
          />
        );
      }
      const geom = slopeGeometry(slope);
      if (!geom.complete) return null;
      return (
        <RectLayoutCard
          key={slope.id}
          design={design}
          slope={slope}
          geom={geom}
          panel={panel}
          update={update}
        />
      );
    })
    .filter((card) => card !== null);

  return (
    <section aria-label='Layout'>
      <StatStrip
        tiles={[
          { label: 'Panels fit', value: String(stats.gross) },
          { label: 'Excluded', value: String(stats.excluded) },
          { label: 'Net panels', value: String(stats.net), accent: true },
          {
            label: 'System size',
            value: `${fmt(stats.kwp, 1)} kWp`,
            accent: true
          }
        ]}
      />
      <div className='selected-panel-bar'>
        <span>
          Panel:{' '}
          <strong>
            {panel.name} {panel.variant}
          </strong>
        </span>
        <button
          type='button'
          className='link-btn'
          onClick={() => nav.go('panels')}
        >
          Change panel
        </button>
      </div>
      <div>
        {cards.length ? (
          cards
        ) : (
          <p className='hint'>
            Add at least one elevation to see its layout here.
          </p>
        )}
      </div>
      <StepFooter>
        <BackButton onClick={() => nav.go('panels')}>
          ← Back to panels
        </BackButton>
        <NextButton onClick={() => nav.go('price')}>Next: price →</NextButton>
      </StepFooter>
    </section>
  );
}

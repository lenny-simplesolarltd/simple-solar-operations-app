'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode
} from 'react';

import '../presale.css';

import { type JobSoldResult, type PresaleWizardProps } from '../contract';
import {
  computePerformance,
  computePricing,
  ensureComplexLayouts
} from '../designer/calc';
import { panelById, type PanelId } from '../designer/catalogue';
import { selectPanel } from '../designer/mutations';
import { type DesignState } from '../designer/types';
import { presaleFontVariables } from '../fonts';
import {
  clearDraft,
  createDraft,
  loadDraft,
  saveDraft,
  type PresaleDraft
} from '../lib/draft';
import { firstBlocker, stepIndex, type StepKey } from '../lib/steps';
import {
  buildSubmission,
  fieldLeaf,
  resolveSale,
  stepForServerField,
  type SalesContext
} from '../lib/submission';
import { JobSoldScreen } from './job-sold-screen';
import { CustomerStep } from './steps/customer-step';
import { ElevationsStep } from './steps/elevations-step';
import { LayoutStep } from './steps/layout-step';
import { ObstructionsStep } from './steps/obstructions-step';
import { PanelsStep } from './steps/panels-step';
import { ParametersStep } from './steps/parameters-step';
import { PerformanceStep } from './steps/performance-step';
import { PriceStep } from './steps/price-step';
import { SaleStep } from './steps/sale-step';
import { type StepNav } from './steps/types';
import { Stepper } from './stepper';
import { WarnBanner } from './ui/banner';
import { cx } from './ui/cx';

const NEW_JOB_CONFIRM_MS = 4000;

const subscribeNever = () => () => {};

/** False on the server and during hydration, true afterwards. */
function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false
  );
}

function Shell({
  children,
  headerAction
}: {
  children: ReactNode;
  headerAction?: ReactNode;
}) {
  return (
    <div className={cx('presale-root', presaleFontVariables)}>
      <div className='app'>
        <header className='site-head'>
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand mark; intrinsic size set */}
          <img
            className='brand-logo'
            src='/presale/logo.webp'
            width={2500}
            height={571}
            alt='Simple Solar'
          />
          {headerAction}
        </header>
        {children}
      </div>
    </div>
  );
}

/**
 * Presale / System Designer wizard. The draft lives in localStorage, so the
 * editor itself only mounts on the client (after hydration) and can read its
 * saved draft straight into initial state without a hydration mismatch.
 */
export function PresaleWizard(props: PresaleWizardProps) {
  const isClient = useIsClient();
  if (!isClient) {
    return (
      <Shell>
        <div className='card loading-card' aria-busy='true'>
          Loading your draft…
        </div>
      </Shell>
    );
  }
  return <WizardEditor key={props.currentUser.personId} {...props} />;
}

function NewJobButton({ onConfirm }: { onConfirm: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const onClick = () => {
    if (timer.current) clearTimeout(timer.current);
    if (!confirming) {
      setConfirming(true);
      timer.current = setTimeout(
        () => setConfirming(false),
        NEW_JOB_CONFIRM_MS
      );
      return;
    }
    setConfirming(false);
    onConfirm();
  };

  return (
    <button
      type='button'
      className={cx('newjob-btn', confirming && 'confirming')}
      onClick={onClick}
    >
      {confirming ? 'Tap again to clear' : 'New job'}
    </button>
  );
}

interface SubmitError {
  message: string;
  field: string | null;
  /** Step the message belongs to, so it shows there too. */
  step: StepKey;
}

function WizardEditor({
  currentUser,
  salespeople,
  canSubmitOnBehalf,
  submitAction
}: PresaleWizardProps) {
  const personId = currentUser.personId;
  const [draft, setDraft] = useState<PresaleDraft>(
    () => loadDraft(personId) ?? createDraft()
  );
  const [sold, setSold] = useState<JobSoldResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const inFlight = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const lastStep = useRef<StepKey>(draft.step);

  // Autosave. Skipped once the job is sold: that draft is spent.
  useEffect(() => {
    if (!sold) saveDraft(personId, draft);
  }, [draft, personId, sold]);

  // Each step starts at the top, whatever element happens to be scrolling.
  useEffect(() => {
    if (lastStep.current === draft.step && !sold) return;
    lastStep.current = draft.step;
    rootRef.current?.scrollIntoView({ block: 'start' });
  }, [draft.step, sold]);

  const ctx: SalesContext = useMemo(
    () => ({ currentUserId: personId, salespeople, canSubmitOnBehalf }),
    [personId, salespeople, canSubmitOnBehalf]
  );

  const { design } = draft;
  const pricing = useMemo(() => computePricing(design), [design]);
  const performance = useMemo(() => computePerformance(design), [design]);
  const panel = panelById(design.selectedPanelId);
  const resolved = resolveSale(draft, pricing, ctx);

  const updateDesign = useCallback(
    (recipe: (d: DesignState) => DesignState) => {
      setSubmitError(null);
      setDraft((d) => ({ ...d, design: recipe(d.design) }));
    },
    []
  );

  const go = useCallback((target: StepKey) => {
    setDraft((d) => {
      const forward = stepIndex(target) > stepIndex(d.step);
      if (forward && firstBlocker(d, d.step, target)) return d;
      const targetPanel = panelById(d.design.selectedPanelId);
      return {
        ...d,
        step: target,
        maxStep: Math.max(d.maxStep, stepIndex(target)),
        // Opening Layout materialises Complex layouts, as the prototype did.
        design:
          target === 'layout' && targetPanel
            ? ensureComplexLayouts(d.design, targetPanel)
            : d.design
      };
    });
  }, []);

  const nav: StepNav = useMemo(() => ({ go }), [go]);

  const onStepperSelect = (target: StepKey) => {
    if (stepIndex(target) > draft.maxStep) return;
    go(target);
  };

  const onSelectPanel = (panelId: PanelId) => {
    setDraft((d) => ({
      ...d,
      design: selectPanel(d.design, panelId),
      step: 'layout',
      maxStep: Math.max(d.maxStep, stepIndex('layout'))
    }));
  };

  const startFresh = () => {
    clearDraft(personId);
    setSubmitError(null);
    setSold(null);
    setDraft(createDraft());
  };

  const onSubmit = async () => {
    // The ref (not the state) is the guard: two taps in one frame both see
    // submitting === false, but only the first sees inFlight === false.
    if (inFlight.current) return;
    const built = buildSubmission(draft, ctx);
    if (!built.ok) {
      const { problem } = built;
      setSubmitError({
        message: problem.message,
        field: fieldLeaf(problem.field),
        step: problem.step
      });
      if (problem.step !== draft.step)
        setDraft((d) => ({ ...d, step: problem.step }));
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      // The same commandId goes out on every retry of this draft, so a sale
      // whose first response was lost is replayed, never recorded twice.
      const response = await submitAction(draft.commandId, built.submission);
      if (response.ok) {
        clearDraft(personId);
        setSold(response.result);
      } else {
        const step =
          (response.field && stepForServerField(response.field)) || 'sale';
        setSubmitError({
          message: response.message,
          field: fieldLeaf(response.field),
          step
        });
        if (step !== draft.step) setDraft((d) => ({ ...d, step }));
      }
    } catch {
      setSubmitError({
        message:
          'The sale could not be sent — check your connection and try again. Your draft is saved, and submitting again will not record the sale twice.',
        field: null,
        step: 'sale'
      });
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  if (sold) {
    return (
      <div ref={rootRef}>
        <Shell>
          <JobSoldScreen result={sold} onStartAnother={startFresh} />
        </Shell>
      </div>
    );
  }

  const errorField = submitError ? submitError.field : null;
  const stepError =
    submitError && submitError.step === draft.step && draft.step !== 'sale'
      ? submitError.message
      : null;
  // Layout needs a panel; without one (e.g. an old draft) fall back to Panels.
  const step: StepKey =
    draft.step === 'layout' && !panel ? 'panels' : draft.step;

  return (
    <div ref={rootRef}>
      <Shell
        headerAction={
          submitting ? null : <NewJobButton onConfirm={startFresh} />
        }
      >
        {/* Frozen while a submit is in flight, so what was sent is what is on screen. */}
        <div inert={submitting}>
          <Stepper
            current={step}
            maxStep={draft.maxStep}
            onSelect={onStepperSelect}
          />

          {stepError ? (
            <div style={{ marginBottom: 14 }}>
              <WarnBanner>{stepError}</WarnBanner>
            </div>
          ) : null}

          {step === 'customer' ? (
            <CustomerStep
              customer={draft.customer}
              design={design}
              nav={nav}
              errorField={errorField}
              onChange={(patch) => {
                setSubmitError(null);
                setDraft((d) => ({
                  ...d,
                  customer: { ...d.customer, ...patch }
                }));
              }}
            />
          ) : null}
          {step === 'parameters' ? (
            <ParametersStep
              design={design}
              update={updateDesign}
              nav={nav}
              customer={draft.customer}
            />
          ) : null}
          {step === 'elevations' ? (
            <ElevationsStep
              design={design}
              update={updateDesign}
              nav={nav}
              customer={draft.customer}
            />
          ) : null}
          {step === 'obstructions' ? (
            <ObstructionsStep design={design} update={updateDesign} nav={nav} />
          ) : null}
          {step === 'panels' ? (
            <PanelsStep
              design={design}
              nav={nav}
              onSelectPanel={onSelectPanel}
            />
          ) : null}
          {step === 'layout' && panel ? (
            <LayoutStep
              design={design}
              update={updateDesign}
              nav={nav}
              panel={panel}
            />
          ) : null}
          {step === 'price' ? (
            <PriceStep
              design={design}
              update={updateDesign}
              nav={nav}
              pricing={pricing}
              customer={draft.customer}
            />
          ) : null}
          {step === 'performance' ? (
            <PerformanceStep perf={performance} nav={nav} />
          ) : null}
          {step === 'sale' ? (
            <SaleStep
              draft={draft}
              pricing={pricing}
              resolved={resolved}
              ctx={ctx}
              currentUserName={currentUser.displayName}
              submitting={submitting}
              error={
                submitError && submitError.step === 'sale'
                  ? submitError.message
                  : null
              }
              errorField={errorField}
              nav={nav}
              onSubmit={onSubmit}
              onSaleChange={(patch) => {
                setSubmitError(null);
                setDraft((d) => ({ ...d, sale: { ...d.sale, ...patch } }));
              }}
              onScopeChange={(patch) => {
                setSubmitError(null);
                setDraft((d) => ({ ...d, scope: { ...d.scope, ...patch } }));
              }}
            />
          ) : null}
        </div>
      </Shell>
    </div>
  );
}

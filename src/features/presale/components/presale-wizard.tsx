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
import '../presale-workspace.css';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet';

import { type JobSoldResult, type PresaleWizardProps } from '../contract';
import {
  computePerformance,
  computePricing,
  ensureComplexLayouts,
  jobHasObstructableSlopes
} from '../designer/calc';
import { panelById, type PanelId } from '../designer/catalogue';
import { selectPanel } from '../designer/mutations';
import { type DesignState } from '../designer/types';
import { presaleFontVariables } from '../fonts';
import {
  clearDraft,
  createDraft,
  draftKey,
  loadDraft,
  saveDraft,
  type PresaleDraft
} from '../lib/draft';
import { fmt, money } from '../lib/format';
import {
  STEP_KEYS,
  STEP_LABELS,
  firstBlocker,
  stepBlocker,
  stepIndex,
  type StepKey
} from '../lib/steps';
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
import { Stepper, type StepStatus } from './stepper';
import { SystemSummary } from './system-summary';
import { WarnBanner } from './ui/banner';
import { cx } from './ui/cx';

const subscribeNever = () => () => {};

/** False on the server and during hydration, true afterwards. */
function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false
  );
}

const CLOCK = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit'
});

type SaveState = { at: number; stored: boolean } | null;

/** A tiny store for "when did the draft last reach localStorage". */
function createSaveStore() {
  let value: SaveState = null;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next: SaveState) => {
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    }
  };
}

function Shell({
  children,
  context,
  status,
  headerAction
}: {
  children: ReactNode;
  /** Who / where this presale is for, once known. */
  context?: string;
  status?: ReactNode;
  headerAction?: ReactNode;
}) {
  return (
    <div className={cx('presale-root', presaleFontVariables)}>
      <div className='app ws'>
        <header className='site-head ws-head'>
          <div className='ws-head-main'>
            <h2 className='page-title'>New presale</h2>
            <p className='page-sub'>{context || 'New customer'}</p>
          </div>
          <div className='ws-head-side'>
            {status}
            {headerAction}
          </div>
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

/** Discarding a draft is the one destructive action here, so it asks once, properly. */
function StartOverButton({ onConfirm }: { onConfirm: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button type='button' className='newjob-btn'>
          Start over
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Start a new presale?</AlertDialogTitle>
          <AlertDialogDescription>
            This clears the draft saved on this device, including the customer
            and the roof design. It cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep this draft</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            Clear and start new
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DraftStatus({ state }: { state: SaveState }) {
  if (!state) return null;
  return state.stored ? (
    <span
      className='draft-status'
      title='The draft is kept in this browser only, not on the server.'
    >
      <span className='draft-dot' aria-hidden='true' />
      Draft saved on this device · {CLOCK.format(state.at)}
    </span>
  ) : (
    <span className='draft-status unsaved' role='status'>
      Draft not saved — this browser is blocking storage
    </span>
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
  const [stepsOpen, setStepsOpen] = useState(false);
  const [saveStore] = useState(createSaveStore);
  const saveState = useSyncExternalStore(
    saveStore.subscribe,
    saveStore.get,
    () => null
  );

  // Autosave. Skipped once the job is sold: that draft is spent.
  useEffect(() => {
    if (sold) return;
    saveDraft(personId, draft);
    // saveDraft swallows storage failures, so look before telling the
    // surveyor their work is safe.
    let stored = false;
    try {
      stored = window.localStorage.getItem(draftKey(personId)) !== null;
    } catch {
      stored = false;
    }
    saveStore.set({ at: Date.now(), stored });
  }, [draft, personId, sold, saveStore]);

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

  const customerName =
    `${draft.customer.firstName} ${draft.customer.lastName}`.trim();
  const context = [customerName, draft.customer.postcode.trim()]
    .filter(Boolean)
    .join(' · ');

  if (sold) {
    return (
      <div ref={rootRef}>
        <Shell context={context}>
          <JobSoldScreen
            result={sold}
            onStartAnother={startFresh}
            summary={{
              systemKwp: pricing ? pricing.totalKwp : null,
              netPanels: pricing ? pricing.totalNetPanels : null,
              panelName: pricing
                ? `${pricing.panel.name} ${pricing.panel.variant}`
                : null,
              agreedPricePence: resolved.agreedPricePence,
              financeRoute: resolved.financeRoute
            }}
          />
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
  const currentIndex = stepIndex(step);

  // What the step list says about each step. Read straight from the same gate
  // rules that enable / disable Next - nothing is decided here.
  const statuses: Partial<Record<StepKey, StepStatus>> = {};
  STEP_KEYS.forEach((key, i) => {
    if (key === step) statuses[key] = 'current';
    else if (submitError && submitError.step === key)
      statuses[key] = 'attention';
    else if (i > draft.maxStep) statuses[key] = 'todo';
    else if (key === 'obstructions' && !jobHasObstructableSlopes(design))
      statuses[key] = 'skipped';
    else if (key === 'layout' && !panel) statuses[key] = 'attention';
    else if (stepBlocker(key, draft)) statuses[key] = 'attention';
    else statuses[key] = key === 'sale' ? 'todo' : 'complete';
  });

  const headline = pricing
    ? `${pricing.totalNetPanels} panels · ${fmt(pricing.totalKwp, 2)} kWp · ${money(pricing.total)}`
    : null;

  const selectStep = (target: StepKey) => {
    setStepsOpen(false);
    onStepperSelect(target);
  };

  // Enter in a text / number box continues, exactly as pressing Next would.
  // Never on the final step: a sale is not submitted by a stray keypress.
  const onWorkspaceKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || step === 'sale') return;
    const target = e.target as HTMLElement;
    if (!(target instanceof HTMLInputElement)) return;
    if (!['text', 'number', 'email', 'tel'].includes(target.type)) return;
    if (target.classList.contains('slope-label')) return;
    const next = e.currentTarget.querySelector<HTMLButtonElement>(
      '.step-footer .btn-primary'
    );
    if (!next || next.disabled) return;
    e.preventDefault();
    target.blur();
    next.click();
  };

  const stepList = (
    <Stepper
      current={step}
      maxStep={draft.maxStep}
      statuses={statuses}
      onSelect={selectStep}
    />
  );
  const summary = (
    <SystemSummary design={design} pricing={pricing} resolved={resolved} />
  );

  return (
    <div ref={rootRef}>
      <Shell
        context={context}
        status={<DraftStatus state={saveState} />}
        headerAction={
          submitting ? null : <StartOverButton onConfirm={startFresh} />
        }
      >
        {/* Frozen while a submit is in flight, so what was sent is what is on screen. */}
        <div className='ws-body' inert={submitting}>
          <aside className='ws-rail' aria-label='Presale steps and system'>
            {stepList}
            {summary}
          </aside>

          <div className='ws-main' onKeyDown={onWorkspaceKeyDown}>
            {/* Narrow screens: the rail collapses into this bar and a sheet. */}
            <div className='ws-progress'>
              <button
                type='button'
                className='ws-progress-btn'
                aria-haspopup='dialog'
                onClick={() => setStepsOpen(true)}
              >
                <span className='ws-progress-where'>
                  <span className='ws-progress-count'>
                    Step {currentIndex + 1} of {STEP_KEYS.length}
                  </span>
                  <strong>{STEP_LABELS[step]}</strong>
                </span>
                <span className='ws-progress-all'>All steps</span>
              </button>
              <div className='ws-progress-bar' aria-hidden='true'>
                {STEP_KEYS.map((key) => (
                  <span key={key} data-status={statuses[key]} />
                ))}
              </div>
              {headline ? (
                <p className='ws-progress-sum num'>{headline}</p>
              ) : null}
            </div>

            <div className='ws-step-head'>
              <span className='ws-step-count'>
                Step {currentIndex + 1} of {STEP_KEYS.length}
              </span>
              <h1 className='ws-step-title'>{STEP_LABELS[step]}</h1>
            </div>

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
              <ObstructionsStep
                design={design}
                update={updateDesign}
                nav={nav}
              />
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
        </div>

        <Sheet open={stepsOpen} onOpenChange={setStepsOpen}>
          <SheetContent side='bottom' className='max-h-[88dvh] overflow-y-auto'>
            <SheetHeader>
              <SheetTitle>Presale steps</SheetTitle>
              <SheetDescription>
                Go back to any step you have reached. Nothing you entered is
                lost.
              </SheetDescription>
            </SheetHeader>
            <div className='presale-root presale-sheet'>
              {stepList}
              {summary}
            </div>
          </SheetContent>
        </Sheet>
      </Shell>
    </div>
  );
}

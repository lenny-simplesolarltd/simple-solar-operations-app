import { type DesignState } from '../../designer/types';
import { type StepKey } from '../../lib/steps';

export type DesignUpdater = (
  recipe: (design: DesignState) => DesignState
) => void;

export interface StepNav {
  /**
   * Go to a step. Forward moves unlock the target and are refused while any
   * step in between still has a blocker; backward moves always succeed.
   */
  go: (target: StepKey) => void;
}

export interface DesignStepProps {
  design: DesignState;
  update: DesignUpdater;
  nav: StepNav;
}

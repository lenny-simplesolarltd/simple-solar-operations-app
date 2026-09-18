import { type ReactNode } from 'react';

export function NavRow({ children }: { children: ReactNode }) {
  return <div className='nav-row'>{children}</div>;
}

export function BackButton({
  onClick,
  children = '← Back'
}: {
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <button type='button' className='btn btn-secondary' onClick={onClick}>
      {children}
    </button>
  );
}

export function NextButton({
  onClick,
  disabled,
  children
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type='button'
      className='btn btn-primary'
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * The step's action bar. It sticks to the bottom of the workspace, so Back /
 * Next are always in the same place, with the reason Next is disabled (if any)
 * directly above them rather than below the fold.
 */
export function StepFooter({
  note,
  children
}: {
  note?: string | null;
  children: ReactNode;
}) {
  return (
    <div className='step-footer'>
      <NavNote message={note ?? null} />
      <NavRow>{children}</NavRow>
    </div>
  );
}

/** Says why Next is disabled. */
export function NavNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className='nav-note' role='status'>
      {message}
    </div>
  );
}

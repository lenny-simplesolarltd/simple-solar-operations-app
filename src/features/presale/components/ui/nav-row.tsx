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

/** Red, centred line under the nav row saying why Next is disabled. */
export function NavNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className='nav-note' role='status'>
      {message}
    </div>
  );
}

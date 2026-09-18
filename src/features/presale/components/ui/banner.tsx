import { type ReactNode } from 'react';

export function WarnBanner({ children }: { children: ReactNode }) {
  return (
    <div className='warn-banner' role='alert'>
      {children}
    </div>
  );
}

export function InfoBanner({ children }: { children: ReactNode }) {
  return (
    <div className='info-banner' role='status'>
      {children}
    </div>
  );
}

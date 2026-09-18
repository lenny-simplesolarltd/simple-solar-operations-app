import { type CSSProperties, type ReactNode } from 'react';

export function Card({
  title,
  hint,
  children
}: {
  title?: string;
  hint?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={children ? 'card' : 'card card-intro'}>
      {title ? <h2>{title}</h2> : null}
      {hint ? <p className='hint'>{hint}</p> : null}
      {children}
    </div>
  );
}

export function FieldLabel({
  children,
  style
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div className='field-label' style={style}>
      {children}
    </div>
  );
}

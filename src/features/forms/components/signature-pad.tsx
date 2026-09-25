'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useCallback, useRef, useState } from 'react';
import { SIGNATURE_BOX, SIGNATURE_MAX_LENGTH } from '../definition';

/**
 * Signing with a finger.
 *
 * Forms could collect a photograph, but only from a signed-in staff member,
 * because a photo becomes canonical evidence and evidence needs an owner - so a
 * form carrying one cannot be sent as a recipient link at all. Which ruled out
 * the case people actually ask for: the customer signing on their own phone.
 *
 * So the drawing is the answer, not a file. It is captured as SVG path data in
 * a fixed 600x200 space whatever the size of the screen, which is why a
 * signature drawn on a phone renders correctly on an A4 print of the response
 * without anything storing the canvas it came from.
 *
 * Pointer events rather than separate mouse and touch handlers, so a finger, a
 * stylus and a mouse are all the same code path; `touch-none` stops the browser
 * scrolling the page while somebody is signing it.
 */

/** Two decimal places is under a millimetre here, and keeps the value small. */
const round = (n: number) => Math.round(n * 100) / 100;

export function SignaturePad({
  value,
  onChange,
  inputId,
  describedBy,
  invalid,
  disabled
}: {
  value: string;
  onChange: (value: string | undefined) => void;
  inputId?: string;
  describedBy?: string;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const surfaceRef = useRef<SVGSVGElement>(null);
  const strokeRef = useRef<string>('');
  const [drawing, setDrawing] = useState(false);
  // The committed strokes, and the one in progress, kept apart so the line
  // being drawn appears immediately without rewriting the answer on every move.
  const [live, setLive] = useState('');

  const pointIn = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    const box = surfaceRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return null;
    // Screen pixels to the fixed coordinate space, so what is stored does not
    // depend on the device it was signed on.
    return {
      x: round(((e.clientX - box.left) / box.width) * SIGNATURE_BOX.width),
      y: round(((e.clientY - box.top) / box.height) * SIGNATURE_BOX.height)
    };
  }, []);

  const start = (e: React.PointerEvent<SVGSVGElement>) => {
    if (disabled) return;
    const p = pointIn(e);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrawing(true);
    strokeRef.current = `M${p.x} ${p.y}`;
    setLive(strokeRef.current);
  };

  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drawing || disabled) return;
    const p = pointIn(e);
    if (!p) return;
    strokeRef.current = `${strokeRef.current} L${p.x} ${p.y}`;
    setLive(strokeRef.current);
  };

  const end = () => {
    if (!drawing) return;
    setDrawing(false);
    const stroke = strokeRef.current;
    strokeRef.current = '';
    setLive('');
    // A tap with no movement is not a signature; it would store a lone move
    // command that draws nothing and still count as answered.
    if (!stroke.includes('L')) return;
    const next = value ? `${value} ${stroke}` : stroke;
    // Refused rather than silently truncated: half a signature is not one, and
    // the database would reject the value anyway.
    if (next.length > SIGNATURE_MAX_LENGTH) return;
    onChange(next);
  };

  const clear = () => {
    strokeRef.current = '';
    setLive('');
    onChange(undefined);
  };

  const drawn = value || live;

  return (
    <div className='flex flex-col gap-2'>
      <svg
        ref={surfaceRef}
        id={inputId}
        role='img'
        aria-label={
          value ? 'Signature, drawn' : 'Signature box. Draw your signature here'
        }
        aria-describedby={describedBy}
        viewBox={`0 0 ${SIGNATURE_BOX.width} ${SIGNATURE_BOX.height}`}
        preserveAspectRatio='xMidYMid meet'
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        onPointerCancel={end}
        className={cn(
          'bg-background w-full touch-none rounded-lg border-2 border-dashed',
          // A signature is a big target on purpose: it is drawn with a finger.
          'h-40 sm:h-44',
          invalid && 'border-destructive',
          disabled ? 'opacity-60' : 'cursor-crosshair',
          drawing && 'border-solid'
        )}
      >
        {drawn ? (
          <path
            d={drawn}
            fill='none'
            stroke='currentColor'
            strokeWidth={3}
            strokeLinecap='round'
            strokeLinejoin='round'
          />
        ) : (
          <text
            x={SIGNATURE_BOX.width / 2}
            y={SIGNATURE_BOX.height / 2}
            textAnchor='middle'
            className='fill-muted-foreground text-[18px]'
          >
            Sign here
          </text>
        )}
      </svg>
      <div className='flex items-center gap-3'>
        <Button
          type='button'
          variant='outline'
          size='sm'
          className='min-h-11'
          onClick={clear}
          disabled={disabled || !value}
        >
          Clear
        </Button>
        <p className='text-muted-foreground text-xs'>
          {value
            ? 'Signed. Clear it to sign again.'
            : 'Draw with your finger or mouse.'}
        </p>
      </div>
    </div>
  );
}

/**
 * A signature as drawn, for reading back on a response or a printed copy.
 *
 * `d` is the only thing taken from the stored value, and the value has already
 * been through the allow-list on both sides - so nothing but path commands can
 * reach this attribute.
 */
export function SignatureImage({
  value,
  className
}: {
  value: string;
  className?: string;
}) {
  return (
    <svg
      role='img'
      aria-label='Signature'
      viewBox={`0 0 ${SIGNATURE_BOX.width} ${SIGNATURE_BOX.height}`}
      preserveAspectRatio='xMidYMid meet'
      className={cn('bg-background h-24 w-full rounded-md border', className)}
    >
      <path
        d={value}
        fill='none'
        stroke='currentColor'
        strokeWidth={3}
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  );
}

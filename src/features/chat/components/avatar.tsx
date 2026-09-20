'use client';

// Initials, coloured from the name. Nobody has uploaded a photograph to this
// system and there is no avatar store, so this is the honest version of
// "participant information": something recognisable at a glance that does not
// pretend to be a picture.

const TONES = [
  'bg-info-soft text-info',
  'bg-success-soft text-success',
  'bg-warning-soft text-warning',
  'bg-destructive-soft text-destructive',
  'bg-accent text-accent-foreground'
];

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Stable per name, so the same colleague is the same colour every time. */
export function toneFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1)
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return TONES[hash % TONES.length];
}

export function Avatar({
  name,
  size = 'default'
}: {
  name: string;
  size?: 'default' | 'sm';
}) {
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-medium ${toneFor(name)} ${
        size === 'sm' ? 'size-6 text-[10px]' : 'size-8 text-xs'
      }`}
    >
      {initials(name)}
    </span>
  );
}

/** A command id for an optimistic action, so a retry replays rather than repeats. */
export function newCommandId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

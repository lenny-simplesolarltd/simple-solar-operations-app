import { Big_Shoulders, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';

// The prototype's three faces, exposed as CSS variables on .presale-root.
// Google folded "Big Shoulders Display" into the variable "Big Shoulders"
// family (the Display cut is its opsz 72 end), which is what next/font ships.

const sans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-presale-sans',
  display: 'swap'
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-presale-mono',
  display: 'swap'
});

const display = Big_Shoulders({
  subsets: ['latin'],
  // next/font has no fallback metrics for this family; headings tolerate the swap.
  adjustFontFallback: false,
  axes: ['opsz'],
  variable: '--font-presale-display',
  display: 'swap'
});

export const presaleFontVariables = `${sans.variable} ${mono.variable} ${display.variable}`;

import { Poppins } from 'next/font/google';

// Poppins is the Simple Solar brand face (headings 800, body 500 on the
// website). The app uses the same family at lighter working weights.
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-poppins',
  display: 'swap'
});

export const fontVariables = poppins.variable;

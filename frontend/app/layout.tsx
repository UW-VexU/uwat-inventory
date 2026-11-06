import type { Metadata, Viewport } from 'next';
import { Barlow, Chakra_Petch } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

const display = Chakra_Petch({
  subsets: ['latin'],
  weight: ['500', '700'],
  style: ['normal', 'italic'],
  variable: '--font-display',
});

const body = Barlow({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-body',
});

export const metadata: Metadata = {
  title: 'UWAT Inventory',
  description: 'Parts inventory for UWAT VEXU Competitive Robotics.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: '#111111' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}

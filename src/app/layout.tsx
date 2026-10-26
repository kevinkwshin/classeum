import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans_KR, Inter_Tight, Unbounded } from 'next/font/google';
import './globals.css';

const plexKr = IBM_Plex_Sans_KR({ variable: '--font-plex-kr', weight: ['400', '600', '700'], subsets: ['latin'], preload: false });
const interTight = Inter_Tight({ variable: '--font-inter-tight', subsets: ['latin'] });
const unbounded = Unbounded({ variable: '--font-unbounded', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Classeum',
  description: '운동장에서 함께 푸는 영단어 퀴즈',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#101218',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${plexKr.variable} ${interTight.variable} ${unbounded.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}

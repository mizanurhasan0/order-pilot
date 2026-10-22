import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'OrderPilot',
    template: '%s · OrderPilot',
  },
  description: 'A local merchant dashboard for the orders your Facebook Messenger bot collects.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#f8faf8',
  colorScheme: 'light',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

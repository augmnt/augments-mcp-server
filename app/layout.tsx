import type { Metadata } from 'next';
import { JetBrains_Mono } from 'next/font/google';

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'augments - MCP server',
  description:
    'Types, docs, and examples from npm for Claude Code.',
  openGraph: {
    type: 'website',
    title: 'augments - MCP server',
    description:
      'Types, docs, and examples from npm for Claude Code.',
    url: 'https://mcp.augments.dev',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className={jetbrainsMono.className}
        style={{
          margin: 0,
          backgroundColor: '#09090b',
          color: '#fafafa',
          WebkitFontSmoothing: 'antialiased',
        }}
      >
        {children}
      </body>
    </html>
  );
}

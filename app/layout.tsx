import type { Metadata } from 'next';

export const metadata: Metadata = {
  metadataBase: new URL('https://augments.dev'),
  title: 'Augments — Types, docs, and examples from npm for Claude Code',
  description:
    'An MCP server that gives Claude Code type signatures, prose docs, and code examples from any npm package.',
  keywords: [
    'mcp',
    'model context protocol',
    'claude code',
    'npm',
    'typescript',
    'code examples',
    'api documentation',
    'developer tools',
  ],
  openGraph: {
    title: 'Augments — Types, docs, and examples from npm for Claude Code',
    description:
      'An MCP server that gives Claude Code type signatures, prose docs, and code examples from any npm package.',
    url: 'https://augments.dev',
    siteName: 'Augments',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Augments — Types, docs, and examples from npm for Claude Code',
    description:
      'An MCP server that gives Claude Code type signatures, prose docs, and code examples from any npm package.',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  );
}

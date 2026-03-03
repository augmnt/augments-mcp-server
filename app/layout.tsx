export const metadata = {
  title: 'Augments MCP Server',
  description: 'Framework documentation provider for AI assistants',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

import { Metadata } from 'next';

export const metadata: Metadata = {
  alternates: { canonical: 'https://augments.dev' },
};

/* ── palette ──────────────────────────────────────────────────────── */
const c = {
  bg: '#0a0a0a',
  surface: '#141414',
  surfaceAlt: '#1a1a1a',
  border: '#262626',
  borderSubtle: '#1e1e1e',
  text: '#e5e5e5',
  textMuted: '#a3a3a3',
  textDim: '#737373',
  accent: '#3b82f6',
  accentDim: '#1d4ed8',
  green: '#22c55e',
  greenDim: '#166534',
  red: '#ef4444',
  redDim: '#991b1b',
} as const;

/* ── shared styles ────────────────────────────────────────────────── */
const mono: React.CSSProperties = { fontFamily: "'SF Mono', 'Fira Code', 'JetBrains Mono', Menlo, monospace" };
const codeBlock: React.CSSProperties = {
  ...mono,
  fontSize: '13px',
  lineHeight: '1.6',
  background: c.surface,
  border: `1px solid ${c.border}`,
  borderRadius: '8px',
  padding: '1.25rem',
  overflowX: 'auto',
  whiteSpace: 'pre',
  color: c.text,
};

const badge = (color: string, bg: string): React.CSSProperties => ({
  ...mono,
  fontSize: '11px',
  fontWeight: 600,
  color,
  background: bg,
  padding: '2px 8px',
  borderRadius: '4px',
  letterSpacing: '0.02em',
});

/* ── page ─────────────────────────────────────────────────────────── */
export default function Home() {
  return (
    <div style={{ background: c.bg, color: c.text, minHeight: '100vh' }}>
      <main style={{
        maxWidth: '720px',
        margin: '0 auto',
        padding: '4rem 1.5rem 3rem',
      }}>

        {/* ── Hero ─────────────────────────────────────── */}
        <section style={{ marginBottom: '4rem' }}>
          <h1 style={{
            ...mono,
            fontSize: '14px',
            fontWeight: 600,
            color: c.accent,
            marginBottom: '1.5rem',
            letterSpacing: '0.04em',
          }}>
            augments
          </h1>
          <p style={{
            fontSize: '1.65rem',
            lineHeight: 1.4,
            fontWeight: 500,
            color: c.text,
            marginBottom: '1rem',
          }}>
            An MCP server that gives Claude Code<br />
            types, docs, and examples from npm.
          </p>
          <p style={{
            fontSize: '1.1rem',
            color: c.textMuted,
            marginBottom: '2rem',
          }}>
            Any package. Not just a curated list.
          </p>

          <pre style={{
            ...mono,
            fontSize: '13px',
            color: c.textMuted,
            background: c.surface,
            border: `1px solid ${c.border}`,
            borderRadius: '8px',
            padding: '1rem 1.25rem',
            overflowX: 'auto',
            whiteSpace: 'pre',
          }}>
{`claude mcp add augments -- npx augments-mcp-server@latest`}
          </pre>
        </section>

        {/* ── Before / After ───────────────────────────── */}
        <section style={{ marginBottom: '4rem' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '1rem',
          }}>
            {/* Before */}
            <div style={{
              background: c.surface,
              border: `1px solid ${c.border}`,
              borderRadius: '8px',
              padding: '1.25rem',
            }}>
              <div style={{ marginBottom: '0.75rem' }}>
                <span style={badge(c.red, c.redDim)}>WITHOUT</span>
              </div>
              <p style={{ ...mono, fontSize: '13px', color: c.textMuted, lineHeight: 1.6 }}>
                Claude reads 50KB of bundled docs<br />
                Guesses at API signatures<br />
                Hallucinates parameters
              </p>
            </div>

            {/* After */}
            <div style={{
              background: c.surface,
              border: `1px solid ${c.border}`,
              borderRadius: '8px',
              padding: '1.25rem',
            }}>
              <div style={{ marginBottom: '0.75rem' }}>
                <span style={badge(c.green, c.greenDim)}>WITH AUGMENTS</span>
              </div>
              <p style={{ ...mono, fontSize: '13px', color: c.textMuted, lineHeight: 1.6 }}>
                Claude gets type signatures, prose docs, and working examples<br />
                Any npm package. Intent-aware formatting.
              </p>
            </div>
          </div>
        </section>

        {/* ── How It Works ─────────────────────────────── */}
        <section style={{ marginBottom: '4rem' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem' }}>
            How it works
          </h2>
          <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {[
              {
                step: '1',
                title: 'You ask Claude about an API',
                desc: '"How do I use useEffect cleanup?" or "zustand persist middleware"',
              },
              {
                step: '2',
                title: 'Claude calls Augments with your query',
                desc: 'Intent detected: howto, reference, or balanced',
              },
              {
                step: '3',
                title: 'Augments resolves the npm package and version',
                desc: 'Any package on npm — auto-discovered, no curated list required',
              },
              {
                step: '4',
                title: 'Returns type signatures, prose docs, and code examples',
                desc: 'Formatted for the detected intent — concise and accurate',
              },
              {
                step: '5',
                title: 'Claude responds with accurate, up-to-date information',
                desc: 'No hallucinated APIs, no outdated signatures',
              },
            ].map(({ step, title, desc }) => (
              <li key={step} style={{
                display: 'flex',
                gap: '1rem',
                marginBottom: '1.25rem',
                alignItems: 'flex-start',
              }}>
                <span style={{
                  ...mono,
                  fontSize: '13px',
                  fontWeight: 700,
                  color: c.accent,
                  minWidth: '1.5rem',
                  paddingTop: '2px',
                }}>
                  {step}.
                </span>
                <div>
                  <p style={{ fontWeight: 500, marginBottom: '0.25rem' }}>{title}</p>
                  <p style={{ ...mono, fontSize: '12px', color: c.textDim }}>{desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* ── Example Output ───────────────────────────── */}
        <section style={{ marginBottom: '4rem' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem' }}>
            Example output
          </h2>
          <p style={{ ...mono, fontSize: '12px', color: c.textDim, marginBottom: '0.75rem' }}>
            Query: &quot;react useEffect cleanup&quot;
          </p>
          <pre style={codeBlock}>
{`## useEffect

\`\`\`ts
function useEffect(
  effect: () => void | (() => void),
  deps?: readonly unknown[]
): void
\`\`\`

Runs side effects after render. Return a cleanup function
to unsubscribe or cancel async work when the component
unmounts or dependencies change.

### Example

\`\`\`tsx
useEffect(() => {
  const id = setInterval(() => tick(), 1000);
  return () => clearInterval(id);   // cleanup
}, [tick]);
\`\`\``}
          </pre>
        </section>

        {/* ── Coverage ─────────────────────────────────── */}
        <section style={{ marginBottom: '4rem' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>
            Coverage
          </h2>
          <p style={{ color: c.textMuted, marginBottom: '1rem', lineHeight: 1.6 }}>
            <strong style={{ color: c.text }}>Every npm package.</strong>{' '}
            Augments auto-discovers documentation for any package published to npm.
            Types are fetched from bundled declarations or DefinitelyTyped.
            Prose and examples are extracted from README files.
          </p>
          <p style={{ color: c.textMuted, marginBottom: '1rem', lineHeight: 1.6 }}>
            <strong style={{ color: c.text }}>24 frameworks get enhanced results</strong>{' '}
            with curated doc sources for richer examples and deeper coverage:
          </p>
          <p style={{
            ...mono,
            fontSize: '12px',
            color: c.textDim,
            lineHeight: 1.8,
          }}>
            React &middot; React DOM &middot; Next.js &middot; Vue &middot; Svelte &middot; Angular &middot; Solid &middot; Express &middot; Fastify &middot; Hono &middot; Prisma &middot; Drizzle &middot; Zod &middot; tRPC &middot; TanStack Query &middot; SWR &middot; Zustand &middot; Jotai &middot; Redux &middot; React Hook Form &middot; Framer Motion &middot; Supabase &middot; Vitest &middot; Playwright
          </p>
        </section>

        {/* ── Quick Start ──────────────────────────────── */}
        <section style={{ marginBottom: '4rem' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem' }}>
            Quick start
          </h2>
          <pre style={codeBlock}>
{`# Option 1: npx (recommended)
claude mcp add augments -- npx augments-mcp-server@latest

# Option 2: Remote server
claude mcp add --transport http augments https://mcp.augments.dev/mcp`}
          </pre>
          <p style={{ ...mono, fontSize: '12px', color: c.textDim, marginTop: '0.75rem' }}>
            Or add to your MCP settings JSON:
          </p>
          <pre style={{ ...codeBlock, marginTop: '0.5rem' }}>
{`{
  "mcpServers": {
    "augments": {
      "command": "npx",
      "args": ["augments-mcp-server@latest"]
    }
  }
}`}
          </pre>
        </section>

        {/* ── Tools ────────────────────────────────────── */}
        <section style={{ marginBottom: '4rem' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem' }}>
            Tools
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {[
              {
                name: 'get_api_context',
                desc: 'Type signatures, prose documentation, and code examples for any npm package',
              },
              {
                name: 'search_apis',
                desc: 'Search for APIs across packages by keyword or concept',
              },
              {
                name: 'get_version_info',
                desc: 'Npm version info with breaking-change detection',
              },
            ].map(({ name, desc }) => (
              <div key={name} style={{
                background: c.surface,
                border: `1px solid ${c.borderSubtle}`,
                borderRadius: '8px',
                padding: '1rem 1.25rem',
              }}>
                <code style={{ ...mono, fontSize: '13px', color: c.accent, fontWeight: 600 }}>
                  {name}
                </code>
                <p style={{ fontSize: '13px', color: c.textMuted, marginTop: '0.35rem' }}>
                  {desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Footer ───────────────────────────────────── */}
        <footer style={{
          borderTop: `1px solid ${c.border}`,
          paddingTop: '1.5rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{ ...mono, fontSize: '12px', color: c.textDim }}>
            augments v5
          </span>
          <div style={{ display: 'flex', gap: '1.5rem' }}>
            <a
              href="https://github.com/augmentscode/augments-mcp-server"
              style={{ ...mono, fontSize: '12px', color: c.textDim, textDecoration: 'none' }}
            >
              GitHub
            </a>
          </div>
        </footer>

      </main>
    </div>
  );
}

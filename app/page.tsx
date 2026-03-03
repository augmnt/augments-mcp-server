import { SERVER_VERSION } from '@/server';

const INSTALL_COMMAND =
  'claude mcp add --transport http augments https://mcp.augments.dev/mcp';

export default function Home() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        textAlign: 'center',
      }}
    >
      {/* Logo */}
      <h1
        style={{
          fontSize: '2rem',
          fontWeight: 500,
          margin: 0,
          marginBottom: '0.5rem',
          letterSpacing: '-0.02em',
        }}
      >
        augments
      </h1>

      {/* Tagline */}
      <p
        style={{
          fontSize: '0.95rem',
          color: '#a1a1aa',
          margin: 0,
          marginBottom: '0.25rem',
        }}
      >
        Types, docs, and examples from npm for Claude Code.
      </p>

      {/* Version */}
      <p
        style={{
          fontSize: '0.75rem',
          color: '#52525b',
          margin: 0,
          marginBottom: '2.5rem',
        }}
      >
        v{SERVER_VERSION}
      </p>

      {/* Install command */}
      <div
        style={{
          backgroundColor: '#18181b',
          border: '1px solid #27272a',
          borderRadius: '0.5rem',
          padding: '1rem 1.5rem',
          maxWidth: '100%',
          overflowX: 'auto',
        }}
      >
        <code
          style={{
            fontSize: '0.85rem',
            color: 'rgba(250, 250, 250, 0.9)',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ color: '#a1a1aa', userSelect: 'none' }}>$ </span>
          {INSTALL_COMMAND}
        </code>
      </div>

      {/* Link to main site */}
      <p
        style={{
          fontSize: '0.85rem',
          color: '#a1a1aa',
          marginTop: '2rem',
        }}
      >
        <a
          href="https://augments.dev"
          style={{
            color: '#a1a1aa',
            textDecoration: 'underline',
            textUnderlineOffset: '3px',
          }}
        >
          augments.dev
        </a>
        {' '}
        &middot;{' '}
        <a
          href="https://github.com/augmnt/augments-mcp-server"
          style={{
            color: '#a1a1aa',
            textDecoration: 'underline',
            textUnderlineOffset: '3px',
          }}
        >
          GitHub
        </a>
      </p>
    </main>
  );
}

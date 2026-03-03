import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Augments — Types, docs, and examples for Claude Code';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'flex-start',
          width: '100%',
          height: '100%',
          background: '#0a0a0a',
          padding: '80px',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            fontSize: '24px',
            fontWeight: 600,
            color: '#3b82f6',
            marginBottom: '32px',
            letterSpacing: '0.04em',
          }}
        >
          augments
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: '52px',
            fontWeight: 600,
            color: '#e5e5e5',
            lineHeight: 1.3,
            marginBottom: '24px',
          }}
        >
          Types, docs, and examples for Claude Code
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: '28px',
            color: '#737373',
            lineHeight: 1.5,
          }}
        >
          Any npm package. Intent-aware.
        </div>
      </div>
    ),
    { ...size }
  );
}

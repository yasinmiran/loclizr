import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Player } from '@remotion/player'
import { AbsoluteFill, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import * as m from '../../loclizr/messages'
import { demoLocales, languageName } from '../language-demo'

const fps = 30
const width = 800
const height = 450

const catalogLine = '"items": "{count, plural, =0 {Your cart is empty} one {# item in your cart} other {# items in your cart}}"'
const buildCommand = 'npx loclizr build'
const buildSummary = '5 messages, 13 locales (source en), 0 errors, 0 warnings'
const callText = 'm.demo_items({ count })'
const signature = 'function demo_items(args: { count: number }, opts?: MessageOptions): string'
const tscError = "app.ts(2,16): error TS2322: Type 'string' is not assignable to type 'number'."

const counts = [0, 1, 2, 5, 22] as const
const framesPerLocale = 26

// Every rendered string comes from the compiled catalog, called with an explicit locale.
const cycle = demoLocales.map((locale, i) => {
  const count = counts[i % counts.length] ?? 0
  return { locale, count, name: languageName(locale), text: m.demo_items({ count }, { locale }) }
})

const scenes = {
  catalog: { from: 0, duration: 80 },
  build: { from: 80, duration: 60 },
  call: { from: 140, duration: 65 },
  output: { from: 205, duration: cycle.length * framesPerLocale + 10 },
  error: { from: 205 + cycle.length * framesPerLocale + 10, duration: 70 },
}
const durationInFrames = scenes.error.from + scenes.error.duration
const stillFrame = scenes.output.from + 4 * framesPerLocale + 6

const mono = 'var(--sl-font-mono)'
const fg = 'var(--foreground)'
const muted = 'var(--muted-foreground)'
const red = 'var(--sl-color-red, #e5484d)'

function typed(text: string, frame: number, start: number, charsPerFrame: number): string {
  return text.slice(0, Math.max(0, Math.floor((frame - start) * charsPerFrame)))
}

function Caret({ visible = true }: { visible?: boolean }): ReactNode {
  const frame = useCurrentFrame()
  const on = visible && Math.floor(frame / 15) % 2 === 0
  return <span style={{ font: 'inherit', display: 'inline-block', width: '0.55em', height: '1.05em', verticalAlign: 'text-bottom', background: on ? fg : 'transparent' }} />
}

function Scene({ label, children }: { label: string; children: ReactNode }): ReactNode {
  const frame = useCurrentFrame()
  const { fps: rate, durationInFrames: length } = useVideoConfig()
  const enter = spring({ frame, fps: rate, config: { damping: 200 }, durationInFrames: 14 })
  const exit = interpolate(frame, [length - 8, length], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return (
    <AbsoluteFill style={{ padding: '0 44px', justifyContent: 'center', opacity: Math.min(enter, exit), transform: `translateY(${(1 - enter) * 12}px)` }}>
      <div style={{ position: 'absolute', top: 32, left: 44, fontFamily: mono, fontSize: 26, color: muted }}>{label}</div>
      <div>{children}</div>
    </AbsoluteFill>
  )
}

const code: CSSProperties = { fontFamily: mono, fontSize: 26, lineHeight: 1.5, color: fg, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }

function Catalog(): ReactNode {
  const frame = useCurrentFrame()
  const shown = typed(catalogLine, frame, 6, 1.8)
  return (
    <Scene label="locales/en.json">
      <div style={code}>
        <div style={{ color: muted }}>{'{ "demo": {'}</div>
        <div style={{ paddingLeft: '1.2em' }}>
          {shown}
          <Caret />
        </div>
        <div style={{ color: muted }}>{'} }'}</div>
      </div>
    </Scene>
  )
}

function Build(): ReactNode {
  const frame = useCurrentFrame()
  const shown = typed(buildCommand, frame, 6, 0.9)
  const done = frame > 6 + buildCommand.length / 0.9 + 8
  return (
    <Scene label="terminal">
      <div style={code}>
        <div>
          <span style={{ font: 'inherit', color: muted }}>$ </span>
          {shown}
          {!done && <Caret />}
        </div>
        {done && <div style={{ color: muted, marginTop: 8 }}>{buildSummary}</div>}
      </div>
    </Scene>
  )
}

function Call(): ReactNode {
  const frame = useCurrentFrame()
  const { fps: rate } = useVideoConfig()
  const shown = typed(callText, frame, 6, 0.9)
  const tipAt = 6 + callText.length / 0.9 + 4
  const tip = spring({ frame: frame - tipAt, fps: rate, config: { damping: 200 }, durationInFrames: 10 })
  return (
    <Scene label="app.ts">
      <div style={code}>
        {shown}
        <Caret />
      </div>
      <div
        style={{
          ...code,
          fontSize: 22,
          marginTop: 14,
          padding: '12px 16px',
          border: '1px solid var(--border)',
          borderRadius: 6,
          background: 'var(--accent)',
          opacity: tip,
          transform: `translateY(${(1 - tip) * -6}px)`,
          maxWidth: 'fit-content',
        }}
      >
        {signature}
      </div>
    </Scene>
  )
}

function Output(): ReactNode {
  const frame = useCurrentFrame()
  const index = Math.min(cycle.length - 1, Math.floor(frame / framesPerLocale))
  const entry = cycle[index] ?? cycle[0]!
  const local = frame - index * framesPerLocale
  const swap = interpolate(local, [0, 3], [0.2, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return (
    <Scene label="output">
      <div style={{ ...code, fontSize: 24, color: muted }}>
        m.demo_items({'{'} count: <span style={{ font: 'inherit', color: fg }}>{entry.count}</span> {'}'}, {'{'} locale: <span style={{ font: 'inherit', color: fg }}>'{entry.locale}'</span> {'}'})
      </div>
      <div
        lang={entry.locale}
        dir={entry.locale === 'ar' ? 'rtl' : 'ltr'}
        style={{
          marginTop: 36,
          fontFamily: 'var(--sl-font)',
          fontSize: 54,
          lineHeight: 1.2,
          fontWeight: 600,
          letterSpacing: '-0.01em',
          color: fg,
          opacity: swap,
          transform: `translateY(${(1 - swap) * 6}px)`,
          textAlign: 'start',
        }}
      >
        {entry.text}
      </div>
      <div style={{ marginTop: 18, fontFamily: 'var(--sl-font)', fontSize: 24, color: muted }}>{entry.name}</div>
      <div style={{ position: 'absolute', left: 44, right: 44, bottom: 36, display: 'flex', gap: 6 }}>
        {cycle.map((c, i) => (
          <div key={c.locale} style={{ flex: 1, height: 3, borderRadius: 2, background: i === index ? fg : 'var(--border)' }} />
        ))}
      </div>
    </Scene>
  )
}

function TypeErrorScene(): ReactNode {
  const frame = useCurrentFrame()
  const errorAt = 14
  const show = interpolate(frame, [errorAt, errorAt + 6], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return (
    <Scene label="app.ts">
      <div style={code}>
        m.demo_items({'{ '}
        <span style={{ font: 'inherit', textDecorationLine: 'underline', textDecorationStyle: 'wavy', textDecorationColor: show > 0 ? red : 'transparent', textUnderlineOffset: 6, textDecorationThickness: 2 }}>count</span>
        : '3' {'})'}
      </div>
      <div style={{ ...code, fontSize: 22, marginTop: 22, color: red, opacity: show }}>
        $ tsc --noEmit
        <br />
        {tscError}
      </div>
    </Scene>
  )
}

function Reel(): ReactNode {
  return (
    <AbsoluteFill style={{ color: fg }}>
      <Sequence from={scenes.catalog.from} durationInFrames={scenes.catalog.duration}><Catalog /></Sequence>
      <Sequence from={scenes.build.from} durationInFrames={scenes.build.duration}><Build /></Sequence>
      <Sequence from={scenes.call.from} durationInFrames={scenes.call.duration}><Call /></Sequence>
      <Sequence from={scenes.output.from} durationInFrames={scenes.output.duration}><Output /></Sequence>
      <Sequence from={scenes.error.from} durationInFrames={scenes.error.duration}><TypeErrorScene /></Sequence>
    </AbsoluteFill>
  )
}

const frameStyle: CSSProperties = { width: '100%', aspectRatio: `${width} / ${height}` }

export default function HeroReel(): ReactNode {
  const [reduced, setReduced] = useState<boolean | null>(null)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(query.matches)
    const onChange = (): void => setReduced(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  if (reduced === null) return <div style={frameStyle} />
  return (
    <Player
      key={reduced ? 'still' : 'play'}
      component={Reel}
      durationInFrames={durationInFrames}
      fps={fps}
      compositionWidth={width}
      compositionHeight={height}
      style={frameStyle}
      autoPlay={!reduced}
      loop={!reduced}
      initialFrame={reduced ? stillFrame : 0}
      initiallyMuted
      controls={false}
      clickToPlay={false}
      doubleClickToFullscreen={false}
      spaceKeyToPlayOrPause={false}
      acknowledgeRemotionLicense
    />
  )
}

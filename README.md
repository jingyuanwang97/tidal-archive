# TIDAL ARCHIVE — The Ocean Remembers

An original, scroll-driven 2D art piece about the sea as an archive of memory.
React + Vite + TypeScript, GSAP ScrollTrigger, Canvas 2D. No 3D, no image assets.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production bundle in dist/
```

## The motif — the Amphidrome

An amphidromic point is where the tide stands still while the tidal wave rotates
around it. Its co-range contours (with heavier "index" contours, as on a map), a
60-tick tide-clock bezel and a vermilion tide hand form the whole visual identity.
All three chapters draw **the same 30 lines**; transitions are literal geometric
transformations, never cross-fades:

| Stage | What the lines do |
| --- | --- |
| 01 Descent | Closed, eccentric contours around the still point. The tide hand turns; the contour bulge follows it. |
| 01 → 02 | A wavy water line rises up the screen; below it everything flips to the deep palette. The contours *unbend* — constant arc length, falling curvature — into a stack of strata. |
| 02 Memory | The strata stretch into full-width tide records. They part around the text, separate into bundles and regroup; a read head crosses the archive and the records it passes oscillate. |
| 02 → 03 | Records condense back into strata and curl (inner first) around a new still point. |
| 03 Awakening | The full vortex: outward pulses, two rotating crests (semi-diurnal) as spiral arms, scaled echo layers, cotidal hour lines. It then slows and contracts into a final emblem with its bezel. |

## Design system

- **Colour**: tokens in `src/styles/tokens.css`, read by the canvas at start-up. Fog-paper surface with
  deep-sea ink above the water line; an abyssal ground with bone ink below it, which warms in chapter 03.
  One accent (recorder vermilion) is reserved for the still point, the tide hand, the record being read and the crests.
  Final values were adjusted after rendering in the browser.
- **Type**: Bodoni Moda (variable, optical size) for display and text — its hairlines echo the contour hairlines;
  Fragment Mono for archive labels and the interface. One rule across every title: articles (*the*, *an*, *The*) are set as raised lowercase italics.
- **Layout**: a 12-column grid inside a fluid page margin between two fixed interface bars. Contour lines
  break around display type (a cartographic knockout) and records part around the chapter-02 text island.
- **Motion**: primary = the motif's scroll-driven transformations (eased per line, staggered);
  secondary = type surfacing from masks and lifting away; ambient = tide hand, breathing echoes.

## Interaction

- **Liquid cursor** (`src/engine/LiquidCursor.ts`): a tapered ink ribbon. Each sample inherits part of the pointer's
  velocity and keeps drifting under drag, so sharp turns bend instead of snapping. Samples cohere toward newer ones,
  so the tail retracts and fades out when the pointer rests. It is drawn as a translucent body with a hairline contour and a vermilion spine,
  and switches ink at the water line.
- **Artwork response**: lines within ~170 px part around the cursor and are dragged by its velocity. Fast passes
  near the drawing release a few expanding ripples (max 6). The whole drawing tilts and shifts by up to 0.8° / 16 px
  with damping and per-line parallax, and returns to rest when the pointer idles. Text and interface never move with the mouse.
- Scroll owns the narrative values (`src/engine/story.ts`); the mouse only adds a local displacement inside the
  engine, so the two systems never write the same property.

## Sound

Everything is synthesized live with Web Audio (`src/audio/`); there are no audio files.

- **Threshold**: "Descend with sound" / "Descend in silence". The choice is the user gesture that lets the
  browser start audio; either way the AudioContext is created, so hold-to-listen works later even in silence.
  The page stays at the surface (scroll locked) until then. The header's **Sound** toggle switches the sound on or off at any time,
  and its glyph is a live trace of the output.
- **Ambient, following the story**: at the surface, sea noise in two overlapping wave cycles. As the water line rises
  it is muffled, and a low fifth drone on A and the pressure of the water come in. In chapter 03, harmonics of the drone
  swell one by one as the tidal crests rotate, then settle back to the open fifth.
- **Read head**: scrolling through chapter 02 scrubs the records like tape (pitched by speed). When the head crosses
  an annotated record, that record plays: storm surge, a 31 Hz hull passing, the 52 Hz whale, calving ice.
- **Click & hold to listen** (touch & hold on phones, or hold **L**): a short press arms, then the record under the
  pointer plays. **Every one of the 30 records has its own voice** (rain, swell, reef, sea ice, anchor chain, a school turning…).
  The held line draws the voice's real waveform (from an `AnalyserNode`). Its neighbours part, and a caption gives
  its number, note and the memory it keeps. In chapters 01 and 03, holding listens to the still point instead,
  and the contours ring with outward pressure bands.

### Narrator

A male narrator: Kokoro TTS v1.0 (Apache-2.0), voice `am_michael` with British pronunciation, slightly lowered in pitch.
It speaks once at each threshold of the descent, with subtitles, and reads a held record's memory over its sound.
All lines live in `src/audio/narration.json` (the subtitles read from the same file). The generated MP3s are in
`public/voice/` (23 lines, ~0.6 MB). To change the voice or the words, edit the JSON and regenerate:

```bash
# once: a Python venv with  pip install kokoro-onnx soundfile  and, in the working folder,
# kokoro-v1.0.fp16.onnx + voices-v1.0.bin from github.com/thewh1teagle/kokoro-onnx/releases (model-files-v1.0)
python tools/narrate.py src/audio/narration.json public/voice
```

### Stereo

Records sound where they are drawn. The read head travels left to right, a held record follows the pointer,
the surface sea and the drone are wide, and the chapter-03 harmonics circle the listener as the crests turn.

## The true tide clock

The tide hand is set by the Moon (`src/engine/tideClock.ts`). M2, the principal lunar tide, has a phase of twice the Moon's
hour angle at the (fictional) station, computed from the standard low-precision lunar formulas, so it is
accurate to about a degree. The intro sweeps the hand from 00 to the real phase. "NEXT HW" is the next high water
in the visitor's local time. The chapter-03 climax spins the crests ahead, and settling returns them to the truth.

## Leaving an echo · the whale's answer

- **Leave an echo** (end of chapter 03): draw one slow line. **No microphone** is used: the gesture's sideways profile
  becomes a 64-sample waveform, and its harmonics become the timbre of its own voice. The echo is kept in this browser
  (`localStorage`). It becomes **TR—31**, the newest, outermost stratum, in every chapter. On the next visit the narrator
  notices, and in chapter 02 it can be held and heard. "Forget my echo" removes it.
- **The whale's answer**: hold the still point in chapter 03 for five seconds. For the first time, a second, lower whale
  answers the 52 Hz song from the other side, and the two rings light up in call and response.

## Touch

Phones get their own effects: a tap drops ink on the water (a bead and three spreading hairline rings, and the
contours ripple), and a swipe leaves the same liquid ink ribbon as the desktop cursor while the page keeps its native
scrolling (passive touch listeners). Touch & hold listens to a record.

## Deploying (free)

The build uses relative paths (`base: './'`), so `dist/` runs from any static host or sub-path.

- **GitHub Pages**: `.github/workflows/deploy.yml` builds and publishes on every push to `main`. Free for public repositories.
- **Netlify / Cloudflare Pages**: drag the `dist/` folder onto their dashboard (free tier), or run
  `npx netlify-cli deploy --prod --dir dist` after logging in.

## Engineering notes

- One loop (`gsap.ticker`) drives both canvases and the interface readouts. Per-frame DOM writes are direct
  (depth counter, tape, interface ink); React re-renders only when the active chapter changes.
- Stage frame cost measured at ~1.4–2.1 ms (headless Chrome, 1440×900, CPU canvas).
- `prefers-reduced-motion`: instant intro, ambient motion slowed to ~10 %, no cursor trail or ripples, un-smoothed scroll.
- Touch / narrow screens: re-composed layouts, 22 lines instead of 30, no cursor effects, full-width text island.
- In dev builds `window.__tidal` exposes the story state and engine for visual QA.

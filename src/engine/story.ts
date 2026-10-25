/**
 * Narrative state. The scroll timeline (GSAP, scrubbed) and the intro
 * timeline write these values; the canvas engine only reads them.
 * Every value is a plain 0..1 progress so the engine owns all easing per line.
 */
export const story = {
  /** Load reveal of the amphidrome (time based). */
  intro: 0,
  /** Load reveal of the annotations around it. */
  introMarks: 0,
  /** Ch1 → Ch2: the rising water line. */
  water: 0,
  /** Ch1 → Ch2: contours unbend into strata. */
  unroll: 0,
  /** Ch1 → Ch2: strata stretch into full-width records. */
  spread: 0,
  /** Ch2: how strongly records part around the text island. */
  island: 0,
  /** Ch2: records separate into bundles and regroup. */
  disperse: 0,
  /** Ch2: the read head travelling across the archive. */
  read: 0,
  /** Ch2 → Ch3: records condense back into strata. */
  gather: 0,
  /** Ch2 → Ch3: strata curl into the full vortex. */
  curl: 0,
  /** Ch3: climax intensity. */
  bloom: 0,
  /** Ch3: contraction into the final emblem, motion slows. */
  settle: 0,
  /** Ch3: colour temperature of the deep. */
  warm: 0,
  /** Smoothed timeline position, in timeline units (0..TIMELINE.total). */
  time: 0,
}

export const TIMELINE = {
  total: 10,
  /** Where each chapter is "fully arrived" on the timeline. */
  chapters: [0, 3.25, 7.45] as const,
  /** Boundaries used for the active chapter indicator. */
  bounds: [2.35, 6.3] as const,
}

export function chapterAt(time: number) {
  return time < TIMELINE.bounds[0] ? 0 : time < TIMELINE.bounds[1] ? 1 : 2
}

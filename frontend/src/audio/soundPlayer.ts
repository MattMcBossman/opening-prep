import type { MoveSound } from '../types'

/**
 * Overall output level for every cue, so individual recipes below can use gains
 * relative to each other (a capture *should* be louder than a quiet move) without
 * any of them being loud in absolute terms. Raised from an earlier, too-quiet 0.35
 * after the move/capture cues turned out to be barely audible in practice - see
 * playMove/playCapture below for the per-cue fix.
 */
const MASTER_VOLUME = 0.5

/**
 * Exponential gain ramps can't reach exactly zero, so envelopes decay to this instead.
 * Low enough to be inaudible.
 */
const SILENCE = 0.0001

/** Fade-in applied to every voice; long enough to avoid a click, short enough to stay percussive. */
const ATTACK_SECONDS = 0.005

type ToneOptions = {
  startTime: number
  duration: number
  type: OscillatorType
  fromFrequency: number
  /** Swept to over `duration`; defaults to a steady pitch. */
  toFrequency?: number
  peakGain: number
  /**
   * Rounds off the oscillator's upper harmonics for a warmer, more "wooden"
   * body tone instead of a bright synth one. Omit for cues that should stay
   * bright/ringing (checkmate and the drill-complete chime).
   */
  lowpassFrequency?: number
}

type NoiseOptions = {
  startTime: number
  duration: number
  peakGain: number
  filterFrequency: number
}

function createAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  try {
    return new Ctor()
  } catch {
    // Audio is a nicety - never let it break move handling.
    return null
  }
}

/**
 * Synthesizes the move/capture/check/checkmate cues with the Web Audio API instead of
 * playing back audio files.
 *
 * Nothing is downloaded, bundled, or licensed, there's no first-play latency waiting
 * on a fetch, and each cue is defined by a handful of readable numbers that can be
 * tuned in place. The tradeoff is that these are synthetic tones rather than sampled
 * piece-on-wood recordings; if we ever want the latter, only this module changes.
 *
 * The AudioContext is created lazily on the first cue rather than up front, because
 * browsers start a context in a `suspended` state unless it's created during a user
 * gesture. Every cue here follows a click or drag, so by construction the first one is
 * inside a gesture; `resume()` covers contexts suspended later (e.g. a backgrounded tab).
 */
export class SoundPlayer {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuffer: AudioBuffer | null = null
  private unavailable = false

  private ensureContext(): AudioContext | null {
    if (this.unavailable) return null
    if (!this.context) {
      const context = createAudioContext()
      if (!context) {
        this.unavailable = true
        return null
      }
      const master = context.createGain()
      master.gain.value = MASTER_VOLUME
      // A soft limiter, not a creative effect: keeps brief overlaps (e.g. a fast
      // double move, or a move's cue firing while the previous one's tail is
      // still decaying) from summing past 0dB into harsh digital clipping - which
      // reads to the ear as a quieter/thinner hit than a normal, unclipped one.
      // A single voice played on its own stays well under the threshold and is
      // untouched.
      const limiter = context.createDynamicsCompressor()
      limiter.threshold.value = -12
      limiter.knee.value = 6
      limiter.ratio.value = 8
      limiter.attack.value = 0.003
      limiter.release.value = 0.15
      master.connect(limiter)
      limiter.connect(context.destination)
      this.context = context
      this.master = master
    }
    return this.context
  }

  /**
   * Warms up the shared context from a genuine user gesture, without playing
   * anything - see `installAudioUnlock` below for why this needs to exist.
   */
  primeFromGesture() {
    const context = this.ensureContext()
    if (context && context.state === 'suspended') {
      context.resume().catch(() => {
        // Nothing useful to do here - a future gesture will retry.
      })
    }
  }

  /** White noise, generated once per context and shared by every percussive cue. */
  private ensureNoiseBuffer(context: AudioContext): AudioBuffer {
    if (!this.noiseBuffer) {
      const frameCount = Math.floor(context.sampleRate * 0.3)
      const buffer = context.createBuffer(1, frameCount, context.sampleRate)
      const channel = buffer.getChannelData(0)
      for (let i = 0; i < frameCount; i += 1) {
        channel[i] = Math.random() * 2 - 1
      }
      this.noiseBuffer = buffer
    }
    return this.noiseBuffer
  }

  /** Percussive envelope shared by tones and noise: quick attack, exponential decay. */
  private envelope(startTime: number, duration: number, peakGain: number): GainNode {
    const context = this.context as AudioContext
    const gain = context.createGain()
    gain.gain.setValueAtTime(SILENCE, startTime)
    gain.gain.linearRampToValueAtTime(peakGain, startTime + ATTACK_SECONDS)
    gain.gain.exponentialRampToValueAtTime(SILENCE, startTime + duration)
    gain.connect(this.master as GainNode)
    return gain
  }

  private tone({ startTime, duration, type, fromFrequency, toFrequency, peakGain, lowpassFrequency }: ToneOptions) {
    const context = this.context as AudioContext
    const oscillator = context.createOscillator()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(fromFrequency, startTime)
    if (toFrequency !== undefined && toFrequency !== fromFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(toFrequency, startTime + duration)
    }
    const envelope = this.envelope(startTime, duration, peakGain)
    if (lowpassFrequency !== undefined) {
      const filter = context.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = lowpassFrequency
      oscillator.connect(filter)
      filter.connect(envelope)
    } else {
      oscillator.connect(envelope)
    }
    oscillator.start(startTime)
    oscillator.stop(startTime + duration)
  }

  private noise({ startTime, duration, peakGain, filterFrequency }: NoiseOptions) {
    const context = this.context as AudioContext
    const source = context.createBufferSource()
    source.buffer = this.ensureNoiseBuffer(context)
    const filter = context.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = filterFrequency
    source.connect(filter)
    filter.connect(this.envelope(startTime, duration, peakGain))
    source.start(startTime)
    source.stop(startTime + duration)
  }

  /**
   * Short, wooden "tap": a brief filtered-noise click with almost no tail, plus a
   * quiet body tone at a near-fixed pitch (a small downward nudge rather than a
   * long audible glide) rounded off by a lowpass. This reads as a single
   * percussive hit - closer to how other chess apps' move sound lands - rather
   * than the longer, more synth-like downward sweep this used to be.
   */
  private playMove(t0: number) {
    this.noise({ startTime: t0, duration: 0.02, peakGain: 0.55, filterFrequency: 2200 })
    this.tone({
      startTime: t0,
      duration: 0.045,
      type: 'triangle',
      fromFrequency: 260,
      toFrequency: 220,
      peakGain: 0.65,
      lowpassFrequency: 1100,
    })
  }

  /**
   * Same shape as a move but heavier and lower: a broader, slightly longer noise
   * thud and a deeper body tone, so a capture reads as a bigger impact without
   * the old sweep's synth-y length.
   */
  private playCapture(t0: number) {
    this.noise({ startTime: t0, duration: 0.035, peakGain: 0.85, filterFrequency: 650 })
    this.tone({
      startTime: t0,
      duration: 0.07,
      type: 'triangle',
      fromFrequency: 150,
      toFrequency: 100,
      peakGain: 0.8,
      lowpassFrequency: 800,
    })
  }

  /**
   * A short, mellow "knock-chime": a low sine fundamental with a very quiet
   * fifth above it, both gently low-pass filtered. It stays distinct from the
   * wooden move/capture taps without the long, high overtone that made check
   * feel overly bright and attention-grabbing.
   */
  private playCheck(t0: number) {
    this.tone({
      startTime: t0,
      duration: 0.14,
      type: 'sine',
      fromFrequency: 440,
      peakGain: 0.42,
      lowpassFrequency: 900,
    })
    this.tone({
      startTime: t0,
      duration: 0.1,
      type: 'sine',
      fromFrequency: 660,
      peakGain: 0.09,
      lowpassFrequency: 800,
    })
  }

  /**
   * Descending minor arpeggio with a held final note - the only cue that's clearly a
   * phrase rather than a single hit, so the end of the game is unmistakable.
   */
  private playCheckmate(t0: number) {
    const notes = [659.25, 523.25, 440, 329.63]
    notes.forEach((frequency, i) => {
      const isLast = i === notes.length - 1
      this.tone({
        startTime: t0 + i * 0.12,
        duration: isLast ? 0.55 : 0.18,
        type: 'triangle',
        fromFrequency: frequency,
        peakGain: isLast ? 0.55 : 0.4,
      })
    })
  }

  /**
   * Bright ascending major triad (C5-E5-G5) - a distinct "success" chime for
   * finishing a whole drill line, deliberately the mirror image of
   * checkmate's descending minor phrase so the two are never confused.
   */
  private playDrillCompleteChime(t0: number) {
    const notes = [523.25, 659.25, 783.99]
    notes.forEach((frequency, i) => {
      const isLast = i === notes.length - 1
      this.tone({
        startTime: t0 + i * 0.09,
        duration: isLast ? 0.4 : 0.14,
        type: 'triangle',
        fromFrequency: frequency,
        peakGain: isLast ? 0.65 : 0.45,
      })
    })
  }

  /**
   * Nudges a start time just past "now" so scheduling never lands in the past
   * (which can clip the attack), then hands off to `effect` to schedule voices.
   *
   * If the context is `suspended` (e.g. a backgrounded tab, or simply not yet
   * resumed since creation), waits for `resume()` to actually complete before
   * scheduling anything - `currentTime` doesn't advance while suspended, so
   * scheduling immediately against it (as this used to do, firing `resume()`
   * without waiting) could schedule a cue against a clock that wasn't running
   * yet. This mattered most for cues triggered from a timer rather than
   * directly inside a click/drag handler (the auto-played opponent reply and
   * the drill-complete chime), which is likely why those in particular seemed
   * to play inconsistently.
   */
  private withContext(effect: (t0: number) => void) {
    const context = this.ensureContext()
    if (!context) return
    const schedule = () => effect(context.currentTime + 0.01)
    if (context.state === 'suspended') {
      context.resume().then(schedule).catch(() => {
        // Some browsers refuse to resume a context outside a user gesture. Nothing
        // useful to do here - the next genuinely gesture-triggered cue will retry.
      })
      return
    }
    schedule()
  }

  play(sound: MoveSound) {
    this.withContext((t0) => {
      switch (sound) {
        case 'checkmate':
          this.playCheckmate(t0)
          break
        case 'check':
          this.playCheck(t0)
          break
        case 'capture':
          this.playCapture(t0)
          break
        case 'move':
          this.playMove(t0)
          break
      }
    })
  }

  /** See playDrillCompleteChime - a distinct cue for finishing a drill line, not tied to any move's SAN. */
  playDrillComplete() {
    this.withContext((t0) => this.playDrillCompleteChime(t0))
  }
}

let sharedPlayer: SoundPlayer | null = null

/**
 * Process-wide player, so a single AudioContext is shared by everything that makes
 * noise. Browsers cap how many contexts a page may open, and there's no reason for
 * more than one.
 */
export function getSoundPlayer(): SoundPlayer {
  if (!sharedPlayer) sharedPlayer = new SoundPlayer()
  return sharedPlayer
}

let unlockInstalled = false

/**
 * Installs a one-time listener that primes the shared AudioContext (creates and
 * resumes it) on the page's very first pointer/keyboard interaction, whatever it
 * is - not necessarily a move.
 *
 * Why this exists: not every cue is played from directly inside a gesture
 * handler. Drills auto-play the opponent's reply from a timer (see
 * `AUTO_PLAY_DELAY_MS` in `useDrillSession`), and when drilling Black that timer
 * can fire before the user has made any move of their own at all - the very
 * first cue of the session. Browsers only let a *suspended* AudioContext be
 * resumed from within a real gesture, so without priming it on some earlier,
 * unrelated interaction first (e.g. clicking the mode toggle to get to Drills),
 * that first auto-played cue could silently never play, however long `withContext`
 * is willing to wait for `resume()`.
 *
 * Safe to call more than once (e.g. React StrictMode's double-invoked effects) -
 * only the first call installs anything, and the listeners remove themselves
 * after firing once.
 */
export function installAudioUnlock() {
  if (unlockInstalled || typeof window === 'undefined') return
  unlockInstalled = true
  const prime = () => getSoundPlayer().primeFromGesture()
  window.addEventListener('pointerdown', prime, { once: true, passive: true })
  window.addEventListener('keydown', prime, { once: true })
  window.addEventListener('touchstart', prime, { once: true, passive: true })
}

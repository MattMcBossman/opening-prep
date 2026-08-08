import type { MoveSound } from '../types'

/**
 * Overall output level for every cue, so individual recipes below can use gains
 * relative to each other (a capture *should* be louder than a quiet move) without
 * any of them being loud in absolute terms.
 */
const MASTER_VOLUME = 0.35

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
      master.connect(context.destination)
      this.context = context
      this.master = master
    }
    if (this.context.state === 'suspended') {
      void this.context.resume()
    }
    return this.context
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

  private tone({ startTime, duration, type, fromFrequency, toFrequency, peakGain }: ToneOptions) {
    const context = this.context as AudioContext
    const oscillator = context.createOscillator()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(fromFrequency, startTime)
    if (toFrequency !== undefined && toFrequency !== fromFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(toFrequency, startTime + duration)
    }
    oscillator.connect(this.envelope(startTime, duration, peakGain))
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

  /** Wooden "thock": a bright click transient over a fast downward pitch drop. */
  private playMove(t0: number) {
    this.noise({ startTime: t0, duration: 0.02, peakGain: 0.35, filterFrequency: 2200 })
    this.tone({
      startTime: t0,
      duration: 0.1,
      type: 'triangle',
      fromFrequency: 320,
      toFrequency: 150,
      peakGain: 0.9,
    })
  }

  /** Same gesture as a move but heavier and grittier - a longer, lower crunch over a deeper thud. */
  private playCapture(t0: number) {
    this.noise({ startTime: t0, duration: 0.14, peakGain: 0.6, filterFrequency: 900 })
    this.tone({
      startTime: t0,
      duration: 0.18,
      type: 'sawtooth',
      fromFrequency: 220,
      toFrequency: 80,
      peakGain: 0.7,
    })
  }

  /**
   * Rising two-tone alert, pitched well above the move/capture thuds so it reads as a
   * warning about the position rather than more board percussion.
   */
  private playCheck(t0: number) {
    this.tone({ startTime: t0, duration: 0.1, type: 'sine', fromFrequency: 988, peakGain: 0.5 })
    this.tone({ startTime: t0 + 0.09, duration: 0.18, type: 'sine', fromFrequency: 1319, peakGain: 0.5 })
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

  play(sound: MoveSound) {
    const context = this.ensureContext()
    if (!context) return
    // Nudge every voice just past "now" so scheduled start times are never already in
    // the past by the time the graph is wired up, which can clip the attack.
    const t0 = context.currentTime + 0.01
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

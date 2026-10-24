export class GameAudio {
  constructor() {
    this.context = null
    this.master = null
    this.muted = false
    this.noiseBuffer = null
    this.ambientSource = null
    this.ambientGain = null
  }

  init() {
    if (this.context) {
      if (this.context.state === 'suspended') this.context.resume().catch(() => {})
      return
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext
    if (!AudioContext) return
    try {
      this.context = new AudioContext()
      this.master = this.context.createGain()
      this.master.gain.value = this.muted ? 0 : 0.5
      this.master.connect(this.context.destination)
      this.noiseBuffer = this.createNoise(1.5)
      this.startAmbient()
    } catch {
      this.context = null
    }
  }

  createNoise(seconds) {
    const rate = this.context.sampleRate
    const buffer = this.context.createBuffer(1, Math.floor(rate * seconds), rate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    return buffer
  }

  startAmbient() {
    if (!this.context || this.ambientSource) return
    const source = this.context.createBufferSource()
    source.buffer = this.noiseBuffer
    source.loop = true
    const filter = this.context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 420
    const gain = this.context.createGain()
    gain.gain.value = 0.022
    source.connect(filter).connect(gain).connect(this.master)
    source.start()
    this.ambientSource = source
    this.ambientGain = gain
  }

  setMuted(muted) {
    this.muted = muted
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.context.currentTime, 0.05)
    }
  }

  toggleMute() {
    this.setMuted(!this.muted)
    return this.muted
  }

  noiseBurst({ duration = 0.18, frequency = 900, q = 0.8, volume = 0.3, type = 'lowpass', sweep = 0 }) {
    if (!this.context || this.muted) return
    const now = this.context.currentTime
    const source = this.context.createBufferSource()
    source.buffer = this.noiseBuffer
    const filter = this.context.createBiquadFilter()
    filter.type = type
    filter.frequency.setValueAtTime(frequency, now)
    if (sweep) filter.frequency.exponentialRampToValueAtTime(Math.max(60, frequency + sweep), now + duration)
    filter.Q.value = q
    const gain = this.context.createGain()
    gain.gain.setValueAtTime(volume, now)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
    source.connect(filter).connect(gain).connect(this.master)
    source.start(now)
    source.stop(now + duration + 0.02)
  }

  tone({ frequency = 440, endFrequency = 0, duration = 0.12, type = 'sine', volume = 0.16, delay = 0 }) {
    if (!this.context || this.muted) return
    const now = this.context.currentTime + delay
    const oscillator = this.context.createOscillator()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(frequency, now)
    if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), now + duration)
    const gain = this.context.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
    oscillator.connect(gain).connect(this.master)
    oscillator.start(now)
    oscillator.stop(now + duration + 0.03)
  }

  breakBlock(block = 'stone') {
    const soft = /grass|leaves|dirt|sand|snow|gravel/i.test(block)
    this.noiseBurst({
      duration: soft ? 0.16 : 0.22,
      frequency: soft ? 620 : 1200,
      q: soft ? 0.4 : 1.1,
      volume: soft ? 0.2 : 0.28,
      sweep: soft ? -260 : -600
    })
    this.tone({ frequency: soft ? 150 : 220, endFrequency: 70, duration: 0.1, type: 'triangle', volume: 0.08 })
  }

  placeBlock() {
    this.noiseBurst({ duration: 0.1, frequency: 520, q: 0.7, volume: 0.2, sweep: -260 })
    this.tone({ frequency: 190, endFrequency: 130, duration: 0.09, type: 'square', volume: 0.06 })
  }

  step(soft = false) {
    this.noiseBurst({ duration: 0.09, frequency: soft ? 380 : 720, q: 0.9, volume: soft ? 0.1 : 0.16, sweep: -220 })
  }

  jump() {
    this.tone({ frequency: 280, endFrequency: 390, duration: 0.08, type: 'sine', volume: 0.05 })
  }

  land() {
    this.noiseBurst({ duration: 0.12, frequency: 420, q: 0.8, volume: 0.18, sweep: -260 })
  }

  splash() {
    this.noiseBurst({ duration: 0.32, frequency: 1200, q: 0.5, volume: 0.2, type: 'bandpass', sweep: -900 })
  }

  ui() {
    this.tone({ frequency: 660, endFrequency: 880, duration: 0.06, type: 'sine', volume: 0.04 })
  }
}

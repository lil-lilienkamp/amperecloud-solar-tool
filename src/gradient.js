// The app's signature "Tempo-Verlauf" accent gradient, sampled for chart
// series/bars so they visually tie back to the header/hero/slider accents.
export const TEMPO_GRADIENT_CSS =
  'linear-gradient(135deg, #ffc53d 0%, #fb8c3c 33%, #e8467f 66%, #6d3fe0 100%)'

const STOPS = [
  { t: 0, rgb: [255, 197, 61] }, // #ffc53d
  { t: 0.33, rgb: [251, 140, 60] }, // #fb8c3c
  { t: 0.66, rgb: [232, 70, 127] }, // #e8467f
  { t: 1, rgb: [109, 63, 224] }, // #6d3fe0
]

// Interpolates a color along the Tempo gradient for t in [0, 1].
export function tempoGradientColor(t) {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0))
  for (let i = 0; i < STOPS.length - 1; i++) {
    const a = STOPS[i]
    const b = STOPS[i + 1]
    if (clamped >= a.t && clamped <= b.t) {
      const localT = b.t === a.t ? 0 : (clamped - a.t) / (b.t - a.t)
      const rgb = a.rgb.map((channel, idx) => Math.round(channel + (b.rgb[idx] - channel) * localT))
      return `rgb(${rgb.join(', ')})`
    }
  }
  return `rgb(${STOPS.at(-1).rgb.join(', ')})`
}

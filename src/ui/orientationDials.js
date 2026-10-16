// Small SVG dials visualizing panel azimuth (compass) and tilt (side view).
// Markup is static; `updateCompassDial`/`updateTiltDial` just rotate/redraw
// the moving parts, so they're cheap to call on every slider `input`.

export function compassDialMarkup() {
  return `
    <svg viewBox="0 0 100 100" width="88" height="88" role="img" aria-hidden="true">
      <circle cx="50" cy="50" r="46" class="dial-ring"/>
      <circle cx="50" cy="50" r="46" class="dial-ring-accent" id="compass-progress"
        pathLength="100" stroke-dasharray="0 100"/>
      <text x="50" y="21" class="dial-tick" text-anchor="middle">N</text>
      <text x="83" y="53" class="dial-tick" text-anchor="middle">O</text>
      <text x="50" y="85" class="dial-tick" text-anchor="middle">S</text>
      <text x="17" y="53" class="dial-tick" text-anchor="middle">W</text>
      <g id="compass-needle" transform="rotate(180 50 50)">
        <path d="M50 26 L56 50 L50 45 L44 50 Z" class="dial-needle"/>
      </g>
      <circle cx="50" cy="50" r="4" class="dial-hub"/>
    </svg>`
}

// azimuthDeg: 0 = north, 90 = east, 180 = south, 270 = west (matches the
// azimuth slider convention used for surfaceAzimuth throughout the app).
export function updateCompassDial(azimuthDeg) {
  const needle = document.querySelector('#compass-needle')
  const progress = document.querySelector('#compass-progress')
  if (needle) needle.setAttribute('transform', `rotate(${azimuthDeg} 50 50)`)
  if (progress) progress.setAttribute('stroke-dasharray', `${(azimuthDeg / 360) * 100} 100`)
}

export function tiltDialMarkup() {
  return `
    <svg viewBox="0 0 100 70" width="88" height="62" role="img" aria-hidden="true">
      <line x1="6" y1="58" x2="94" y2="58" class="dial-ring"/>
      <g id="tilt-panel" transform="rotate(-35 20 58)">
        <line x1="20" y1="58" x2="80" y2="58" class="dial-needle" stroke-width="4" stroke-linecap="round"/>
      </g>
      <circle cx="20" cy="58" r="3.5" class="dial-hub"/>
    </svg>`
}

export function updateTiltDial(tiltDeg) {
  const panel = document.querySelector('#tilt-panel')
  if (panel) panel.setAttribute('transform', `rotate(${-tiltDeg} 20 58)`)
}

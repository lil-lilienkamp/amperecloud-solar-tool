import './style.css'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

import { stations as fallbackStations } from './stations'
import { getCompleteYears, aggregateMonthlyIrradiation } from './dwdUtils'
import { fetchStationMetadata, fetchStationHourlyRecords } from './dataLoading'
import { computeSunEnrichedRecords, aggregateTiltedMonthlyForYear } from './tiltedSeries'
import { renderIrradianceChart, renderYieldChart } from './charts'
import { renderAppShell } from './ui/template'
import { updateCompassDial, updateTiltDial } from './ui/orientationDials'
import { getThemeMode, setThemeMode, getEffectiveTheme, onThemeChange } from './theme'
import { DEFAULT_LOCATION } from './constants'

// ── Shared mutable state ─────────────────────────────────────────────────────

let dwdStations = []
let marker = null
let latestMonthlySeries = []
let latestTiltedSeries = []
let sunEnrichedRecords = []
let latestStationName = ''
let latestSelectedLocation = { lat: DEFAULT_LOCATION.lat, lon: DEFAULT_LOCATION.lon }
let currentRequestToken = 0
let currentAbortController = null

// ── Layout ────────────────────────────────────────────────────────────────────

document.querySelector('#app').innerHTML = renderAppShell()

// ── DOM refs ──────────────────────────────────────────────────────────────────

const statusLiveEl = document.querySelector('#status-live')
const selectedLocationEl = document.querySelector('#selected-location')
const nearestStationEl = document.querySelector('#nearest-station')
const yearSelectEl = document.querySelector('#year-select')
const yearRangeSelectEl = document.querySelector('#year-range-select')
const azimuthSliderEl = document.querySelector('#azimuth-slider')
const tiltSliderEl = document.querySelector('#tilt-slider')
const azimuthValueEl = document.querySelector('#azimuth-value')
const tiltValueEl = document.querySelector('#tilt-value')
const estimatedYieldEl = document.querySelector('#estimated-yield')
const modulePowerInputEl = document.querySelector('#module-power-input')
const moduleAreaInputEl = document.querySelector('#module-area-input')
const moduleCountInputEl = document.querySelector('#module-count-input')
const performanceRatioInputEl = document.querySelector('#performance-ratio-input')
const moduleEfficiencyEl = document.querySelector('#module-efficiency')
const annualEnergyYieldEl = document.querySelector('#annual-energy-yield')
const electricityPriceInputEl = document.querySelector('#electricity-price-input')
const annualRevenueEl = document.querySelector('#annual-revenue')
const systemKwpEl = document.querySelector('#system-kwp')
const specificYieldEl = document.querySelector('#specific-yield')
const chartLoadingEl = document.querySelector('#chart-loading')
const chartErrorEl = document.querySelector('#chart-error')
const chartErrorTextEl = document.querySelector('#chart-error-text')
const irradianceChartEl = document.querySelector('#irradiance-chart')
const annualKpisEl = document.querySelector('#annual-kpis')
const annualSelectedEl = document.querySelector('#annual-selected')
const annualSelectedFlagEl = document.querySelector('#annual-selected-flag')
const annualAvgEl = document.querySelector('#annual-avg')
const annualBestEl = document.querySelector('#annual-best')
const yieldChartEl = document.querySelector('#yield-chart')
const yieldErrorEl = document.querySelector('#yield-error')
const yieldErrorTextEl = document.querySelector('#yield-error-text')
const yieldLoadingIndicatorEl = document.querySelector('#yield-loading-indicator')

const yieldControlEls = [
  azimuthSliderEl,
  tiltSliderEl,
  modulePowerInputEl,
  moduleAreaInputEl,
  moduleCountInputEl,
  electricityPriceInputEl,
  performanceRatioInputEl,
]

// ── General helpers ───────────────────────────────────────────────────────────

function debounce(fn, delay) {
  let timer
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
}

function announceStatus(message) {
  statusLiveEl.textContent = message
}

function setIrradianceChartState(state, message = '') {
  irradianceChartEl.style.display = state === 'ready' ? '' : 'none'
  chartLoadingEl.classList.toggle('hidden', state !== 'loading')
  chartErrorEl.classList.toggle('hidden', state !== 'error')
  annualKpisEl.classList.toggle('hidden', state !== 'ready')
  if (state === 'error') {
    chartErrorTextEl.textContent = message
    announceStatus(message)
  }
  if (state === 'loading') announceStatus('DWD-Daten werden geladen…')
  if (state === 'ready') announceStatus(`Daten für ${latestStationName} geladen.`)
}

function setYieldLoading(isLoading) {
  yieldLoadingIndicatorEl.classList.toggle('hidden', !isLoading)
  for (const el of yieldControlEls) el.disabled = isLoading
}

function clampNumberInput(el) {
  const value = Number(el.value)
  if (!Number.isFinite(value)) return
  const min = el.min === '' ? -Infinity : Number(el.min)
  const max = el.max === '' ? Infinity : Number(el.max)
  const clamped = Math.min(max, Math.max(min, value))
  if (clamped !== value) el.value = String(clamped)
}

// ── Station lookup ────────────────────────────────────────────────────────────

function getDistanceInKm(lat1, lon1, lat2, lon2) {
  const toRad = (v) => (v * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Prefers stations that are still actively reporting data; falls back to
// the full list only if none of the known stations are currently active.
function findNearestStation(lat, lon, stationList) {
  const activeStations = stationList.filter((s) => s.active)
  const pool = activeStations.length > 0 ? activeStations : stationList

  let nearest = null
  let minDist = Infinity
  for (const s of pool) {
    const d = getDistanceInKm(lat, lon, s.lat, s.lon)
    if (d < minDist) {
      minDist = d
      nearest = { ...s, distanceKm: d }
    }
  }
  return nearest
}

// ── Map ───────────────────────────────────────────────────────────────────────

const map = L.map('map', { scrollWheelZoom: false, zoomControl: false }).setView([51.1657, 10.4515], 6)
// Zoom control sits top-right so it doesn't collide with our location/station chips (top-left).
L.control.zoom({ position: 'topright' }).addTo(map)
setTimeout(() => map.invalidateSize(), 100)

// Only zoom the map on scroll once the user has explicitly interacted with
// it, so scrolling the page past the map doesn't get hijacked.
map.on('focus', () => map.scrollWheelZoom.enable())
map.on('blur', () => map.scrollWheelZoom.disable())

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-Mitwirkende',
  maxZoom: 19,
}).addTo(map)

const tempoMarkerIcon = L.divIcon({
  className: 'tempo-marker',
  html: `<svg width="30" height="40" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="tempoPinGradient" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#ffc53d"/>
        <stop offset="33%" stop-color="#fb8c3c"/>
        <stop offset="66%" stop-color="#e8467f"/>
        <stop offset="100%" stop-color="#6d3fe0"/>
      </linearGradient>
    </defs>
    <path d="M15 39S3 24.9 3 16a12 12 0 1 1 24 0c0 8.9-12 23-12 23Z" fill="url(#tempoPinGradient)" stroke="white" stroke-width="1.5"/>
    <circle cx="15" cy="16" r="5.2" fill="white"/>
  </svg>`,
  iconSize: [30, 40],
  iconAnchor: [15, 38],
  popupAnchor: [0, -34],
})

// ── Data processing ───────────────────────────────────────────────────────────

function getSelectedComparisonYear() {
  return latestMonthlySeries.length > 0
    ? Number(yearSelectEl.value || latestMonthlySeries.at(-1).year)
    : new Date().getFullYear()
}

function recalculateTiltedSeries() {
  if (sunEnrichedRecords.length === 0) {
    latestTiltedSeries = []
    return
  }
  latestTiltedSeries = aggregateTiltedMonthlyForYear(
    sunEnrichedRecords,
    getSelectedComparisonYear(),
    Number(azimuthSliderEl.value),
    Number(tiltSliderEl.value),
  )
}

// ── Chart helpers ─────────────────────────────────────────────────────────────

function getAvailableYears(series) {
  return [...new Set(series.map((e) => e.year))].sort((a, b) => a.localeCompare(b))
}

function populateYearSelect(series) {
  const years = getAvailableYears(series)
  const prev = yearSelectEl.value
  yearSelectEl.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join('')
  // Default to the latest complete year: a year still in progress would make
  // the annual yield look far too low.
  const completeYears = [...getCompleteYears(series)].sort()
  yearSelectEl.value = years.includes(prev) ? prev : (completeYears.at(-1) ?? years.at(-1))
}

function getSelectedYears(series) {
  const years = getAvailableYears(series)
  const end = yearSelectEl.value
  const range = Number(yearRangeSelectEl.value)
  const endIdx = years.indexOf(end)
  if (endIdx === -1 || Number.isNaN(range)) return []
  return years.slice(Math.max(0, endIdx - range + 1), endIdx + 1)
}

function updateAnnualKpis(monthlySeries) {
  const completeYears = getCompleteYears(monthlySeries)
  const annualSums = new Map()
  for (const e of monthlySeries) annualSums.set(e.year, (annualSums.get(e.year) ?? 0) + e.irradiationKwhPerM2)

  const selectedYear = yearSelectEl.value
  const selectedSum = annualSums.get(selectedYear)
  annualSelectedEl.textContent = selectedSum !== undefined ? `${selectedSum.toFixed(0)} kWh/m²` : '–'
  annualSelectedFlagEl.classList.toggle(
    'hidden',
    selectedSum === undefined || completeYears.has(selectedYear),
  )

  const completeEntries = [...annualSums.entries()].filter(([year]) => completeYears.has(year))
  if (completeEntries.length === 0) {
    annualAvgEl.textContent = '–'
    annualBestEl.textContent = '–'
    return
  }

  const values = completeEntries.map(([, v]) => v)
  const avg = values.reduce((a, b) => a + b, 0) / values.length
  const [bestYear, best] = completeEntries.reduce((a, b) => (b[1] > a[1] ? b : a))

  annualAvgEl.textContent = `${avg.toFixed(0)} kWh/m²`
  annualBestEl.textContent = `${best.toFixed(0)} kWh/m² (${bestYear})`
}

function renderIrradianceChartForCurrentSelection() {
  updateAnnualKpis(latestMonthlySeries)
  const years = getSelectedYears(latestMonthlySeries)
  renderIrradianceChart(irradianceChartEl.id, latestMonthlySeries, years, getEffectiveTheme())
}

function renderYieldChartForCurrentState() {
  if (latestTiltedSeries.length === 0) return

  const modulePower = Number(modulePowerInputEl.value)
  const moduleArea = Number(moduleAreaInputEl.value)
  const moduleCount = Number(moduleCountInputEl.value)
  const performanceRatio = Number(performanceRatioInputEl.value)
  if (!(modulePower > 0 && moduleArea > 0 && moduleCount > 0 && performanceRatio > 0)) return

  const efficiency = modulePower / (1000 * moduleArea)
  const totalArea = moduleArea * moduleCount
  const monthlyKwh = latestTiltedSeries.map(
    (e) => e.irradiationKwhPerM2 * totalArea * efficiency * performanceRatio,
  )

  yieldChartEl.classList.remove('yield-chart-empty')
  renderYieldChart(yieldChartEl.id, monthlyKwh, getEffectiveTheme())
}

// ── Yield KPIs ────────────────────────────────────────────────────────────────

function updateYieldKpis() {
  const modulePower = Number(modulePowerInputEl.value)
  const moduleArea = Number(moduleAreaInputEl.value)
  const moduleCount = Number(moduleCountInputEl.value)
  const electricityPrice = Number(electricityPriceInputEl.value)
  const performanceRatio = Number(performanceRatioInputEl.value)

  const valid =
    Number.isFinite(modulePower) &&
    modulePower > 0 &&
    Number.isFinite(moduleArea) &&
    moduleArea > 0 &&
    Number.isFinite(moduleCount) &&
    moduleCount > 0 &&
    Number.isFinite(electricityPrice) &&
    electricityPrice >= 0 &&
    Number.isFinite(performanceRatio) &&
    performanceRatio > 0 &&
    performanceRatio <= 1

  if (!valid) {
    yieldErrorTextEl.textContent =
      'Bitte gültige, positive Werte für Modulleistung, -fläche, -anzahl und Performance Ratio (0–1) eingeben.'
    yieldErrorEl.classList.remove('hidden')
    for (const el of [
      moduleEfficiencyEl,
      estimatedYieldEl,
      annualEnergyYieldEl,
      annualRevenueEl,
      systemKwpEl,
      specificYieldEl,
    ]) {
      el.textContent = '–'
    }
    return
  }
  yieldErrorEl.classList.add('hidden')

  const efficiency = modulePower / (1000 * moduleArea)
  const kwp = (modulePower * moduleCount) / 1000
  moduleEfficiencyEl.textContent = `${(efficiency * 100).toFixed(1)} %`
  systemKwpEl.textContent = `${kwp.toFixed(2)} kWp`

  if (latestTiltedSeries.length === 0) {
    estimatedYieldEl.textContent =
      annualEnergyYieldEl.textContent =
      annualRevenueEl.textContent =
      specificYieldEl.textContent =
        '–'
    return
  }

  const annualIrradiation = latestTiltedSeries.reduce((s, e) => s + e.irradiationKwhPerM2, 0)
  const annualEnergy = annualIrradiation * moduleArea * moduleCount * efficiency * performanceRatio
  const annualRevenue = annualEnergy * electricityPrice
  const specificYield = kwp > 0 ? annualEnergy / kwp : 0

  estimatedYieldEl.textContent = `${annualIrradiation.toFixed(1)} kWh/m²`
  annualEnergyYieldEl.textContent = `${annualEnergy.toFixed(0)} kWh`
  annualRevenueEl.textContent = `${annualRevenue.toFixed(0)} €`
  specificYieldEl.textContent = `${specificYield.toFixed(0)} kWh/kWp`
}

// ── DWD fetch ─────────────────────────────────────────────────────────────────

async function loadStationData(stationId, stationName) {
  currentAbortController?.abort()
  const abortController = new AbortController()
  currentAbortController = abortController
  const token = ++currentRequestToken

  setIrradianceChartState('loading')
  setYieldLoading(true)

  try {
    const normalizedRecords = await fetchStationHourlyRecords(stationId, { signal: abortController.signal })
    if (token !== currentRequestToken) return // a newer request has since started

    latestStationName = stationName
    latestMonthlySeries = aggregateMonthlyIrradiation(normalizedRecords)
    sunEnrichedRecords = computeSunEnrichedRecords(normalizedRecords, latestSelectedLocation)

    setIrradianceChartState('ready')
    populateYearSelect(latestMonthlySeries)
    renderIrradianceChartForCurrentSelection()
    recalculateTiltedSeries()
    renderYieldChartForCurrentState()
    updateYieldKpis()
  } catch (error) {
    if (error?.name === 'AbortError' || token !== currentRequestToken) return
    console.error('DWD-Fetch-Fehler:', error)
    setIrradianceChartState('error', `Daten konnten nicht geladen werden: ${error.message}`)
  } finally {
    if (token === currentRequestToken) setYieldLoading(false)
  }
}

async function updateLocationAndChart(lat, lng, locationLabel = null) {
  const nearestStation = findNearestStation(lat, lng, dwdStations)
  if (!nearestStation?.stationId) {
    setIrradianceChartState('error', 'DWD-Stationsdaten nicht verfügbar – bitte Seite neu laden.')
    return
  }

  latestSelectedLocation = { lat, lon: lng }

  if (marker) {
    marker.setLatLng([lat, lng])
  } else {
    marker = L.marker([lat, lng], { icon: tempoMarkerIcon }).addTo(map)
  }

  const label = locationLabel ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`
  // Not auto-opened: the location/station chips already show this info,
  // and an auto-opened popup collides with those chips on narrow screens.
  marker.bindPopup(`${label}<br>${lat.toFixed(4)}, ${lng.toFixed(4)}`)

  selectedLocationEl.textContent = label
  nearestStationEl.textContent = `${nearestStation.name} (${nearestStation.distanceKm.toFixed(1)} km)`

  await loadStationData(nearestStation.stationId, nearestStation.name)
}

async function loadStationMetadata() {
  try {
    dwdStations = await fetchStationMetadata()
  } catch (error) {
    console.error('DWD-Metadaten-Fehler:', error)
    dwdStations = fallbackStations
    announceStatus('DWD-Stationsliste konnte nicht geladen werden – verwende lokale Ausweichliste.')
  }
}

// ── Theme toggle ──────────────────────────────────────────────────────────────

function setupThemeToggle() {
  const buttons = [...document.querySelectorAll('.theme-toggle-btn')]
  const sync = () => {
    const mode = getThemeMode()
    for (const btn of buttons) btn.setAttribute('aria-pressed', String(btn.dataset.themeMode === mode))
  }
  for (const btn of buttons) {
    btn.addEventListener('click', () => {
      setThemeMode(btn.dataset.themeMode)
      sync()
    })
  }
  sync()
}

setupThemeToggle()

onThemeChange(() => {
  if (latestMonthlySeries.length > 0) renderIrradianceChartForCurrentSelection()
  if (latestTiltedSeries.length > 0) renderYieldChartForCurrentState()
})

// ── Bootstrap + event listeners ───────────────────────────────────────────────

loadStationMetadata().then(() => {
  updateLocationAndChart(DEFAULT_LOCATION.lat, DEFAULT_LOCATION.lon, DEFAULT_LOCATION.name)
})

map.on('click', ({ latlng: { lat, lng } }) => updateLocationAndChart(lat, lng))

yearSelectEl.addEventListener('change', () => {
  if (latestMonthlySeries.length > 0) renderIrradianceChartForCurrentSelection()
  recalculateTiltedSeries()
  renderYieldChartForCurrentState()
  updateYieldKpis()
})

yearRangeSelectEl.addEventListener('change', () => {
  if (latestMonthlySeries.length > 0) renderIrradianceChartForCurrentSelection()
})

const debouncedSliderUpdate = debounce(() => {
  recalculateTiltedSeries()
  renderYieldChartForCurrentState()
  updateYieldKpis()
}, 120)

azimuthSliderEl.addEventListener('input', () => {
  azimuthValueEl.textContent = `${azimuthSliderEl.value}°`
  updateCompassDial(Number(azimuthSliderEl.value))
  debouncedSliderUpdate()
})

tiltSliderEl.addEventListener('input', () => {
  tiltValueEl.textContent = `${tiltSliderEl.value}°`
  updateTiltDial(Number(tiltSliderEl.value))
  debouncedSliderUpdate()
})

for (const el of [
  modulePowerInputEl,
  moduleAreaInputEl,
  moduleCountInputEl,
  electricityPriceInputEl,
  performanceRatioInputEl,
]) {
  el.addEventListener('input', () => {
    renderYieldChartForCurrentState()
    updateYieldKpis()
  })
  el.addEventListener('change', () => {
    clampNumberInput(el)
    renderYieldChartForCurrentState()
    updateYieldKpis()
  })
}

updateCompassDial(Number(azimuthSliderEl.value))
updateTiltDial(Number(tiltSliderEl.value))
updateYieldKpis()

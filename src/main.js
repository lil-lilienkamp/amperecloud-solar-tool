import './style.css'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import Plotly from 'plotly.js-dist-min'
import JSZip from 'jszip'
import { stations } from './stations'
import {
  getDayOfYear,
  getNumberOfDaysInYear,
  getSunPosition,
  getTiltedGlobalIrradiance,
} from './solarMath'
import {
  buildDwdSolarZipUrl,
  parseDwdSolarProduct,
  normalizeHourlySolarRecord,
  parseDwdTimestamp,
  aggregateMonthlyIrradiation,
  J_PER_CM2_TO_KWH_PER_M2,
} from './dwdUtils'

// The Vite dev proxy maps /dwd to opendata.dwd.de.
const DWD_STATION_METADATA_URL =
  '/dwd/climate_environment/CDC/observations_germany/climate/hourly/solar/ST_Stundenwerte_Beschreibung_Stationen.txt'

const DEFAULT_LOCATION = { name: 'Amperecloud Berlin', lat: 52.527, lon: 13.4178 }

const MONTH_LABELS = ['Jan', 'Feb', 'Mrz', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
const MONTH_KEYS   = ['01',  '02',  '03',  '04',  '05',  '06',  '07',  '08',  '09',  '10',  '11',  '12']

// Shared mutable state
let dwdStations            = []
let marker                 = null
let latestMonthlySeries    = []
let latestTiltedSeries     = []
let latestHourlyRecords    = []
let latestStationName      = ''
let latestSelectedLocation = { lat: DEFAULT_LOCATION.lat, lon: DEFAULT_LOCATION.lon }

// ── Layout ────────────────────────────────────────────────────────────────────

document.querySelector('#app').innerHTML = `
  <div class="app">
    <header class="app-header">
      <h1>Amperecloud Solar Irradiation Explorer</h1>
      <p class="subtitle">Standortwahl per Karte · Historische Solarstrahlung · PV-Ertragsschätzung</p>
    </header>

    <div class="top-grid">
      <div class="card">
        <h2>Standort</h2>
        <div class="info-box">
          <div class="info-row">
            <span class="info-label">Gewählter Standort</span>
            <span id="selected-location" class="info-value">Auf Karte klicken…</span>
          </div>
          <div class="info-row">
            <span class="info-label">Nächste DWD-Station</span>
            <span id="nearest-station" class="info-value">–</span>
          </div>
        </div>
        <div id="map"></div>
      </div>

      <div class="card">
        <h2>Monatliche Globalstrahlung</h2>
        <div class="chart-controls">
          <label class="chart-control">
            <span>Jahr</span>
            <select id="year-select"></select>
          </label>
          <label class="chart-control">
            <span>Vergleich</span>
            <select id="year-range-select">
              <option value="1">1 Jahr</option>
              <option value="2">2 Jahre</option>
              <option value="5">5 Jahre</option>
              <option value="10">10 Jahre</option>
            </select>
          </label>
        </div>
        <div id="chart-loading" class="chart-loading">
          <div class="spinner"></div>
          <span>DWD-Daten werden geladen…</span>
        </div>
        <div id="chart-error" class="chart-error hidden"></div>
        <div id="irradiance-chart" style="display:none"></div>
        <div id="annual-kpis" class="annual-kpis hidden">
          <div class="kpi-chip">
            <span class="chip-label">Ausgewähltes Jahr</span>
            <span id="annual-selected" class="chip-value">–</span>
          </div>
          <div class="kpi-chip">
            <span class="chip-label">Ø Alle Jahre</span>
            <span id="annual-avg" class="chip-value">–</span>
          </div>
          <div class="kpi-chip">
            <span class="chip-label">Bestes Jahr</span>
            <span id="annual-best" class="chip-value">–</span>
          </div>
        </div>
      </div>
    </div>

    <div class="card yield-card">
      <h2>PV-Ertragsrechner</h2>
      <div class="yield-grid">
        <div class="yield-controls-col">
          <div class="controls-group">
            <h3>Ausrichtung</h3>
            <label class="slider-control">
              <div class="slider-header">
                <span>Azimut</span>
                <span id="azimuth-value" class="slider-badge">180°</span>
              </div>
              <input id="azimuth-slider" type="range" min="0" max="360" value="180" step="1" />
            </label>
            <label class="slider-control">
              <div class="slider-header">
                <span>Neigung</span>
                <span id="tilt-value" class="slider-badge">35°</span>
              </div>
              <input id="tilt-slider" type="range" min="0" max="90" value="35" step="1" />
            </label>
          </div>

          <div class="controls-group">
            <h3>Module</h3>
            <div class="module-inputs">
              <label class="input-control">
                <span>Leistung (W/Modul)</span>
                <input id="module-power-input" type="number" min="1" step="1" value="450" />
              </label>
              <label class="input-control">
                <span>Fläche (m²/Modul)</span>
                <input id="module-area-input" type="number" min="0.1" step="0.01" value="2.0" />
              </label>
              <label class="input-control">
                <span>Anzahl Module</span>
                <input id="module-count-input" type="number" min="1" step="1" value="20" />
              </label>
              <label class="input-control">
                <span>Strompreis (€/kWh)</span>
                <input id="electricity-price-input" type="number" min="0" step="0.001" value="0.10" />
              </label>
            </div>
          </div>

          <div class="yield-kpis">
            <div class="kpi-card">
              <span class="kpi-label">Geneigte Jahresstrahlung</span>
              <span id="estimated-yield" class="kpi-value">–</span>
            </div>
            <div class="kpi-card">
              <span class="kpi-label">STC-Wirkungsgrad</span>
              <span id="module-efficiency" class="kpi-value">–</span>
            </div>
            <div class="kpi-card">
              <span class="kpi-label">Jahresertrag</span>
              <span id="annual-energy-yield" class="kpi-value">–</span>
            </div>
            <div class="kpi-card">
              <span class="kpi-label">Jahresumsatz</span>
              <span id="annual-revenue" class="kpi-value">–</span>
            </div>
          </div>
        </div>

        <div class="yield-chart-col">
          <div id="yield-chart" class="yield-chart-empty">
            <span>Wähle einen Standort um den Monatsertrag zu sehen</span>
          </div>
        </div>
      </div>
    </div>
  </div>
`

// ── Map ───────────────────────────────────────────────────────────────────────

const map = L.map('map').setView([51.1657, 10.4515], 6)
setTimeout(() => map.invalidateSize(), 100)

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors',
  maxZoom: 19,
}).addTo(map)

// ── DOM refs ──────────────────────────────────────────────────────────────────

const selectedLocationEl    = document.querySelector('#selected-location')
const nearestStationEl      = document.querySelector('#nearest-station')
const yearSelectEl          = document.querySelector('#year-select')
const yearRangeSelectEl     = document.querySelector('#year-range-select')
const azimuthSliderEl       = document.querySelector('#azimuth-slider')
const tiltSliderEl          = document.querySelector('#tilt-slider')
const azimuthValueEl        = document.querySelector('#azimuth-value')
const tiltValueEl           = document.querySelector('#tilt-value')
const estimatedYieldEl      = document.querySelector('#estimated-yield')
const modulePowerInputEl    = document.querySelector('#module-power-input')
const moduleAreaInputEl     = document.querySelector('#module-area-input')
const moduleCountInputEl    = document.querySelector('#module-count-input')
const moduleEfficiencyEl    = document.querySelector('#module-efficiency')
const annualEnergyYieldEl   = document.querySelector('#annual-energy-yield')
const electricityPriceInputEl = document.querySelector('#electricity-price-input')
const annualRevenueEl       = document.querySelector('#annual-revenue')
const chartLoadingEl        = document.querySelector('#chart-loading')
const chartErrorEl          = document.querySelector('#chart-error')
const irradianceChartEl     = document.querySelector('#irradiance-chart')
const annualKpisEl          = document.querySelector('#annual-kpis')
const annualSelectedEl      = document.querySelector('#annual-selected')
const annualAvgEl           = document.querySelector('#annual-avg')
const annualBestEl          = document.querySelector('#annual-best')
const yieldChartEl          = document.querySelector('#yield-chart')

// ── General helpers ───────────────────────────────────────────────────────────

function debounce(fn, delay) {
  let timer
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
}

function setIrradianceChartState(state, message = '') {
  irradianceChartEl.style.display = state === 'ready' ? '' : 'none'
  chartLoadingEl.classList.toggle('hidden', state !== 'loading')
  chartErrorEl.classList.toggle('hidden', state !== 'error')
  annualKpisEl.classList.toggle('hidden', state !== 'ready')
  if (state === 'error') chartErrorEl.textContent = message
}

// ── Timezone helpers (CET / CEST) ─────────────────────────────────────────────

function getLastSundayOfMonth(year, month) {
  const lastDay = new Date(year, month, 0).getDate()
  return lastDay - new Date(year, month - 1, lastDay).getDay()
}

// Germany uses CET (UTC+1) in winter and CEST (UTC+2) from the last Sunday of
// March to the last Sunday of October. Using UTC+1 year-round skews summer sun
// positions by a full hour — enough to meaningfully affect tilted yield totals.
function getCentralEuropeanOffset(year, month, day) {
  if (month > 3 && month < 10) return 2
  if (month < 3 || month > 10) return 1
  const lastSunday = getLastSundayOfMonth(year, month)
  if (month === 3) return day >= lastSunday ? 2 : 1
  return day < lastSunday ? 2 : 1
}

// ── Station lookup ────────────────────────────────────────────────────────────

function getDistanceInKm(lat1, lon1, lat2, lon2) {
  const toRad = (v) => (v * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function findNearestStation(lat, lon, stationList) {
  let nearest = null
  let minDist = Infinity
  for (const s of stationList) {
    const d = getDistanceInKm(lat, lon, s.lat, s.lon)
    if (d < minDist) { minDist = d; nearest = { ...s, distanceKm: d } }
  }
  return nearest
}

async function updateLocationAndChart(lat, lng, locationLabel = null) {
  const stationSource = dwdStations.length > 0 ? dwdStations : stations
  const nearestStation = findNearestStation(lat, lng, stationSource)

  if (!nearestStation?.stationId) {
    setIrradianceChartState('error', 'DWD-Stationsdaten nicht verfügbar – bitte Seite neu laden.')
    return
  }

  latestSelectedLocation = { lat, lon: lng }

  if (marker) {
    marker.setLatLng([lat, lng])
  } else {
    marker = L.marker([lat, lng]).addTo(map)
  }

  const label = locationLabel ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`
  marker.bindPopup(`${label}<br>${lat.toFixed(4)}, ${lng.toFixed(4)}`).openPopup()

  selectedLocationEl.textContent = label
  nearestStationEl.textContent = `${nearestStation.name} (${nearestStation.distanceKm.toFixed(1)} km)`

  await loadStationData(buildDwdSolarZipUrl(nearestStation.stationId), nearestStation.name)
}

// ── Data processing ───────────────────────────────────────────────────────────

function getSelectedComparisonYear() {
  return latestMonthlySeries.length > 0
    ? Number(yearSelectEl.value || latestMonthlySeries.at(-1).year)
    : new Date().getFullYear()
}

function aggregateTiltedMonthlyForYear(records, year, location, surfaceAzimuth, surfaceTilt) {
  const monthlySums = new Map()
  const numberOfDaysInYear = getNumberOfDaysInYear(year)

  for (const rawRecord of records) {
    const record = normalizeHourlySolarRecord(rawRecord)
    if (!record.timestamp || record.globalHorizontal === null || record.diffuseHorizontal === null) continue

    const ts = parseDwdTimestamp(record.timestamp)
    if (ts.year !== year) continue

    const sunPosition = getSunPosition({
      longitude: location.lon,
      latitude: location.lat,
      dayOfYear: getDayOfYear(ts.year, ts.month, ts.day),
      timeZone: getCentralEuropeanOffset(ts.year, ts.month, ts.day),
      localTime: ts.hour,
      numberOfDaysInYear,
    })

    if (!sunPosition || sunPosition.sunElevation <= 0) continue

    const { globalTilted } = getTiltedGlobalIrradiance({
      globalHorizontal: record.globalHorizontal,
      diffuseHorizontal: record.diffuseHorizontal,
      surfaceAzimuth,
      surfaceTilt,
      sunAzimuth: sunPosition.sunAzimuth,
      sunElevation: sunPosition.sunElevation,
      albedo: 0.2,
    })

    const monthKey = String(ts.month).padStart(2, '0')
    monthlySums.set(monthKey, (monthlySums.get(monthKey) ?? 0) + globalTilted)
  }

  return MONTH_KEYS.map((month) => ({
    year: String(year),
    month,
    irradiationJPerCm2: monthlySums.get(month) ?? 0,
    irradiationKwhPerM2: (monthlySums.get(month) ?? 0) * J_PER_CM2_TO_KWH_PER_M2,
  }))
}

function recalculateTiltedSeries() {
  if (latestHourlyRecords.length === 0) { latestTiltedSeries = []; return }

  latestTiltedSeries = aggregateTiltedMonthlyForYear(
    latestHourlyRecords,
    getSelectedComparisonYear(),
    latestSelectedLocation,
    Number(azimuthSliderEl.value),
    Number(tiltSliderEl.value),
  )
}

// ── Chart helpers ─────────────────────────────────────────────────────────────

const PLOTLY_BASE = {
  paper_bgcolor: '#111827',
  plot_bgcolor: '#111827',
  font: { color: '#e5e7eb' },
  margin: { t: 40, r: 20, b: 75, l: 75 },
  xaxis: { gridcolor: '#374151', tickangle: 0, type: 'category', categoryorder: 'array', categoryarray: MONTH_LABELS },
  yaxis: { gridcolor: '#374151' },
  legend: { orientation: 'h', y: 1.14 },
}

function getAvailableYears(series) {
  return [...new Set(series.map((e) => e.year))].sort((a, b) => a.localeCompare(b))
}

function populateYearSelect(series) {
  const years = getAvailableYears(series)
  const prev  = yearSelectEl.value
  yearSelectEl.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join('')
  yearSelectEl.value = years.includes(prev) ? prev : years.at(-1)
}

function getSelectedYears(series) {
  const years  = getAvailableYears(series)
  const end    = yearSelectEl.value
  const range  = Number(yearRangeSelectEl.value)
  const endIdx = years.indexOf(end)
  if (endIdx === -1 || Number.isNaN(range)) return []
  return years.slice(Math.max(0, endIdx - range + 1), endIdx + 1)
}

function updateAnnualKpis(series) {
  const annualSums = new Map()
  for (const e of series) annualSums.set(e.year, (annualSums.get(e.year) ?? 0) + e.irradiationKwhPerM2)

  const selectedSum = annualSums.get(yearSelectEl.value)
  const values      = [...annualSums.values()]
  const avg         = values.reduce((a, b) => a + b, 0) / values.length
  const best        = Math.max(...values)
  const bestYear    = [...annualSums.entries()].find(([, v]) => v === best)?.[0]

  annualSelectedEl.textContent = selectedSum ? `${selectedSum.toFixed(0)} kWh/m²` : '–'
  annualAvgEl.textContent      = `${avg.toFixed(0)} kWh/m²`
  annualBestEl.textContent     = `${best.toFixed(0)} kWh/m² (${bestYear})`
}

function renderIrradianceChart(monthlySeries, stationName) {
  latestMonthlySeries = monthlySeries
  latestStationName   = stationName

  populateYearSelect(monthlySeries)
  updateAnnualKpis(monthlySeries)

  const traces = getSelectedYears(monthlySeries).map((year) => {
    const byMonth = new Map(monthlySeries.filter((e) => e.year === year).map((e) => [e.month, e]))
    return {
      x: MONTH_LABELS,
      y: MONTH_KEYS.map((m) => byMonth.get(m)?.irradiationKwhPerM2 ?? null),
      type: 'scatter',
      mode: 'lines+markers',
      name: year,
      hovertemplate: '%{x}<br>%{y:.1f} kWh/m²<extra></extra>',
    }
  })

  Plotly.react(
    'irradiance-chart',
    traces,
    {
      ...PLOTLY_BASE,
      title: `Monatliche Globalstrahlung – ${stationName}`,
      yaxis: { ...PLOTLY_BASE.yaxis, title: { text: 'kWh/m²', standoff: 14 } },
    },
    { responsive: true },
  )
}

function renderYieldChart() {
  if (latestTiltedSeries.length === 0) return

  const modulePower = Number(modulePowerInputEl.value)
  const moduleArea  = Number(moduleAreaInputEl.value)
  const moduleCount = Number(moduleCountInputEl.value)
  if (!(modulePower > 0 && moduleArea > 0 && moduleCount > 0)) return

  const efficiency  = modulePower / (1000 * moduleArea)
  const totalArea   = moduleArea * moduleCount
  const year        = latestTiltedSeries[0]?.year ?? ''
  const monthlyKwh  = latestTiltedSeries.map((e) => e.irradiationKwhPerM2 * totalArea * efficiency)

  yieldChartEl.classList.remove('yield-chart-empty')

  Plotly.react(
    'yield-chart',
    [
      {
        x: MONTH_LABELS,
        y: monthlyKwh,
        type: 'bar',
        marker: { color: '#2563eb' },
        hovertemplate: '%{x}<br>%{y:.0f} kWh<extra></extra>',
      },
    ],
    {
      ...PLOTLY_BASE,
      title: `Geschätzter Monatsertrag ${year}`,
      yaxis: { ...PLOTLY_BASE.yaxis, title: { text: 'Ertrag (kWh)', standoff: 14 } },
      showlegend: false,
      bargap: 0.3,
    },
    { responsive: true },
  )
}

// ── Yield KPIs ────────────────────────────────────────────────────────────────

function updateYieldKpis() {
  const modulePower      = Number(modulePowerInputEl.value)
  const moduleArea       = Number(moduleAreaInputEl.value)
  const moduleCount      = Number(moduleCountInputEl.value)
  const electricityPrice = Number(electricityPriceInputEl.value)

  const valid =
    Number.isFinite(modulePower)      && modulePower > 0 &&
    Number.isFinite(moduleArea)       && moduleArea > 0 &&
    Number.isFinite(moduleCount)      && moduleCount > 0 &&
    Number.isFinite(electricityPrice) && electricityPrice >= 0

  if (!valid) {
    for (const el of [moduleEfficiencyEl, estimatedYieldEl, annualEnergyYieldEl, annualRevenueEl]) {
      el.textContent = '–'
    }
    return
  }

  const efficiency = modulePower / (1000 * moduleArea)
  moduleEfficiencyEl.textContent = `${(efficiency * 100).toFixed(1)} %`

  if (latestTiltedSeries.length === 0) {
    estimatedYieldEl.textContent = annualEnergyYieldEl.textContent = annualRevenueEl.textContent = '–'
    return
  }

  const annualIrradiation = latestTiltedSeries.reduce((s, e) => s + e.irradiationKwhPerM2, 0)
  const annualEnergy      = annualIrradiation * moduleArea * moduleCount * efficiency
  const annualRevenue     = annualEnergy * electricityPrice

  estimatedYieldEl.textContent    = `${annualIrradiation.toFixed(1)} kWh/m²`
  annualEnergyYieldEl.textContent = `${annualEnergy.toFixed(0)} kWh`
  annualRevenueEl.textContent     = `${annualRevenue.toFixed(0)} €`
}

// ── DWD fetch ─────────────────────────────────────────────────────────────────

async function loadStationData(zipUrl, stationName) {
  setIrradianceChartState('loading')
  try {
    const response = await fetch(zipUrl)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const zip = await JSZip.loadAsync(await response.arrayBuffer())
    const productFileName = Object.keys(zip.files).find(
      (n) => n.startsWith('produkt_st_stunde_') && n.endsWith('.txt'),
    )
    if (!productFileName) throw new Error('Keine Produktdatei im ZIP')

    const parsedRecords = parseDwdSolarProduct(await zip.files[productFileName].async('string'))

    latestHourlyRecords = parsedRecords
    recalculateTiltedSeries()

    const monthlySeries = aggregateMonthlyIrradiation(parsedRecords)
    setIrradianceChartState('ready')
    renderIrradianceChart(monthlySeries, stationName)
    renderYieldChart()
    updateYieldKpis()
  } catch (error) {
    console.error('DWD-Fetch-Fehler:', error)
    setIrradianceChartState('error', `Daten konnten nicht geladen werden: ${error.message}`)
  }
}

async function loadStationMetadata() {
  try {
    const response = await fetch(DWD_STATION_METADATA_URL)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const lines = (await response.text()).split('\n').map((l) => l.trim()).filter(Boolean)
    dwdStations = lines.slice(2).map((line) => {
      const parts = line.split(/\s+/)
      return {
        stationId: parts[0],
        fromDate:  parts[1],
        toDate:    parts[2],
        height:    parts[3],
        lat:       Number(parts[4]),
        lon:       Number(parts[5]),
        name:      parts.slice(6, -1).join(' '),
        state:     parts.at(-1),
      }
    })
  } catch (error) {
    console.error('DWD-Metadaten-Fehler:', error)
    setIrradianceChartState('error', 'DWD-Stationsliste konnte nicht geladen werden – bitte Seite neu laden.')
  }
}

// ── Bootstrap + event listeners ───────────────────────────────────────────────

loadStationMetadata().then(() => {
  updateLocationAndChart(DEFAULT_LOCATION.lat, DEFAULT_LOCATION.lon, DEFAULT_LOCATION.name)
})

map.on('click', ({ latlng: { lat, lng } }) => updateLocationAndChart(lat, lng))

yearSelectEl.addEventListener('change', () => {
  if (latestMonthlySeries.length > 0) renderIrradianceChart(latestMonthlySeries, latestStationName)
  recalculateTiltedSeries()
  renderYieldChart()
  updateYieldKpis()
})

yearRangeSelectEl.addEventListener('change', () => {
  if (latestMonthlySeries.length > 0) renderIrradianceChart(latestMonthlySeries, latestStationName)
})

const debouncedSliderUpdate = debounce(() => {
  recalculateTiltedSeries()
  renderYieldChart()
  updateYieldKpis()
}, 250)

azimuthSliderEl.addEventListener('input', () => {
  azimuthValueEl.textContent = `${azimuthSliderEl.value}°`
  debouncedSliderUpdate()
})

tiltSliderEl.addEventListener('input', () => {
  tiltValueEl.textContent = `${tiltSliderEl.value}°`
  debouncedSliderUpdate()
})

for (const el of [modulePowerInputEl, moduleAreaInputEl, moduleCountInputEl, electricityPriceInputEl]) {
  el.addEventListener('input', () => { renderYieldChart(); updateYieldKpis() })
}

updateYieldKpis()

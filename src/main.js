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
} from './dwdUtils'

// -----------------------------------------------------------------------------
// DWD configuration and shared application state
// -----------------------------------------------------------------------------
// DWD source for hourly solar station metadata. The Vite dev proxy maps /dwd to opendata.dwd.de.
const DWD_STATION_METADATA_URL =
  '/dwd/climate_environment/CDC/observations_germany/climate/hourly/solar/ST_Stundenwerte_Beschreibung_Stationen.txt'

// Initial map location shown when the app loads.
const DEFAULT_LOCATION = {
  name: 'Amperecloud Berlin',
  lat: 52.527,
  lon: 13.4178,
}

// Shared application state.
let dwdStations = []
let marker = null
let latestMonthlySeries = []
let latestTiltedMonthlySeries = []
let latestHourlyRecords = []
let latestStationName = ''
let latestSelectedLocation = {
  lat: DEFAULT_LOCATION.lat,
  lon: DEFAULT_LOCATION.lon,
  label: DEFAULT_LOCATION.name,
}

// -----------------------------------------------------------------------------
// App layout
// -----------------------------------------------------------------------------

document.querySelector('#app').innerHTML = `
  <div class="app">
    <div id="main-view">
      <h1>Amperecloud Solar Irradiation Explorer</h1>
      <p class="subtitle">
        MVP – Standortwahl per Karte und interaktive Visualisierung von Solarstrahlung
      </p>

      <!-- Main layout: map on the left, chart and controls on the right -->
      <div class="top-grid">
        <div class="card">
          <h2>Karte</h2>
          <!-- Selected location and nearest DWD station -->
          <div class="info-box">
            <strong>Gewählter Standort:</strong>
            <span id="selected-location">Noch kein Punkt gewählt</span>
            <br />
            <strong>Nächste Station:</strong>
            <span id="nearest-station">Noch keine Station gewählt</span>
          </div>
          <div id="map"></div>
        </div>

        <div class="card">
          <h2>Visualisierung</h2>
          <!-- Controls for choosing the comparison years shown in the chart -->
          <div class="chart-controls">
            <label class="chart-control">
              <span>Jahr</span>
              <select id="year-select"></select>
            </label>
            <label class="chart-control">
              <span>Anzahl Jahre</span>
              <select id="year-range-select">
                <option value="1">1 Jahr</option>
                <option value="2">2 Jahre</option>
                <option value="5">5 Jahre</option>
                <option value="10">10 Jahre</option>
              </select>
            </label>
          </div>

          <!-- Plotly chart container -->
          <div id="chart"></div>
          <button id="yield-button" class="primary-button">Ertrag berechnen</button>
        </div>
      </div>
    </div>

    <div id="yield-view" class="hidden-view">
      <h1>PV-Ertragsrechner</h1>
      <p class="subtitle">
        Konfiguration von Modulausrichtung und Neigung zur Ertragsabschätzung
      </p>

      <div class="card">
        <div class="info-box">
          <strong>Standort:</strong>
          <span id="yield-location">Noch kein Standort gewählt</span>
          <br />
          <strong>DWD-Station:</strong>
          <span id="yield-station">Noch keine Station gewählt</span>
        </div>

        <div class="yield-controls">
          <label class="slider-control">
            <span>Azimut des Moduls</span>
            <input id="azimuth-slider" type="range" min="0" max="360" value="180" step="1" />
            <span id="azimuth-value">180°</span>
          </label>
          
          <label class="slider-control">
            <span>Neigung des Moduls</span>
            <input id="tilt-slider" type="range" min="0" max="90" value="35" step="1" />
            <span id="tilt-value">35°</span>
          </label>
        </div>
        <div class="yield-controls">
          <label class="slider-control">
            <span>Max Power pro Modul (W)</span>
            <input id="module-power-input" type="number" min="1" step="1" value="450" />
          </label>
          <label class="slider-control">
            <span>Modulfläche pro Modul (m²)</span>
            <input id="module-area-input" type="number" min="0.1" step="0.01" value="2.0" />
          </label>
          <label class="slider-control">
            <span>Anzahl Module</span>
            <input id="module-count-input" type="number" min="1" step="1" value="20" />
          </label>
        </div>

        <div class="yield-kpis">
          <div class="kpi-card">
            <strong>Orientierungsfaktor</strong>
            <span id="orientation-factor">-</span>
          </div>
          <div class="kpi-card">
            <strong>Geneigte Jahresstrahlung</strong>
            <span id="estimated-yield">-</span>
          </div>
          <div class="kpi-card">
            <strong>STC-Wirkungsgrad</strong>
            <span id="module-efficiency">-</span>
          </div>
          <div class="kpi-card">
            <strong>Geschätzter Jahresertrag</strong>
            <span id="annual-energy-yield">-</span>
          </div>
        </div>

        <button id="back-button" class="primary-button">Zurück zur Karte</button>
      </div>
    </div>
  </div>
`

// -----------------------------------------------------------------------------
// Map setup and DOM references
// -----------------------------------------------------------------------------

const map = L.map('map').setView([51.1657, 10.4515], 6)
setTimeout(() => {
  map.invalidateSize()
}, 100)

// Cache references to the DOM elements that are updated during interaction.
const selectedLocationEl = document.querySelector('#selected-location')
const nearestStationEl = document.querySelector('#nearest-station')
const yearSelectEl = document.querySelector('#year-select')
const yearRangeSelectEl = document.querySelector('#year-range-select')
const mainViewEl = document.querySelector('#main-view')
const yieldViewEl = document.querySelector('#yield-view')
const yieldButtonEl = document.querySelector('#yield-button')
const backButtonEl = document.querySelector('#back-button')
const yieldLocationEl = document.querySelector('#yield-location')
const yieldStationEl = document.querySelector('#yield-station')
const azimuthSliderEl = document.querySelector('#azimuth-slider')
const tiltSliderEl = document.querySelector('#tilt-slider')
const azimuthValueEl = document.querySelector('#azimuth-value')
const tiltValueEl = document.querySelector('#tilt-value')
const orientationFactorEl = document.querySelector('#orientation-factor')
const estimatedYieldEl = document.querySelector('#estimated-yield')
const modulePowerInputEl = document.querySelector('#module-power-input')
const moduleAreaInputEl = document.querySelector('#module-area-input')
const moduleCountInputEl = document.querySelector('#module-count-input')
const moduleEfficiencyEl = document.querySelector('#module-efficiency')
const annualEnergyYieldEl = document.querySelector('#annual-energy-yield')

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors',
  maxZoom: 19,
}).addTo(map)

// -----------------------------------------------------------------------------
// UI helpers
// -----------------------------------------------------------------------------

function showMainView() {
  mainViewEl.classList.remove('hidden-view')
  yieldViewEl.classList.add('hidden-view')
}

function showYieldView() {
  mainViewEl.classList.add('hidden-view')
  yieldViewEl.classList.remove('hidden-view')
}

function calculateOrientationFactor(azimuth, tilt) {
  const azimuthDeviation = Math.abs(azimuth - 180)
  const normalizedAzimuthLoss = Math.min(azimuthDeviation / 180, 1)

  const optimalTilt = 35
  const tiltDeviation = Math.abs(tilt - optimalTilt)
  const normalizedTiltLoss = Math.min(tiltDeviation / 55, 1)

  const azimuthFactor = 1 - 0.22 * normalizedAzimuthLoss
  const tiltFactor = 1 - 0.12 * normalizedTiltLoss

  return Math.max(0.6, azimuthFactor * tiltFactor)
}

function updateYieldEstimation() {
  const azimuth = Number(azimuthSliderEl.value)
  const tilt = Number(tiltSliderEl.value)
  const modulePower = Number(modulePowerInputEl.value)
  const moduleArea = Number(moduleAreaInputEl.value)
  const moduleCount = Number(moduleCountInputEl.value)

  azimuthValueEl.textContent = `${azimuth}°`
  tiltValueEl.textContent = `${tilt}°`

  const orientationFactor = calculateOrientationFactor(azimuth, tilt)
  orientationFactorEl.textContent = orientationFactor.toFixed(2)

  let annualTiltedIrradiation = null

  if (latestTiltedMonthlySeries.length > 0) {
    annualTiltedIrradiation = latestTiltedMonthlySeries.reduce(
      (sum, entry) => sum + entry.irradiationKwhPerM2,
      0
    )
    estimatedYieldEl.textContent = `${annualTiltedIrradiation.toFixed(1)} kWh/m²`
  } else {
    estimatedYieldEl.textContent = '-'
  }

  const hasValidModuleInputs =
    Number.isFinite(modulePower) &&
    Number.isFinite(moduleArea) &&
    Number.isFinite(moduleCount) &&
    modulePower > 0 &&
    moduleArea > 0 &&
    moduleCount > 0

  if (!hasValidModuleInputs) {
    moduleEfficiencyEl.textContent = '-'
    annualEnergyYieldEl.textContent = '-'
    return
  }

  // STC assumes 1000 W/m² irradiation, so efficiency can be estimated from
  // module peak power divided by irradiated module area.
  const moduleEfficiency = modulePower / (1000 * moduleArea)
  const totalArea = moduleArea * moduleCount

  moduleEfficiencyEl.textContent = `${(moduleEfficiency * 100).toFixed(1)} %`

  if (annualTiltedIrradiation !== null) {
    const annualEnergyYield = annualTiltedIrradiation * totalArea * moduleEfficiency
    annualEnergyYieldEl.textContent = `${annualEnergyYield.toFixed(1)} kWh/Jahr`
  } else {
    annualEnergyYieldEl.textContent = '-'
  }
}

// -----------------------------------------------------------------------------
// Station lookup and DWD data loading helpers
// -----------------------------------------------------------------------------

// Calculate the great-circle distance between two coordinates in kilometers.
function getDistanceInKm(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180

  const earthRadiusKm = 6371
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return earthRadiusKm * c
}

// Find the nearest station from a list of station objects.
function findNearestStation(lat, lon, stations) {
  let nearestStation = null
  let minDistance = Infinity

  for (const station of stations) {
    const distance = getDistanceInKm(lat, lon, station.lat, station.lon)

    if (distance < minDistance) {
      minDistance = distance
      nearestStation = {
        ...station,
        distanceKm: distance,
      }
    }
  }

  return nearestStation
}

// Update the selected location, nearest station label, marker, and chart.
async function updateLocationAndChart(lat, lng, locationLabel = null) {
  // Use parsed DWD stations when available, otherwise fall back to the local starter list.
  const stationSource = dwdStations.length > 0 ? dwdStations : stations
  const nearestStation = findNearestStation(lat, lng, stationSource)
  const zipUrl = buildDwdSolarZipUrl(nearestStation.stationId)
  // Persist the exact user-selected location so the tilted calculation uses the
  // same coordinates as the current map selection.
  latestSelectedLocation = {
    lat,
    lon: lng,
    label: locationLabel ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
  }

  console.log('DWD ZIP URL:', zipUrl)
  console.log('Nächste Station:', nearestStation)

  // Move the existing marker or create it the first time.
  if (marker) {
    marker.setLatLng([lat, lng])
  } else {
    marker = L.marker([lat, lng]).addTo(map)
  }

  marker
    .bindPopup(
      `${locationLabel ?? 'Gewählter Standort'}<br>Lat: ${lat.toFixed(4)}<br>Lon: ${lng.toFixed(4)}`
    )
    .openPopup()

  // Update the UI labels for the clicked location and the nearest station.
  selectedLocationEl.textContent = locationLabel ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`
  nearestStationEl.textContent = `${nearestStation.name} (${nearestStation.distanceKm.toFixed(1)} km entfernt)`
  yieldLocationEl.textContent = locationLabel ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`
  yieldStationEl.textContent = `${nearestStation.name} (${nearestStation.distanceKm.toFixed(1)} km entfernt)`

  // Load the measurement ZIP for the nearest station and redraw the chart.
  await testDwdZipFetch(zipUrl, nearestStation.name)

  console.log('Gewählter Punkt:', { lat, lng })
}

// -----------------------------------------------------------------------------
// Data parsing and aggregation helpers
// -----------------------------------------------------------------------------




function getFirstUsableHourlyRecord(records) {
  for (const record of records) {
    const normalized = normalizeHourlySolarRecord(record)

    if (
      normalized.timestamp &&
      normalized.globalHorizontal !== null &&
      normalized.diffuseHorizontal !== null &&
      normalized.globalHorizontal > 0
    ) {
      return normalized
    }
  }

  return null
}

function getSelectedComparisonYear() {
  if (latestMonthlySeries.length > 0) {
    return Number(yearSelectEl.value || latestMonthlySeries[latestMonthlySeries.length - 1].year)
  }

  return new Date().getFullYear()
}

function aggregateTiltedMonthlyForYear(records, year, location, surfaceAzimuth, surfaceTilt) {
  // Sum the hourly irradiation transformed onto the tilted module plane.
  const monthlySums = new Map()
  const numberOfDaysInYear = getNumberOfDaysInYear(year)

  for (const rawRecord of records) {
    const record = normalizeHourlySolarRecord(rawRecord)

    if (
      !record.timestamp ||
      record.globalHorizontal === null ||
      record.diffuseHorizontal === null
    ) {
      continue
    }

    const parsedTimestamp = parseDwdTimestamp(record.timestamp)

    if (parsedTimestamp.year !== year) {
      continue
    }

    const dayOfYear = getDayOfYear(
      parsedTimestamp.year,
      parsedTimestamp.month,
      parsedTimestamp.day
    )

    // Derive the solar position for the current hour at the selected location.
    const sunPosition = getSunPosition({
      longitude: location.lon,
      latitude: location.lat,
      dayOfYear,
      timeZone: 1,
      localTime: parsedTimestamp.hour,
      numberOfDaysInYear,
    })

    if (!sunPosition || sunPosition.sunElevation <= 0) {
      continue
    }

    // Transform horizontal irradiation into irradiation on the tilted module plane.
    const tiltedIrradiance = getTiltedGlobalIrradiance({
      globalHorizontal: record.globalHorizontal,
      diffuseHorizontal: record.diffuseHorizontal,
      surfaceAzimuth,
      surfaceTilt,
      sunAzimuth: sunPosition.sunAzimuth,
      sunElevation: sunPosition.sunElevation,
      albedo: 0.2,
    })

    const monthKey = String(parsedTimestamp.month).padStart(2, '0')

    if (!monthlySums.has(monthKey)) {
      monthlySums.set(monthKey, 0)
    }

    monthlySums.set(monthKey, monthlySums.get(monthKey) + tiltedIrradiance.globalTilted)
  }

  return ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'].map(
    (month) => ({
      year: String(year),
      month,
      label: `${year}-${month}`,
      irradiationJPerCm2: monthlySums.get(month) ?? 0,
      irradiationKwhPerM2: (monthlySums.get(month) ?? 0) / 360,
    })
  )
}

function recalculateTiltedSeries() {
  if (latestHourlyRecords.length === 0) {
    latestTiltedMonthlySeries = []
    return
  }

  latestTiltedMonthlySeries = aggregateTiltedMonthlyForYear(
    latestHourlyRecords,
    getSelectedComparisonYear(),
    latestSelectedLocation,
    Number(azimuthSliderEl.value),
    Number(tiltSliderEl.value)
  )
}

// -----------------------------------------------------------------------------
// Chart helpers
// -----------------------------------------------------------------------------

// Aggregate hourly global irradiation values into monthly sums.


// Extract the available years from the aggregated monthly time series.
function getAvailableYears(monthlySeries) {
  return Array.from(new Set(monthlySeries.map((entry) => entry.year))).sort((a, b) =>
    a.localeCompare(b)
  )
}

// Fill the year dropdown while keeping the user's current selection if possible.
function populateYearSelect(monthlySeries) {
  const availableYears = getAvailableYears(monthlySeries)
  const currentValue = yearSelectEl.value

  yearSelectEl.innerHTML = availableYears
    .map((year) => `<option value="${year}">${year}</option>`)
    .join('')

  if (currentValue && availableYears.includes(currentValue)) {
    yearSelectEl.value = currentValue
  } else if (availableYears.length > 0) {
    yearSelectEl.value = availableYears[availableYears.length - 1]
  }
}

// Compute which years should be shown based on the selected end year and range.
function getSelectedYears(monthlySeries) {
  const availableYears = getAvailableYears(monthlySeries)
  const selectedYear = yearSelectEl.value
  const selectedRange = Number(yearRangeSelectEl.value)

  if (!selectedYear || Number.isNaN(selectedRange)) {
    return []
  }

  const endIndex = availableYears.indexOf(selectedYear)

  if (endIndex === -1) {
    return []
  }

  const startIndex = Math.max(0, endIndex - selectedRange + 1)
  return availableYears.slice(startIndex, endIndex + 1)
}

// Render the Plotly chart for the selected year comparison.
function updateChartWithMonthlySeries(monthlySeries, stationName) {
  // Persist the latest data so the chart can be redrawn when dropdown values change.
  latestMonthlySeries = monthlySeries
  latestStationName = stationName

  populateYearSelect(monthlySeries)

  // Determine which yearly curves should be shown in the comparison chart.
  const selectedYears = getSelectedYears(monthlySeries)
  const monthLabels = ['Jan', 'Feb', 'Mrz', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

  // Build one Plotly trace per selected year using Jan-Dec as the common x-axis.
  const traces = selectedYears.map((year) => {
    const entriesForYear = monthlySeries.filter((entry) => entry.year === year)
    const valuesByMonth = new Map(entriesForYear.map((entry) => [entry.month, entry]))

    const yValues = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'].map(
      (month) => {
        const entry = valuesByMonth.get(month)
        return entry ? entry.irradiationKwhPerM2 : null
      }
    )

    return {
      x: monthLabels,
      y: yValues,
      type: 'scatter',
      mode: 'lines+markers',
      name: year,
      hovertemplate: '%{x}<br>%{y:.1f} kWh/m²<extra></extra>',
    }
  })

  Plotly.newPlot(
    'chart',
    traces,
    {
      title: `Monatliche Globalstrahlung – ${stationName}`,
      paper_bgcolor: '#111827',
      plot_bgcolor: '#111827',
      font: {
        color: '#e5e7eb',
      },
      margin: {
        t: 50,
        r: 20,
        b: 90,
        l: 90,
      },
      xaxis: {
        title: {
          text: 'Monat',
          standoff: 20,
        },
        type: 'category',
        categoryorder: 'array',
        categoryarray: monthLabels,
        tickangle: 0,
        gridcolor: '#374151',
      },
      yaxis: {
        title: {
          text: 'Monatliche Globalstrahlung (kWh/m²)',
          standoff: 20,
        },
        gridcolor: '#374151',
      },
      legend: {
        orientation: 'h',
        y: 1.12,
      },
    },
    {
      responsive: true,
    }
  )
}

// -----------------------------------------------------------------------------
// DWD fetch pipeline
// -----------------------------------------------------------------------------

// Load a station ZIP file, parse the product file, and update the chart.
async function testDwdZipFetch(zipUrl, stationName) {
  try {
    const response = await fetch(zipUrl)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    const zip = await JSZip.loadAsync(arrayBuffer)

    const fileNames = Object.keys(zip.files)

    const productFileName = fileNames.find((name) =>
      name.startsWith('produkt_st_stunde_') && name.endsWith('.txt')
    )

    if (!productFileName) {
      throw new Error('Keine Produktdatei im ZIP gefunden')
    }

    const productFile = zip.files[productFileName]
    const productText = await productFile.async('string')

    const parsedRecords = parseDwdSolarProduct(productText)

    // Keep the full hourly time series in memory so the yield view can recompute
    // tilted irradiation without reloading the DWD ZIP file.
    latestHourlyRecords = parsedRecords
    recalculateTiltedSeries()
    const monthlySeries = aggregateMonthlyIrradiation(parsedRecords)
    updateChartWithMonthlySeries(monthlySeries, stationName)
    updateYieldEstimation()
  } catch (error) {
    console.error('Fehler beim Laden der DWD-ZIP-Datei:', error)
  }
}

// -----------------------------------------------------------------------------
// App bootstrap and event listeners
// -----------------------------------------------------------------------------

// Load and parse the DWD solar station metadata file.
async function testDwdStationMetadataFetch() {
  try {
    const response = await fetch(DWD_STATION_METADATA_URL)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const text = await response.text()

    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    const dataLines = lines.slice(2)

    // Parse the fixed-width-like station description file into station objects.
    const parsedStations = dataLines.map((line) => {
      const parts = line.split(/\s+/)

      return {
        stationId: parts[0],
        fromDate: parts[1],
        toDate: parts[2],
        height: parts[3],
        lat: Number(parts[4]),
        lon: Number(parts[5]),
        name: parts.slice(6, -1).join(' '),
        state: parts[parts.length - 1],
      }
    })
    dwdStations = parsedStations
  } catch (error) {
    console.error('Fehler beim Laden der DWD-Stationsdatei:', error)
  }
}

// Initial app bootstrap: load station metadata first, then load the default location.
testDwdStationMetadataFetch().then(() => {
  updateLocationAndChart(
    DEFAULT_LOCATION.lat,
    DEFAULT_LOCATION.lon,
    DEFAULT_LOCATION.name
  )
})

// User interaction: clicking the map selects a new location.
map.on('click', async (event) => {
  const { lat, lng } = event.latlng
  await updateLocationAndChart(lat, lng)
})

// Redraw the chart and recalculate tilted series when the selected end year changes.
yearSelectEl.addEventListener('change', () => {
  if (latestMonthlySeries.length > 0) {
    updateChartWithMonthlySeries(latestMonthlySeries, latestStationName)
  }

  recalculateTiltedSeries()
  updateYieldEstimation()
})

// Redraw the chart when the year range changes.
yearRangeSelectEl.addEventListener('change', () => {
  if (latestMonthlySeries.length > 0) {
    updateChartWithMonthlySeries(latestMonthlySeries, latestStationName)
  }
})

yieldButtonEl.addEventListener('click', () => {
  showYieldView()
})

backButtonEl.addEventListener('click', () => {
  showMainView()
})

modulePowerInputEl.addEventListener('input', () => {
  updateYieldEstimation()
})

moduleAreaInputEl.addEventListener('input', () => {
  updateYieldEstimation()
})

moduleCountInputEl.addEventListener('input', () => {
  updateYieldEstimation()
})

azimuthSliderEl.addEventListener('input', () => {
  recalculateTiltedSeries()
  updateYieldEstimation()
})

tiltSliderEl.addEventListener('input', () => {
  recalculateTiltedSeries()
  updateYieldEstimation()
})

updateYieldEstimation()
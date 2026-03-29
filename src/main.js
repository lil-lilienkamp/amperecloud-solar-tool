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

        <div class="yield-kpis">
          <div class="kpi-card">
            <strong>Orientierungsfaktor</strong>
            <span id="orientation-factor">-</span>
          </div>
          <div class="kpi-card">
            <strong>Geschätzter relativer Ertrag</strong>
            <span id="estimated-yield">-</span>
          </div>
        </div>

        <button id="back-button" class="primary-button">Zurück zur Karte</button>
      </div>
    </div>
  </div>
`

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

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors',
  maxZoom: 19,
}).addTo(map)

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

  azimuthValueEl.textContent = `${azimuth}°`
  tiltValueEl.textContent = `${tilt}°`

  const orientationFactor = calculateOrientationFactor(azimuth, tilt)
  const estimatedYieldPercent = orientationFactor * 100

  orientationFactorEl.textContent = orientationFactor.toFixed(2)

  if (latestTiltedMonthlySeries.length > 0) {
    const annualTiltedYield = latestTiltedMonthlySeries.reduce(
      (sum, entry) => sum + entry.irradiationKwhPerM2,
      0
    )
    estimatedYieldEl.textContent = `${annualTiltedYield.toFixed(1)} kWh/m²`
  } else {
    estimatedYieldEl.textContent = `${estimatedYieldPercent.toFixed(1)} %`
  }}

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

// Build the DWD ZIP URL for the selected solar station.
function buildDwdSolarZipUrl(stationId) {
  const paddedStationId = stationId.toString().padStart(5, '0')

  return `/dwd/climate_environment/CDC/observations_germany/climate/hourly/solar/stundenwerte_ST_${paddedStationId}_row.zip`
}

// Update the selected location, nearest station label, marker, and chart.
async function updateLocationAndChart(lat, lng, locationLabel = null) {
  // Use parsed DWD stations when available, otherwise fall back to the local starter list.
  const stationSource = dwdStations.length > 0 ? dwdStations : stations
  const nearestStation = findNearestStation(lat, lng, stationSource)
  const zipUrl = buildDwdSolarZipUrl(nearestStation.stationId)
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

// Parse the semicolon-separated DWD product file into record objects.
function parseDwdSolarProduct(productText) {
  const lines = productText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const header = lines[0].split(';').map((value) => value.trim())
  const dataLines = lines.slice(1)

  const records = dataLines.map((line) => {
    const parts = line.split(';').map((value) => value.trim())

    const row = {}
    header.forEach((columnName, index) => {
      row[columnName] = parts[index]
    })

    return row
  })

  return records
}

function normalizeHourlySolarRecord(record) {
  const globalHorizontal = Number(record.FG_LBERG)
  const diffuseHorizontal = Number(record.FD_LBERG)
  const timestamp = record.MESS_DATUM_WOZ || record.MESS_DATUM

  return {
    timestamp,
    globalHorizontal: globalHorizontal === -999 ? null : globalHorizontal,
    diffuseHorizontal: diffuseHorizontal === -999 ? null : diffuseHorizontal,
  }
}

function parseDwdTimestamp(timestamp) {
  const year = Number(timestamp.slice(0, 4))
  const month = Number(timestamp.slice(4, 6))
  const day = Number(timestamp.slice(6, 8))
  const hour = Number(timestamp.slice(8, 10))

  return { year, month, day, hour }
}



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

function aggregateTiltedMonthlyForYear(records, year, location, surfaceAzimuth, surfaceTilt) {
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

// Aggregate hourly global irradiation values into monthly sums.
function aggregateMonthlyIrradiation(records) {
  const monthlyMap = new Map()

  for (const record of records) {
    const rawDate = record.MESS_DATUM
    const rawValue = Number(record.FG_LBERG)

    if (!rawDate || Number.isNaN(rawValue) || rawValue === -999) {
      continue
    }

    // Convert each hourly record to a YYYYMM key and keep only data from 1990 until today.
    const yearMonth = rawDate.slice(0, 6)
    const currentYearMonth = new Date().toISOString().slice(0, 7).replace('-', '')
    
    if (yearMonth < '199001' || yearMonth > currentYearMonth) {
      continue
    }

    // Create a monthly accumulator when the month appears for the first time.
    if (!monthlyMap.has(yearMonth)) {
      monthlyMap.set(yearMonth, {
        sum: 0,
        count: 0,
      })
    }

    // Add the hourly value to the monthly sum.
    const monthEntry = monthlyMap.get(yearMonth)
    monthEntry.sum += rawValue
    monthEntry.count += 1
  }

  // Convert the monthly map into a sorted array and derive display-friendly fields.
  const monthlySeries = Array.from(monthlyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([yearMonth, values]) => ({
      yearMonth,
      year: yearMonth.slice(0, 4),
      month: yearMonth.slice(4, 6),
      label: `${yearMonth.slice(0, 4)}-${yearMonth.slice(4, 6)}`,
      irradiationJPerCm2: values.sum,
      irradiationKwhPerM2: values.sum / 360,
      valueCount: values.count,
    }))

  return monthlySeries
}

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

    // Keep the hourly records in memory for later tilted-plane calculations.
    latestHourlyRecords = parsedRecords
    console.log('Hourly records gespeichert:', latestHourlyRecords.length)
    const firstUsableRecord = getFirstUsableHourlyRecord(latestHourlyRecords)
    const parsedTimestamp = firstUsableRecord
      ? parseDwdTimestamp(firstUsableRecord.timestamp)
      : null
    const dayOfYear = parsedTimestamp
      ? getDayOfYear(parsedTimestamp.year, parsedTimestamp.month, parsedTimestamp.day)
      : null
    const sunPosition = parsedTimestamp
      ? getSunPosition({
          longitude: latestSelectedLocation.lon,
          latitude: latestSelectedLocation.lat,
          dayOfYear,
          timeZone: 1,
          localTime: parsedTimestamp.hour,
        })
      : null
    const tiltedIrradiance = firstUsableRecord && sunPosition
      ? getTiltedGlobalIrradiance({
          globalHorizontal: firstUsableRecord.globalHorizontal,
          diffuseHorizontal: firstUsableRecord.diffuseHorizontal,
          surfaceAzimuth: Number(azimuthSliderEl.value),
          surfaceTilt: Number(tiltSliderEl.value),
          sunAzimuth: sunPosition.sunAzimuth,
          sunElevation: sunPosition.sunElevation,
          albedo: 0.2,
        })
      : null
    const selectedComparisonYear = latestMonthlySeries.length > 0
      ? Number(yearSelectEl.value || latestMonthlySeries[latestMonthlySeries.length - 1].year)
      : new Date().getFullYear()

    latestTiltedMonthlySeries = aggregateTiltedMonthlyForYear(
      parsedRecords,
      selectedComparisonYear,
      latestSelectedLocation,
      Number(azimuthSliderEl.value),
      Number(tiltSliderEl.value)
    )
    console.log('Aktueller Berechnungsstandort:', latestSelectedLocation)
    console.log('Erster brauchbarer stündlicher Datensatz:', firstUsableRecord)
    console.log('Geparster Zeitstempel:', parsedTimestamp)
    console.log('DOY:', dayOfYear)
    console.log('Sun position:', sunPosition)
    console.log('Tilted irradiance preview:', tiltedIrradiance)
    console.log('Tilted Monatswerte Vorschau:', latestTiltedMonthlySeries)
    const monthlySeries = aggregateMonthlyIrradiation(parsedRecords)
    updateChartWithMonthlySeries(monthlySeries, stationName)
    updateYieldEstimation()
  } catch (error) {
    console.error('Fehler beim Laden der DWD-ZIP-Datei:', error)
  }
}

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

// Redraw the chart when the selected end year changes.
yearSelectEl.addEventListener('change', () => {
  if (latestMonthlySeries.length > 0) {
    updateChartWithMonthlySeries(latestMonthlySeries, latestStationName)
  }
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

azimuthSliderEl.addEventListener('input', () => {
  if (latestHourlyRecords.length > 0) {
    const selectedComparisonYear = latestMonthlySeries.length > 0
      ? Number(yearSelectEl.value || latestMonthlySeries[latestMonthlySeries.length - 1].year)
      : new Date().getFullYear()

    latestTiltedMonthlySeries = aggregateTiltedMonthlyForYear(
      latestHourlyRecords,
      selectedComparisonYear,
      latestSelectedLocation,
      Number(azimuthSliderEl.value),
      Number(tiltSliderEl.value)
    )
  }

  updateYieldEstimation()
})

tiltSliderEl.addEventListener('input', () => {
  if (latestHourlyRecords.length > 0) {
    const selectedComparisonYear = latestMonthlySeries.length > 0
      ? Number(yearSelectEl.value || latestMonthlySeries[latestMonthlySeries.length - 1].year)
      : new Date().getFullYear()

    latestTiltedMonthlySeries = aggregateTiltedMonthlyForYear(
      latestHourlyRecords,
      selectedComparisonYear,
      latestSelectedLocation,
      Number(azimuthSliderEl.value),
      Number(tiltSliderEl.value)
    )
  }

  updateYieldEstimation()
})

updateYieldEstimation()
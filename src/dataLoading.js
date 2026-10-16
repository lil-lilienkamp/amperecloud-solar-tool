// Fetches DWD station metadata and hourly product ZIPs, and turns them into
// the compact, normalized record arrays the rest of the app works with.

import { unzip, strFromU8 } from 'fflate'
import { buildDwdSolarZipUrl, parseDwdSolarProduct, normalizeAndParseHourlyRecords } from './dwdUtils'

// The dev/preview server proxies /dwd -> https://opendata.dwd.de (see
// vite.config.js) because opendata.dwd.de does not send
// Access-Control-Allow-Origin, so the browser cannot fetch it directly in
// production. A real deployment must run its own reverse proxy (or a small
// serverless function) forwarding requests the same way, and point
// VITE_DWD_BASE_URL at it - see README.md "Deployment".
export const DWD_BASE_URL = import.meta.env.VITE_DWD_BASE_URL ?? '/dwd'

const STATION_METADATA_URL = `${DWD_BASE_URL}/climate_environment/CDC/observations_germany/climate/hourly/solar/ST_Stundenwerte_Beschreibung_Stationen.txt`

// The station metadata file has no explicit charset in its HTTP headers,
// but is actually encoded as ISO-8859-1 (Latin-1) - `response.text()` would
// assume UTF-8 and mangle every umlaut/ß in station and Bundesland names.
async function decodeLatin1Response(response) {
  const buffer = await response.arrayBuffer()
  return new TextDecoder('iso-8859-1').decode(buffer)
}

// A station counts as "active" if its data coverage reaches into roughly
// the last two months - i.e. it is still being maintained. We prefer these
// when picking the nearest station so we don't route users to a station
// that stopped reporting years ago.
function isStationActive(bisDatum, now = new Date()) {
  if (!/^\d{8}$/.test(bisDatum)) return false
  const cutoff = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)
  const cutoffKey = `${cutoff.getUTCFullYear()}${String(cutoff.getUTCMonth() + 1).padStart(2, '0')}${String(cutoff.getUTCDate()).padStart(2, '0')}`
  return bisDatum >= cutoffKey
}

// Parses ST_Stundenwerte_Beschreibung_Stationen.txt. Columns are
// whitespace-separated and right-padded to a fixed width; station names
// can contain spaces but German Bundesland names never do, so splitting on
// whitespace and taking the last token as the state, everything between
// column 6 and the state as the name, is reliable.
export function parseStationMetadata(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  // Line 0 is the header, line 1 is a "---- ----" separator row.
  return lines
    .slice(2)
    .map((line) => {
      const parts = line.split(/\s+/)
      const stationId = parts[0]
      const fromDate = parts[1]
      const toDate = parts[2]
      const height = Number(parts[3])
      const lat = Number(parts[4])
      const lon = Number(parts[5])
      const name = parts.slice(6, -1).join(' ')
      const state = parts.at(-1)

      return {
        stationId,
        fromDate,
        toDate,
        height,
        lat,
        lon,
        name,
        state,
        active: isStationActive(toDate),
      }
    })
    .filter((s) => s.stationId && Number.isFinite(s.lat) && Number.isFinite(s.lon))
}

export async function fetchStationMetadata({ signal } = {}) {
  const response = await fetch(STATION_METADATA_URL, { signal })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const text = await decodeLatin1Response(response)
  return parseStationMetadata(text)
}

function unzipAsync(buffer) {
  return new Promise((resolve, reject) => {
    unzip(buffer, (err, unzipped) => {
      if (err) reject(err)
      else resolve(unzipped)
    })
  })
}

// Downloads and parses one station's hourly product ZIP, returning the
// compact normalized+parsed record array (see normalizeAndParseHourlyRecords)
// ready for aggregation - the raw text/rows are not retained.
export async function fetchStationHourlyRecords(stationId, { signal } = {}) {
  const response = await fetch(buildDwdSolarZipUrl(stationId, DWD_BASE_URL), { signal })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)

  const buffer = new Uint8Array(await response.arrayBuffer())
  const unzipped = await unzipAsync(buffer)
  const productFileName = Object.keys(unzipped).find(
    (name) => name.startsWith('produkt_st_stunde_') && name.endsWith('.txt'),
  )
  if (!productFileName) throw new Error('Keine Produktdatei im ZIP')

  const productText = strFromU8(unzipped[productFileName])
  const rawRecords = parseDwdSolarProduct(productText)
  return normalizeAndParseHourlyRecords(rawRecords)
}

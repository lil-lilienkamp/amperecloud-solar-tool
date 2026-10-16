// Parsing and aggregation helpers for DWD CDC hourly solar "produkt" files.

// 1 kWh/m² = 360 J/cm², so to convert J/cm² sums to kWh/m² multiply by this.
export const J_PER_CM2_TO_KWH_PER_M2 = 1 / 360

// DWD marks missing numeric values with -999.
export const DWD_MISSING_VALUE = -999

export function buildDwdSolarZipUrl(stationId, baseUrl) {
  const paddedStationId = stationId.toString().padStart(5, '0')
  return `${baseUrl}/climate_environment/CDC/observations_germany/climate/hourly/solar/stundenwerte_ST_${paddedStationId}_row.zip`
}

export function parseDwdSolarProduct(productText) {
  const lines = productText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines.length === 0) return []

  const header = lines[0].split(';').map((value) => value.trim())
  const dataLines = lines.slice(1)

  return dataLines.map((line) => {
    const parts = line.split(';').map((value) => value.trim())
    const row = {}
    header.forEach((columnName, index) => {
      row[columnName] = parts[index]
    })
    return row
  })
}

// Normalizes one raw DWD product row into the values needed for solar-yield
// calculations, and records which time base its timestamp uses.
//
// DWD provides two timestamps per hourly sum, both marking the END of the
// hourly interval (see the official dataset description: MESS_DATUM is the
// "reference date" in UTC, and ZENIT is documented as "solar zenith angle
// at mid of interval" - confirming the stamp itself is the interval end):
//   - MESS_DATUM_WOZ: "local true solar time" ("wahre Ortszeit"). This is
//     already apparent solar time - longitude correction and equation of
//     time are already baked in, so it must be used directly as solar time.
//   - MESS_DATUM: plain UTC.
// We prefer WOZ (present from 1991 onward) and fall back to UTC for older
// records where it is missing.
export function normalizeHourlySolarRecord(record) {
  const globalHorizontal = Number(record.FG_LBERG)
  const diffuseHorizontal = Number(record.FD_LBERG)
  const hasWoz = typeof record.MESS_DATUM_WOZ === 'string' && record.MESS_DATUM_WOZ.length >= 10
  const timestamp = hasWoz ? record.MESS_DATUM_WOZ : record.MESS_DATUM
  const timeBasis = hasWoz ? 'woz' : 'utc'

  return {
    timestamp,
    timeBasis,
    globalHorizontal: globalHorizontal === DWD_MISSING_VALUE ? null : globalHorizontal,
    diffuseHorizontal: diffuseHorizontal === DWD_MISSING_VALUE ? null : diffuseHorizontal,
  }
}

// Parses a DWD timestamp of the form "YYYYMMDDHH:mm" (or "YYYYMMDDHH" - the
// minutes suffix, if present, is ignored either way; only the hour is used).
export function parseDwdTimestamp(timestamp) {
  const year = Number(timestamp.slice(0, 4))
  const month = Number(timestamp.slice(4, 6))
  const day = Number(timestamp.slice(6, 8))
  const hour = Number(timestamp.slice(8, 10))

  return { year, month, day, hour }
}

// Normalizes and parses every raw row exactly once into a compact array of
// plain objects, discarding the (much larger) raw string rows. Downstream
// consumers (monthly aggregation, tilted-irradiance calculation) all read
// from this single array instead of re-parsing on every slider change.
export function normalizeAndParseHourlyRecords(rawRecords) {
  const result = []
  for (const rawRecord of rawRecords) {
    const normalized = normalizeHourlySolarRecord(rawRecord)
    if (!normalized.timestamp || normalized.timestamp.length < 10) continue

    const { year, month, day, hour } = parseDwdTimestamp(normalized.timestamp)
    if (!year || !month || !day) continue

    result.push({
      year,
      month,
      day,
      hour,
      timeBasis: normalized.timeBasis,
      globalHorizontal: normalized.globalHorizontal,
      diffuseHorizontal: normalized.diffuseHorizontal,
    })
  }
  return result
}

function getDaysInMonth(year, month) {
  // Day 0 of the following month = last day of this month (UTC, DST-safe).
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

// A month counts as "complete" once it has data for (almost) every hour.
// A small tolerance accounts for legitimate short outages/QC gaps without
// flagging every month as incomplete.
const MONTH_COMPLETENESS_THRESHOLD = 0.95

// Aggregates monthly global irradiation from the compact, normalized+parsed
// record array (see normalizeAndParseHourlyRecords). Each month is flagged
// `complete` so the current (in-progress) month/year, or a month with a
// large data gap, can be excluded from average/best-year KPIs and flagged
// in the UI instead of silently distorting them.
export function aggregateMonthlyIrradiation(normalizedRecords, { now = new Date() } = {}) {
  const monthlyMap = new Map()
  const currentYear = now.getUTCFullYear()
  const currentMonth = now.getUTCMonth() + 1

  for (const record of normalizedRecords) {
    if (record.globalHorizontal === null) continue
    if (record.year < 1990 || record.year > currentYear) continue

    const yearMonth = `${record.year}${String(record.month).padStart(2, '0')}`
    if (!monthlyMap.has(yearMonth)) {
      monthlyMap.set(yearMonth, { sum: 0, count: 0 })
    }
    const monthEntry = monthlyMap.get(yearMonth)
    monthEntry.sum += record.globalHorizontal
    monthEntry.count += 1
  }

  return Array.from(monthlyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([yearMonth, values]) => {
      const year = yearMonth.slice(0, 4)
      const month = yearMonth.slice(4, 6)
      const expectedValueCount = getDaysInMonth(Number(year), Number(month)) * 24
      const isCurrentMonth = Number(year) === currentYear && Number(month) === currentMonth
      const complete = !isCurrentMonth && values.count >= expectedValueCount * MONTH_COMPLETENESS_THRESHOLD

      return {
        yearMonth,
        year,
        month,
        label: `${year}-${month}`,
        irradiationJPerCm2: values.sum,
        irradiationKwhPerM2: values.sum * J_PER_CM2_TO_KWH_PER_M2,
        valueCount: values.count,
        expectedValueCount,
        complete,
      }
    })
}

// A year is "complete" only if it has all 12 months present and each of
// them individually complete. Incomplete years (the current year in
// progress, or a year with data gaps) are excluded from average/best-year
// KPIs so a partial year cannot distort them, but they still show up in
// the chart and can be flagged in the UI.
export function getCompleteYears(monthlySeries) {
  const byYear = new Map()
  for (const entry of monthlySeries) {
    if (!byYear.has(entry.year)) byYear.set(entry.year, [])
    byYear.get(entry.year).push(entry)
  }

  const completeYears = new Set()
  for (const [year, entries] of byYear) {
    if (entries.length === 12 && entries.every((e) => e.complete)) {
      completeYears.add(year)
    }
  }
  return completeYears
}

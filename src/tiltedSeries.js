// Turns the compact hourly record array into a tilted-plane monthly series,
// caching the (comparatively expensive) sun-position calculation so that
// moving the azimuth/tilt sliders only has to redo the cheap
// tilted-irradiance projection, not the full solar-geometry computation.

import { getDayOfYear, getNumberOfDaysInYear, getSunPosition, getTiltedGlobalIrradiance } from './solarMath'
import { J_PER_CM2_TO_KWH_PER_M2 } from './dwdUtils'
import { MONTH_KEYS } from './constants'

// Sun position only depends on (location, day, hour) - never on the panel's
// azimuth/tilt - so it is computed once per record here and reused for
// every slider position. Records where the sun is below the horizon, or
// where global/diffuse irradiance is missing, are dropped up front.
export function computeSunEnrichedRecords(records, location) {
  const numberOfDaysInYearByYear = new Map()
  const dayOfYearByDate = new Map()
  const result = []

  for (const record of records) {
    if (record.globalHorizontal === null || record.diffuseHorizontal === null) continue

    let numberOfDaysInYear = numberOfDaysInYearByYear.get(record.year)
    if (numberOfDaysInYear === undefined) {
      numberOfDaysInYear = getNumberOfDaysInYear(record.year)
      numberOfDaysInYearByYear.set(record.year, numberOfDaysInYear)
    }

    const dateKey = record.year * 10000 + record.month * 100 + record.day
    let dayOfYear = dayOfYearByDate.get(dateKey)
    if (dayOfYear === undefined) {
      dayOfYear = getDayOfYear(record.year, record.month, record.day)
      dayOfYearByDate.set(dateKey, dayOfYear)
    }

    // The DWD timestamp marks the END of the hourly interval; use its
    // midpoint (hour - 0.5) as the representative time for the sum.
    const sunPosition = getSunPosition({
      longitude: location.lon,
      latitude: location.lat,
      dayOfYear,
      localTime: record.hour - 0.5,
      timeBasis: record.timeBasis,
      numberOfDaysInYear,
    })

    if (sunPosition.sunElevation <= 0) continue

    result.push({
      year: record.year,
      month: record.month,
      globalHorizontal: record.globalHorizontal,
      diffuseHorizontal: record.diffuseHorizontal,
      sunAzimuth: sunPosition.sunAzimuth,
      sunElevation: sunPosition.sunElevation,
    })
  }

  return result
}

// Cheap: no trigonometric solar-position calculation left to do, just the
// tilted-irradiance projection and a per-month sum. Safe to call on every
// slider `input` event.
export function aggregateTiltedMonthlyForYear(sunEnrichedRecords, year, surfaceAzimuth, surfaceTilt) {
  const monthlySums = new Map()

  for (const record of sunEnrichedRecords) {
    if (record.year !== year) continue

    const { globalTilted } = getTiltedGlobalIrradiance({
      globalHorizontal: record.globalHorizontal,
      diffuseHorizontal: record.diffuseHorizontal,
      surfaceAzimuth,
      surfaceTilt,
      sunAzimuth: record.sunAzimuth,
      sunElevation: record.sunElevation,
      albedo: 0.2,
    })

    const monthKey = String(record.month).padStart(2, '0')
    monthlySums.set(monthKey, (monthlySums.get(monthKey) ?? 0) + globalTilted)
  }

  return MONTH_KEYS.map((month) => ({
    year: String(year),
    month,
    irradiationJPerCm2: monthlySums.get(month) ?? 0,
    irradiationKwhPerM2: (monthlySums.get(month) ?? 0) * J_PER_CM2_TO_KWH_PER_M2,
  }))
}

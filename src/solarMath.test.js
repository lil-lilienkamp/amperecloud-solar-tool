import { describe, it, expect } from 'vitest'
import {
  getDayOfYear,
  getNumberOfDaysInYear,
  getSunPosition,
  getTiltedGlobalIrradiance,
  getTiltedDirectIrradiance,
  MIN_ELEVATION_FOR_DIRECT_TRANSPOSITION_DEG,
} from './solarMath'

describe('getDayOfYear', () => {
  it('counts sequentially and is not affected by the CET->CEST DST switch', () => {
    // 2023: DST started 2023-03-26. If getDayOfYear used local-time Date
    // diffs, the day *after* the switch could come out on the wrong side
    // of a whole-day boundary because of the missing/extra local hour.
    const beforeSwitch = getDayOfYear(2023, 3, 25)
    const switchDay = getDayOfYear(2023, 3, 26)
    const afterSwitch = getDayOfYear(2023, 3, 27)
    expect(switchDay).toBe(beforeSwitch + 1)
    expect(afterSwitch).toBe(switchDay + 1)
  })

  it('is not affected by the CEST->CET switch either', () => {
    // 2023: DST ended 2023-10-29.
    const beforeSwitch = getDayOfYear(2023, 10, 28)
    const switchDay = getDayOfYear(2023, 10, 29)
    const afterSwitch = getDayOfYear(2023, 10, 30)
    expect(switchDay).toBe(beforeSwitch + 1)
    expect(afterSwitch).toBe(switchDay + 1)
  })

  it('returns 1 for January 1st and the correct length for December 31st', () => {
    expect(getDayOfYear(2023, 1, 1)).toBe(1)
    expect(getDayOfYear(2023, 12, 31)).toBe(365)
    expect(getDayOfYear(2024, 12, 31)).toBe(366) // 2024 is a leap year
  })
})

describe('getNumberOfDaysInYear', () => {
  it('identifies leap years correctly', () => {
    expect(getNumberOfDaysInYear(2024)).toBe(366)
    expect(getNumberOfDaysInYear(2023)).toBe(365)
    expect(getNumberOfDaysInYear(2000)).toBe(366) // divisible by 400
    expect(getNumberOfDaysInYear(1900)).toBe(365) // divisible by 100, not 400
  })
})

describe('getSunPosition at solar noon (WOZ)', () => {
  it('matches the expected elevation for Berlin at the equinox (90 - latitude)', () => {
    const berlinLatitude = 52.5
    // Spring equinox 2023 was March 20. Declination is ~0 there, so solar
    // noon elevation should be close to 90 - latitude (= 37.5°).
    const dayOfYear = getDayOfYear(2023, 3, 20)
    const position = getSunPosition({
      longitude: 13.4,
      latitude: berlinLatitude,
      dayOfYear,
      localTime: 12, // true solar noon, WOZ time basis (the default)
      numberOfDaysInYear: getNumberOfDaysInYear(2023),
    })

    expect(position.sunElevation).toBeGreaterThan(90 - berlinLatitude - 1)
    expect(position.sunElevation).toBeLessThan(90 - berlinLatitude + 1)
  })

  it('does not re-apply timezone/equation-of-time corrections for WOZ input', () => {
    // With timeBasis 'woz' (the default), localTime IS the true solar
    // time already - the sun should sit due south (azimuth 180) at
    // localTime 12, regardless of longitude or time of year.
    const position = getSunPosition({
      longitude: 6.96, // far west of the CET reference meridian (15°E)
      latitude: 51.4,
      dayOfYear: getDayOfYear(2023, 6, 21),
      localTime: 12,
      numberOfDaysInYear: getNumberOfDaysInYear(2023),
    })
    expect(position.sunAzimuth).toBeCloseTo(180, 0)
  })

  it('applies longitude + equation of time for UTC input', () => {
    // At UTC input, true solar noon (azimuth 180) happens close to, but
    // not exactly at, clock time 12 - it depends on longitude.
    const dayOfYear = getDayOfYear(2023, 6, 21)
    const numberOfDaysInYear = getNumberOfDaysInYear(2023)
    const atUtcNoon = getSunPosition({
      longitude: 13.06, // Potsdam
      latitude: 52.38,
      dayOfYear,
      localTime: 12,
      timeBasis: 'utc',
      numberOfDaysInYear,
    })
    // Potsdam is ~13°E, so true solar noon is a bit before 12:00 UTC -
    // at 12:00 UTC the sun has already passed south, i.e. azimuth > 180.
    expect(atUtcNoon.sunAzimuth).toBeGreaterThan(180)
  })
})

describe('getTiltedDirectIrradiance near-horizon guard', () => {
  it('returns 0 at/below the minimum elevation threshold instead of blowing up', () => {
    expect(getTiltedDirectIrradiance(500, 10, MIN_ELEVATION_FOR_DIRECT_TRANSPOSITION_DEG)).toBe(0)
    expect(getTiltedDirectIrradiance(500, 10, 0.5)).toBe(0)
  })

  it('is well-behaved above the threshold', () => {
    const result = getTiltedDirectIrradiance(500, 10, 45)
    expect(result).toBeGreaterThan(0)
    expect(Number.isFinite(result)).toBe(true)
  })
})

describe('getTiltedGlobalIrradiance at tilt 0', () => {
  it('equals the horizontal irradiance (tilted == horizontal when flat)', () => {
    const globalHorizontal = 250
    const diffuseHorizontal = 90
    const { globalTilted } = getTiltedGlobalIrradiance({
      globalHorizontal,
      diffuseHorizontal,
      surfaceAzimuth: 180,
      surfaceTilt: 0,
      sunAzimuth: 160,
      sunElevation: 45,
      albedo: 0.2,
    })
    expect(globalTilted).toBeCloseTo(globalHorizontal, 6)
  })
})

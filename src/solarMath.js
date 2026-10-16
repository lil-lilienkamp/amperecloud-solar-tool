// Solar geometry and simple tilted-plane helper functions.
// All angles are handled in degrees at the public API boundary.

export function degToRad(degrees) {
  return (degrees * Math.PI) / 180
}

export function radToDeg(radians) {
  return (radians * 180) / Math.PI
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

export function getNumberOfDaysInYear(year) {
  // Date.UTC avoids any local-timezone/DST ambiguity around Feb 29.
  const isLeapYear = new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1
  return isLeapYear ? 366 : 365
}

// Day-of-year, computed with Date.UTC so the result never shifts by an hour
// (and therefore never rounds to the wrong day) across a DST transition.
// Using local-time `new Date(year, month - 1, day)` previously produced a
// diffMs that was off by ±3 600 000 ms right after the CET/CEST switch,
// which `Math.floor(diffMs / dayMs)` could round down to the wrong day.
export function getDayOfYear(year, month, day) {
  const startOfYearUtc = Date.UTC(year, 0, 1)
  const currentDateUtc = Date.UTC(year, month - 1, day)
  const diffMs = currentDateUtc - startOfYearUtc

  return Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1
}

export function getDayAngle(dayOfYear, numberOfDaysInYear = 365) {
  return (360 * dayOfYear) / numberOfDaysInYear
}

export function getDeclination(dayAngleDeg) {
  return (
    0.3948 -
    23.2559 * Math.cos(degToRad(dayAngleDeg + 9.1)) -
    0.3915 * Math.cos(degToRad(2 * dayAngleDeg + 5.4)) -
    0.1764 * Math.cos(degToRad(3 * dayAngleDeg + 26.0))
  )
}

// Equation of time in minutes (apparent minus mean solar time).
export function getTimeEquation(dayAngleDeg) {
  return (
    0.0066 +
    7.3525 * Math.cos(degToRad(dayAngleDeg + 85.9)) +
    9.9359 * Math.cos(degToRad(2 * dayAngleDeg + 108.9)) +
    0.3387 * Math.cos(degToRad(3 * dayAngleDeg + 105.2))
  )
}

// True (apparent) solar time from UTC clock time: UTC has offset 0 by
// definition, so only the longitude correction (4 min per degree) and the
// equation of time turn it into true solar time. No civil timezone
// (CET/CEST) is involved here.
export function getTrueSolarTimeFromUtc(utcHour, longitudeDeg, timeEquationMinutes) {
  return utcHour + (4 * longitudeDeg) / 60 + timeEquationMinutes / 60
}

export function getHourAngle(trueSolarTime) {
  return (12 - trueSolarTime) * 15
}

export function getSunElevation(hourAngleDeg, latitudeDeg, declinationDeg) {
  const value =
    Math.cos(degToRad(hourAngleDeg)) * Math.cos(degToRad(latitudeDeg)) * Math.cos(degToRad(declinationDeg)) +
    Math.sin(degToRad(latitudeDeg)) * Math.sin(degToRad(declinationDeg))

  return radToDeg(Math.asin(clamp(value, -1, 1)))
}

export function getSunAzimuth(sunElevationDeg, latitudeDeg, declinationDeg, trueSolarTime) {
  const acosArgument =
    (Math.sin(degToRad(sunElevationDeg)) * Math.sin(degToRad(latitudeDeg)) -
      Math.sin(degToRad(declinationDeg))) /
    (Math.cos(degToRad(sunElevationDeg)) * Math.cos(degToRad(latitudeDeg)))

  const clampedArgument = clamp(acosArgument, -1, 1)
  const azimuthBase = radToDeg(Math.acos(clampedArgument))

  if (trueSolarTime <= 12) {
    return 180 - azimuthBase
  }

  return 180 + azimuthBase
}

// Computes the sun's position for a given day and local time.
//
// DWD hourly solar data comes with two possible time bases:
//  - `timeBasis: 'woz'` (default): `localTime` is already MESS_DATUM_WOZ,
//    the station's "wahre Ortszeit" (true/apparent solar time). It already
//    includes the longitude correction and the equation of time, so the
//    hour angle is derived directly from it - applying either correction
//    again would double-count them and skew results by tens of minutes.
//  - `timeBasis: 'utc'`: `localTime` is MESS_DATUM, plain UTC. True solar
//    time is derived via longitude + equation of time (timezone is 0,
//    since UTC has no offset).
export function getSunPosition({
  longitude,
  latitude,
  dayOfYear,
  localTime,
  timeBasis = 'woz',
  numberOfDaysInYear = 365,
}) {
  const dayAngle = getDayAngle(dayOfYear, numberOfDaysInYear)
  const declination = getDeclination(dayAngle)
  const timeEquation = getTimeEquation(dayAngle)

  const trueSolarTime =
    timeBasis === 'utc' ? getTrueSolarTimeFromUtc(localTime, longitude, timeEquation) : localTime

  const hourAngle = getHourAngle(trueSolarTime)
  const sunElevation = getSunElevation(hourAngle, latitude, declination)
  const sunAzimuth = getSunAzimuth(sunElevation, latitude, declination, trueSolarTime)
  const airMass = sunElevation > 0 ? 1 / Math.sin(degToRad(sunElevation)) : null

  return {
    dayAngle,
    declination,
    timeEquation,
    trueSolarTime,
    hourAngle,
    sunElevation,
    sunAzimuth,
    airMass,
  }
}

// Surface normal in the same (x=east, y=north, z=up) frame as
// getSunbeamVector. surfaceTiltDeg is measured from horizontal (0 = flat
// panel facing straight up, 90 = vertical wall), so the normal's vertical
// component must be cos(tilt) (1 at tilt 0, 0 at tilt 90) and its
// horizontal component sin(tilt) - i.e. the *opposite* trig assignment
// from getSunbeamVector, where elevation is measured from the horizon
// instead of from the vertical. Swapping these (as the previous version of
// this function did) makes a flat panel's normal point sideways instead of
// straight up, and was verified via the standard incidence-angle identity
// cosθ = cos(tilt)·cosθz + sin(tilt)·sinθz·cos(Δazimuth): only this
// assignment reduces to it.
export function getSurfaceNormalVector(surfaceAzimuthDeg, surfaceTiltDeg) {
  return {
    x: Math.sin(degToRad(surfaceTiltDeg)) * Math.sin(degToRad(surfaceAzimuthDeg)),
    y: Math.sin(degToRad(surfaceTiltDeg)) * Math.cos(degToRad(surfaceAzimuthDeg)),
    z: Math.cos(degToRad(surfaceTiltDeg)),
  }
}

export function getSunbeamVector(sunAzimuthDeg, sunElevationDeg) {
  return {
    x: Math.cos(degToRad(sunElevationDeg)) * Math.sin(degToRad(sunAzimuthDeg)),
    y: Math.cos(degToRad(sunElevationDeg)) * Math.cos(degToRad(sunAzimuthDeg)),
    z: Math.sin(degToRad(sunElevationDeg)),
  }
}

export function dotProduct(vectorA, vectorB) {
  return vectorA.x * vectorB.x + vectorA.y * vectorB.y + vectorA.z * vectorB.z
}

export function getIncidenceAngle(surfaceAzimuthDeg, surfaceTiltDeg, sunAzimuthDeg, sunElevationDeg) {
  const surfaceNormal = getSurfaceNormalVector(surfaceAzimuthDeg, surfaceTiltDeg)
  const sunbeamVector = getSunbeamVector(sunAzimuthDeg, sunElevationDeg)
  const dot = clamp(dotProduct(surfaceNormal, sunbeamVector), -1, 1)

  return radToDeg(Math.acos(dot))
}

export function getDirectHorizontalIrradiance(globalHorizontal, diffuseHorizontal) {
  const directHorizontal = globalHorizontal - diffuseHorizontal
  return Math.max(0, directHorizontal)
}

// Below this elevation the 1/sin(elevation) transposition factor explodes
// towards infinity and is dominated by refraction, horizon-shading and
// hour-averaging effects that a simple isotropic-sky model cannot capture
// correctly. We treat the direct-beam contribution as unreliable/negligible
// below this threshold rather than let it blow up the tilted total; the
// diffuse and reflected components (which stay well-behaved) are unaffected.
export const MIN_ELEVATION_FOR_DIRECT_TRANSPOSITION_DEG = 3

export function getTiltedDirectIrradiance(directHorizontal, incidenceAngleDeg, sunElevationDeg) {
  if (sunElevationDeg <= MIN_ELEVATION_FOR_DIRECT_TRANSPOSITION_DEG) {
    return 0
  }

  const result =
    directHorizontal * (Math.cos(degToRad(incidenceAngleDeg)) / Math.sin(degToRad(sunElevationDeg)))

  return Math.max(0, result)
}

export function getTiltedDiffuseIrradianceIsotropic(diffuseHorizontal, surfaceTiltDeg) {
  return diffuseHorizontal * ((1 + Math.cos(degToRad(surfaceTiltDeg))) / 2)
}

export function getTiltedReflectedIrradiance(globalHorizontal, surfaceTiltDeg, albedo = 0.2) {
  return globalHorizontal * albedo * ((1 - Math.cos(degToRad(surfaceTiltDeg))) / 2)
}

export function getTiltedGlobalIrradiance({
  globalHorizontal,
  diffuseHorizontal,
  surfaceAzimuth,
  surfaceTilt,
  sunAzimuth,
  sunElevation,
  albedo = 0.2,
}) {
  const directHorizontal = getDirectHorizontalIrradiance(globalHorizontal, diffuseHorizontal)
  const incidenceAngle = getIncidenceAngle(surfaceAzimuth, surfaceTilt, sunAzimuth, sunElevation)
  const directTilted = getTiltedDirectIrradiance(directHorizontal, incidenceAngle, sunElevation)
  const diffuseTilted = getTiltedDiffuseIrradianceIsotropic(diffuseHorizontal, surfaceTilt)
  const reflectedTilted = getTiltedReflectedIrradiance(globalHorizontal, surfaceTilt, albedo)

  return {
    incidenceAngle,
    directHorizontal,
    directTilted,
    diffuseTilted,
    reflectedTilted,
    globalTilted: directTilted + diffuseTilted + reflectedTilted,
  }
}

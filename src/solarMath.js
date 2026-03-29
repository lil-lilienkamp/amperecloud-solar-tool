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
  const isLeapYear = new Date(year, 1, 29).getMonth() === 1
  return isLeapYear ? 366 : 365
}

export function getDayOfYear(year, month, day) {
  const startOfYear = new Date(year, 0, 1)
  const currentDate = new Date(year, month - 1, day)
  const diffMs = currentDate - startOfYear

  return Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1
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

export function getTimeEquation(dayAngleDeg) {
  return (
    0.0066 +
    7.3525 * Math.cos(degToRad(dayAngleDeg + 85.9)) +
    9.9359 * Math.cos(degToRad(2 * dayAngleDeg + 108.9)) +
    0.3387 * Math.cos(degToRad(3 * dayAngleDeg + 105.2))
  )
}

export function getMeanLocalTime(localTime, timeZone, longitude) {
  return localTime - timeZone + (4 * longitude) / 60
}

export function getTrueLocalTime(meanLocalTime, timeEquationMinutes) {
  return meanLocalTime + timeEquationMinutes / 60
}

export function getHourAngle(trueLocalTime) {
  return (12 - trueLocalTime) * 15
}

export function getSunElevation(hourAngleDeg, latitudeDeg, declinationDeg) {
  const value =
    Math.cos(degToRad(hourAngleDeg)) *
      Math.cos(degToRad(latitudeDeg)) *
      Math.cos(degToRad(declinationDeg)) +
    Math.sin(degToRad(latitudeDeg)) * Math.sin(degToRad(declinationDeg))

  return radToDeg(Math.asin(clamp(value, -1, 1)))
}

export function getSunAzimuth(sunElevationDeg, latitudeDeg, declinationDeg, trueLocalTime) {
  const acosArgument =
    (Math.sin(degToRad(sunElevationDeg)) * Math.sin(degToRad(latitudeDeg)) -
      Math.sin(degToRad(declinationDeg))) /
    (Math.cos(degToRad(sunElevationDeg)) * Math.cos(degToRad(latitudeDeg)))

  const clampedArgument = clamp(acosArgument, -1, 1)
  const azimuthBase = radToDeg(Math.acos(clampedArgument))

  if (trueLocalTime <= 12) {
    return 180 - azimuthBase
  }

  return 180 + azimuthBase
}

export function getSunPosition({
  longitude,
  latitude,
  dayOfYear,
  timeZone,
  localTime,
  numberOfDaysInYear = 365,
}) {
  const dayAngle = getDayAngle(dayOfYear, numberOfDaysInYear)
  const declination = getDeclination(dayAngle)
  const timeEquation = getTimeEquation(dayAngle)
  const meanLocalTime = getMeanLocalTime(localTime, timeZone, longitude)
  const trueLocalTime = getTrueLocalTime(meanLocalTime, timeEquation)
  const hourAngle = getHourAngle(trueLocalTime)
  const sunElevation = getSunElevation(hourAngle, latitude, declination)
  const sunAzimuth = getSunAzimuth(sunElevation, latitude, declination, trueLocalTime)
  const airMass = sunElevation > 0 ? 1 / Math.sin(degToRad(sunElevation)) : null

  return {
    dayAngle,
    declination,
    timeEquation,
    meanLocalTime,
    trueLocalTime,
    hourAngle,
    sunElevation,
    sunAzimuth,
    airMass,
  }
}

export function getSurfaceNormalVector(surfaceAzimuthDeg, surfaceTiltDeg) {
  return {
    x: Math.cos(degToRad(surfaceTiltDeg)) * Math.sin(degToRad(surfaceAzimuthDeg)),
    y: Math.cos(degToRad(surfaceTiltDeg)) * Math.cos(degToRad(surfaceAzimuthDeg)),
    z: Math.sin(degToRad(surfaceTiltDeg)),
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

export function getTiltedDirectIrradiance(directHorizontal, incidenceAngleDeg, sunElevationDeg) {
  if (sunElevationDeg <= 0) {
    return 0
  }

  const result =
    directHorizontal *
    (Math.cos(degToRad(incidenceAngleDeg)) / Math.sin(degToRad(sunElevationDeg)))

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
  const incidenceAngle = getIncidenceAngle(
    surfaceAzimuth,
    surfaceTilt,
    sunAzimuth,
    sunElevation
  )
  const directTilted = getTiltedDirectIrradiance(
    directHorizontal,
    incidenceAngle,
    sunElevation
  )
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
// 1 kWh/m² = 360 J/cm², so to convert J/cm² sums to kWh/m² multiply by this.
export const J_PER_CM2_TO_KWH_PER_M2 = 1 / 360

export function buildDwdSolarZipUrl(stationId) {
    const paddedStationId = stationId.toString().padStart(5, '0')
  
    return `/dwd/climate_environment/CDC/observations_germany/climate/hourly/solar/stundenwerte_ST_${paddedStationId}_row.zip`
  }
  
  export function parseDwdSolarProduct(productText) {
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
  
  export function normalizeHourlySolarRecord(record) {
    const globalHorizontal = Number(record.FG_LBERG)
    const diffuseHorizontal = Number(record.FD_LBERG)
    const timestamp = record.MESS_DATUM_WOZ || record.MESS_DATUM
  
    return {
      timestamp,
      globalHorizontal: globalHorizontal === -999 ? null : globalHorizontal,
      diffuseHorizontal: diffuseHorizontal === -999 ? null : diffuseHorizontal,
    }
  }
  
  export function parseDwdTimestamp(timestamp) {
    const year = Number(timestamp.slice(0, 4))
    const month = Number(timestamp.slice(4, 6))
    const day = Number(timestamp.slice(6, 8))
    const hour = Number(timestamp.slice(8, 10))
  
    return { year, month, day, hour }
  }
  
  export function aggregateMonthlyIrradiation(records) {
    const monthlyMap = new Map()
  
    for (const record of records) {
      const rawDate = record.MESS_DATUM
      const rawValue = Number(record.FG_LBERG)
  
      if (!rawDate || Number.isNaN(rawValue) || rawValue === -999) {
        continue
      }
  
      const yearMonth = rawDate.slice(0, 6)
      const currentYearMonth = new Date().toISOString().slice(0, 7).replace('-', '')
  
      if (yearMonth < '199001' || yearMonth > currentYearMonth) {
        continue
      }
  
      if (!monthlyMap.has(yearMonth)) {
        monthlyMap.set(yearMonth, {
          sum: 0,
          count: 0,
        })
      }
  
      const monthEntry = monthlyMap.get(yearMonth)
      monthEntry.sum += rawValue
      monthEntry.count += 1
    }
  
    return Array.from(monthlyMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([yearMonth, values]) => ({
        yearMonth,
        year: yearMonth.slice(0, 4),
        month: yearMonth.slice(4, 6),
        label: `${yearMonth.slice(0, 4)}-${yearMonth.slice(4, 6)}`,
        irradiationJPerCm2: values.sum,
        irradiationKwhPerM2: values.sum * J_PER_CM2_TO_KWH_PER_M2,
        valueCount: values.count,
      }))
  }
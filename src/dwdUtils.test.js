import { describe, it, expect } from 'vitest'
import {
  parseDwdSolarProduct,
  normalizeHourlySolarRecord,
  normalizeAndParseHourlyRecords,
  parseDwdTimestamp,
  aggregateMonthlyIrradiation,
  getCompleteYears,
  buildDwdSolarZipUrl,
} from './dwdUtils'

const HEADER = 'STATIONS_ID;MESS_DATUM;QN_592;ATMO_LBERG;FD_LBERG;FG_LBERG;SD_LBERG;ZENIT;MESS_DATUM_WOZ;eor'

function productLine({ stationId = '3987', messDatum, fd, fg, zenit = '29.50', woz }) {
  return `       ${stationId};${messDatum};    1;  126.0;  ${fd};  ${fg};  29;    ${zenit};${woz};eor`
}

describe('parseDwdSolarProduct', () => {
  it('parses semicolon-separated rows into objects keyed by header', () => {
    const text = [
      HEADER,
      productLine({ messDatum: '2023062111:09', fd: '137.0', fg: '198.0', woz: '2023062112:00' }),
    ].join('\n')

    const rows = parseDwdSolarProduct(text)
    expect(rows).toHaveLength(1)
    expect(rows[0].MESS_DATUM).toBe('2023062111:09')
    expect(rows[0].MESS_DATUM_WOZ).toBe('2023062112:00')
    expect(rows[0].FG_LBERG).toBe('198.0')
  })

  it('returns an empty array for empty input', () => {
    expect(parseDwdSolarProduct('')).toEqual([])
  })
})

describe('normalizeHourlySolarRecord', () => {
  it('prefers MESS_DATUM_WOZ (true solar time) over MESS_DATUM (UTC)', () => {
    const record = normalizeHourlySolarRecord({
      MESS_DATUM: '2023062111:09',
      MESS_DATUM_WOZ: '2023062112:00',
      FG_LBERG: '198.0',
      FD_LBERG: '137.0',
    })
    expect(record.timestamp).toBe('2023062112:00')
    expect(record.timeBasis).toBe('woz')
  })

  it('falls back to MESS_DATUM (UTC) when WOZ is missing (pre-1991 data)', () => {
    const record = normalizeHourlySolarRecord({
      MESS_DATUM: '1985062111:09',
      MESS_DATUM_WOZ: '',
      FG_LBERG: '198.0',
      FD_LBERG: '137.0',
    })
    expect(record.timestamp).toBe('1985062111:09')
    expect(record.timeBasis).toBe('utc')
  })

  it('treats -999 as missing (null) for both global and diffuse irradiance', () => {
    const record = normalizeHourlySolarRecord({
      MESS_DATUM: '2023010100:09',
      MESS_DATUM_WOZ: '2023010101:00',
      FG_LBERG: '-999',
      FD_LBERG: '-999',
    })
    expect(record.globalHorizontal).toBeNull()
    expect(record.diffuseHorizontal).toBeNull()
  })
})

describe('parseDwdTimestamp', () => {
  it('parses the YYYYMMDDHH:mm format', () => {
    expect(parseDwdTimestamp('2023062112:00')).toEqual({ year: 2023, month: 6, day: 21, hour: 12 })
  })
})

describe('normalizeAndParseHourlyRecords', () => {
  it('produces a compact, parsed record for each valid row, in one pass', () => {
    const rows = [
      { MESS_DATUM: '2023062111:09', MESS_DATUM_WOZ: '2023062112:00', FG_LBERG: '198.0', FD_LBERG: '109.0' },
      { MESS_DATUM: '2023062112:09', MESS_DATUM_WOZ: '2023062113:00', FG_LBERG: '-999', FD_LBERG: '-999' },
    ]
    const result = normalizeAndParseHourlyRecords(rows)
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      year: 2023,
      month: 6,
      day: 21,
      hour: 12,
      timeBasis: 'woz',
      globalHorizontal: 198,
    })
    expect(result[1].globalHorizontal).toBeNull()
  })
})

describe('aggregateMonthlyIrradiation', () => {
  it('sums global irradiation per month and converts to kWh/m²', () => {
    const records = [
      { year: 2023, month: 1, day: 1, hour: 12, globalHorizontal: 360, diffuseHorizontal: 100 },
      { year: 2023, month: 1, day: 2, hour: 12, globalHorizontal: 360, diffuseHorizontal: 100 },
    ]
    const [entry] = aggregateMonthlyIrradiation(records, { now: new Date('2024-01-01T00:00:00Z') })
    expect(entry.year).toBe('2023')
    expect(entry.month).toBe('01')
    expect(entry.irradiationJPerCm2).toBe(720)
    expect(entry.irradiationKwhPerM2).toBeCloseTo(2, 5) // 720 J/cm² == 2 kWh/m²
  })

  it('ignores -999/missing values and treats null as no contribution', () => {
    const records = [
      { year: 2023, month: 1, day: 1, hour: 12, globalHorizontal: 200, diffuseHorizontal: 50 },
      { year: 2023, month: 1, day: 2, hour: 12, globalHorizontal: null, diffuseHorizontal: null },
    ]
    const [entry] = aggregateMonthlyIrradiation(records, { now: new Date('2024-01-01T00:00:00Z') })
    expect(entry.valueCount).toBe(1)
    expect(entry.irradiationJPerCm2).toBe(200)
  })

  it('flags a month as incomplete when it has far fewer records than hours in the month, and never flags the in-progress current month as complete', () => {
    const now = new Date('2023-06-15T00:00:00Z')
    const sparseJanuary = {
      year: 2023,
      month: 1,
      day: 1,
      hour: 12,
      globalHorizontal: 100,
      diffuseHorizontal: 20,
    }
    const currentMonthRecord = {
      year: 2023,
      month: 6,
      day: 1,
      hour: 12,
      globalHorizontal: 100,
      diffuseHorizontal: 20,
    }

    const series = aggregateMonthlyIrradiation([sparseJanuary, currentMonthRecord], { now })
    const jan = series.find((e) => e.month === '01')
    const jun = series.find((e) => e.month === '06')

    expect(jan.complete).toBe(false) // 1 of ~744 expected hours
    expect(jun.complete).toBe(false) // current month, always incomplete
  })

  it('flags a fully-populated past month as complete', () => {
    const now = new Date('2024-01-01T00:00:00Z')
    // January 2023 has 31 days * 24h = 744 hours.
    const records = []
    for (let day = 1; day <= 31; day++) {
      for (let hour = 1; hour <= 24; hour++) {
        records.push({ year: 2023, month: 1, day, hour, globalHorizontal: 10, diffuseHorizontal: 2 })
      }
    }
    const [entry] = aggregateMonthlyIrradiation(records, { now })
    expect(entry.valueCount).toBe(744)
    expect(entry.complete).toBe(true)
  })
})

describe('getCompleteYears', () => {
  it('only counts a year complete when all 12 months are present and complete', () => {
    const makeMonth = (month, complete) => ({ year: '2022', month, complete })
    const fullYear = Array.from({ length: 12 }, (_, i) => makeMonth(String(i + 1).padStart(2, '0'), true))
    const partialYear = fullYear.slice(0, 11) // missing December

    expect(getCompleteYears(fullYear).has('2022')).toBe(true)
    expect(getCompleteYears(partialYear).has('2022')).toBe(false)
    expect(getCompleteYears([{ year: '2022', month: '01', complete: false }]).has('2022')).toBe(false)
  })
})

describe('buildDwdSolarZipUrl', () => {
  it('pads the station id to 5 digits and uses the given base URL', () => {
    expect(buildDwdSolarZipUrl('3987', '/dwd')).toBe(
      '/dwd/climate_environment/CDC/observations_germany/climate/hourly/solar/stundenwerte_ST_03987_row.zip',
    )
  })
})

// Plotly wrappers: lazy-loads the (still sizeable) plotly.js-basic-dist-min
// bundle only once a chart actually needs to be drawn, and keeps chart
// colors in sync with the light/dark theme.

import { tempoGradientColor } from './gradient'
import { MONTH_LABELS, MONTH_KEYS } from './constants'

let plotlyPromise = null
export function loadPlotly() {
  if (!plotlyPromise) {
    plotlyPromise = import('plotly.js-basic-dist-min').then((m) => m.default ?? m)
  }
  return plotlyPromise
}

const LIGHT_CHART_COLORS = {
  paper: '#FFFFFF',
  plot: '#FFFFFF',
  grid: '#E8E8E3',
  text: '#1B1C1E',
  subtext: '#5E6166',
}
const DARK_CHART_COLORS = {
  paper: '#1B1C1E',
  plot: '#1B1C1E',
  grid: '#33353B',
  text: '#E8E8E3',
  subtext: '#B8BBC0',
}

function getChartColors(theme) {
  return theme === 'dark' ? DARK_CHART_COLORS : LIGHT_CHART_COLORS
}

function getBaseLayout(theme) {
  const c = getChartColors(theme)
  return {
    paper_bgcolor: c.paper,
    plot_bgcolor: c.plot,
    font: {
      color: c.text,
      family: '"Google Sans Flex", "Google Sans", Roboto, system-ui, sans-serif',
      size: 12,
    },
    margin: { t: 16, r: 12, b: 44, l: 56 },
    xaxis: {
      gridcolor: c.grid,
      zeroline: false,
      tickangle: -45,
      type: 'category',
      categoryorder: 'array',
      categoryarray: MONTH_LABELS,
    },
    yaxis: { gridcolor: c.grid, zeroline: false },
    legend: { orientation: 'h', y: 1.18, font: { color: c.subtext } },
    hoverlabel: { bgcolor: c.paper, bordercolor: c.grid, font: { color: c.text } },
  }
}

export async function renderIrradianceChart(elId, monthlySeries, years, theme) {
  const Plotly = await loadPlotly()
  const layout = getBaseLayout(theme)

  const traces = years.map((year, i) => {
    const byMonth = new Map(monthlySeries.filter((e) => e.year === year).map((e) => [e.month, e]))
    const t = years.length > 1 ? i / (years.length - 1) : 1
    const color = tempoGradientColor(t)
    return {
      x: MONTH_LABELS,
      // Incomplete months (data gaps, month in progress) are left out instead
      // of being drawn as a misleading dip towards 0.
      y: MONTH_KEYS.map((m) => {
        const entry = byMonth.get(m)
        return entry?.complete ? entry.irradiationKwhPerM2 : null
      }),
      type: 'scatter',
      mode: 'lines+markers',
      name: year,
      line: { color, width: 2.5, shape: 'spline', smoothing: 0.3 },
      marker: { color, size: 6 },
      hovertemplate: '%{x}<br>%{y:.1f} kWh/m²<extra></extra>',
    }
  })

  return Plotly.react(
    elId,
    traces,
    { ...layout, yaxis: { ...layout.yaxis, title: { text: 'kWh/m²', standoff: 12 } } },
    { responsive: true, displayModeBar: false },
  )
}

export async function renderYieldChart(elId, monthlyValuesKwh, theme) {
  const Plotly = await loadPlotly()
  const layout = getBaseLayout(theme)
  const max = Math.max(...monthlyValuesKwh, 0.0001)

  return Plotly.react(
    elId,
    [
      {
        x: MONTH_LABELS,
        y: monthlyValuesKwh,
        type: 'bar',
        marker: { color: monthlyValuesKwh.map((v) => tempoGradientColor(v / max)) },
        hovertemplate: '%{x}<br>%{y:.0f} kWh<extra></extra>',
      },
    ],
    {
      ...layout,
      yaxis: { ...layout.yaxis, title: { text: 'Ertrag (kWh)', standoff: 12 } },
      showlegend: false,
      bargap: 0.35,
    },
    { responsive: true, displayModeBar: false },
  )
}

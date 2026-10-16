import { iconSun, iconAuto, iconLightBulb, iconMoon, iconPin, iconStation, iconWarning } from './icons'
import { compassDialMarkup, tiltDialMarkup } from './orientationDials'
import { DEFAULT_PERFORMANCE_RATIO } from '../constants'

export function renderAppShell() {
  return `
    <div class="app">
      <header class="app-header">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true">${iconSun}</span>
          <div class="brand-text">
            <h1>Amperecloud Solar Irradiation Explorer</h1>
            <p class="subtitle">Standortwahl per Karte · Historische Solarstrahlung · PV-Ertragsschätzung</p>
          </div>
        </div>
        <div class="theme-toggle" role="group" aria-label="Farbschema">
          <button type="button" class="theme-toggle-btn" data-theme-mode="auto" aria-pressed="false" title="Automatisch (Systemeinstellung)">
            ${iconAuto}<span>Auto</span>
          </button>
          <button type="button" class="theme-toggle-btn" data-theme-mode="light" aria-pressed="false" title="Helles Design">
            ${iconLightBulb}<span>Hell</span>
          </button>
          <button type="button" class="theme-toggle-btn" data-theme-mode="dark" aria-pressed="false" title="Dunkles Design">
            ${iconMoon}<span>Dunkel</span>
          </button>
        </div>
      </header>

      <div class="sr-only" id="status-live" role="status" aria-live="polite"></div>

      <div class="top-grid">
        <section class="card map-card" aria-labelledby="map-card-title">
          <h2 id="map-card-title">Standort</h2>
          <div class="map-shell">
            <div id="map"></div>
            <div class="map-chips">
              <div class="chip location-chip">
                <span class="chip-icon">${iconPin}</span>
                <span id="selected-location" class="chip-text">Auf Karte klicken…</span>
              </div>
              <div class="chip station-chip">
                <span class="chip-icon">${iconStation}</span>
                <span id="nearest-station" class="chip-text">–</span>
              </div>
            </div>
          </div>
        </section>

        <section class="card chart-card" aria-labelledby="chart-card-title">
          <div class="card-head">
            <h2 id="chart-card-title">Monatliche Globalstrahlung</h2>
            <div class="chart-controls">
              <label class="select-control">
                <span class="select-label">Jahr</span>
                <select id="year-select"></select>
              </label>
              <label class="select-control">
                <span class="select-label">Vergleich</span>
                <select id="year-range-select">
                  <option value="1">1 Jahr</option>
                  <option value="2">2 Jahre</option>
                  <option value="5" selected>5 Jahre</option>
                  <option value="10">10 Jahre</option>
                </select>
              </label>
            </div>
          </div>

          <div class="chart-frame">
            <div id="chart-loading" class="chart-skeleton" aria-hidden="true">
              <div class="skeleton-bars">
                ${Array.from({ length: 12 }, () => '<span></span>').join('')}
              </div>
              <div class="skeleton-caption"><span class="spinner"></span>DWD-Daten werden geladen…</div>
            </div>
            <div id="chart-error" class="chart-error hidden">
              <span class="chip-icon">${iconWarning}</span>
              <span id="chart-error-text"></span>
            </div>
            <div id="irradiance-chart" class="chart-plot" style="display:none"></div>
          </div>

          <div id="annual-kpis" class="annual-kpis hidden">
            <div class="kpi-chip">
              <span class="chip-label">Ausgewähltes Jahr</span>
              <span id="annual-selected" class="chip-value">–</span>
              <span id="annual-selected-flag" class="chip-flag hidden">unvollständig</span>
            </div>
            <div class="kpi-chip">
              <span class="chip-label">Ø vollständige Jahre</span>
              <span id="annual-avg" class="chip-value">–</span>
            </div>
            <div class="kpi-chip">
              <span class="chip-label">Bestes Jahr</span>
              <span id="annual-best" class="chip-value">–</span>
            </div>
          </div>
        </section>
      </div>

      <section class="card yield-card" aria-labelledby="yield-card-title">
        <div class="card-head">
          <h2 id="yield-card-title">PV-Ertragsrechner</h2>
          <div id="yield-loading-indicator" class="yield-loading-indicator hidden" aria-hidden="true">
            <span class="spinner spinner-small"></span> berechne…
          </div>
        </div>

        <div id="yield-error" class="chart-error hidden">
          <span class="chip-icon">${iconWarning}</span>
          <span id="yield-error-text"></span>
        </div>

        <div class="yield-grid">
          <div class="yield-controls-col">
            <div class="controls-group">
              <h3>Ausrichtung</h3>
              <div class="orientation-row">
                <div class="dial-block">
                  ${compassDialMarkup()}
                  <span class="dial-caption">Azimut</span>
                </div>
                <div class="dial-field">
                  <label class="slider-control">
                    <div class="slider-header">
                      <span>Azimut (0° = Nord, 180° = Süd)</span>
                      <span id="azimuth-value" class="slider-badge">180°</span>
                    </div>
                    <input id="azimuth-slider" type="range" min="0" max="360" value="180" step="1" aria-describedby="azimuth-value" />
                  </label>
                </div>
              </div>
              <div class="orientation-row">
                <div class="dial-block">
                  ${tiltDialMarkup()}
                  <span class="dial-caption">Neigung</span>
                </div>
                <div class="dial-field">
                  <label class="slider-control">
                    <div class="slider-header">
                      <span>Neigung</span>
                      <span id="tilt-value" class="slider-badge">35°</span>
                    </div>
                    <input id="tilt-slider" type="range" min="0" max="90" value="35" step="1" aria-describedby="tilt-value" />
                  </label>
                </div>
              </div>
            </div>

            <div class="controls-group">
              <h3>Module &amp; System</h3>
              <div class="module-inputs">
                <label class="input-control">
                  <span>Leistung (W/Modul)</span>
                  <input id="module-power-input" type="number" min="1" step="1" value="450" inputmode="numeric" />
                </label>
                <label class="input-control">
                  <span>Fläche (m²/Modul)</span>
                  <input id="module-area-input" type="number" min="0.1" step="0.01" value="2.0" inputmode="decimal" />
                </label>
                <label class="input-control">
                  <span>Anzahl Module</span>
                  <input id="module-count-input" type="number" min="1" step="1" value="20" inputmode="numeric" />
                </label>
                <label class="input-control">
                  <span>Strompreis (€/kWh)</span>
                  <input id="electricity-price-input" type="number" min="0" step="0.001" value="0.10" inputmode="decimal" />
                </label>
                <label class="input-control input-control-wide">
                  <span>Systemverluste / Performance Ratio</span>
                  <input id="performance-ratio-input" type="number" min="0.1" max="1" step="0.01" value="${DEFAULT_PERFORMANCE_RATIO}" inputmode="decimal" />
                </label>
              </div>
            </div>

            <div class="yield-kpis">
              <div class="kpi-hero">
                <span class="kpi-label">Jahresertrag</span>
                <span id="annual-energy-yield" class="kpi-hero-value">–</span>
              </div>
              <div class="kpi-chip-row">
                <div class="kpi-card">
                  <span class="kpi-label">Geneigte Jahresstrahlung</span>
                  <span id="estimated-yield" class="kpi-value">–</span>
                </div>
                <div class="kpi-card">
                  <span class="kpi-label">STC-Wirkungsgrad</span>
                  <span id="module-efficiency" class="kpi-value">–</span>
                </div>
                <div class="kpi-card">
                  <span class="kpi-label">Anlagenleistung</span>
                  <span id="system-kwp" class="kpi-value">–</span>
                </div>
                <div class="kpi-card">
                  <span class="kpi-label">Spezifischer Ertrag</span>
                  <span id="specific-yield" class="kpi-value">–</span>
                </div>
                <div class="kpi-card">
                  <span class="kpi-label">Jahresumsatz</span>
                  <span id="annual-revenue" class="kpi-value">–</span>
                </div>
              </div>
            </div>
          </div>

          <div class="yield-chart-col">
            <div id="yield-chart" class="yield-chart-empty">
              <span>Wähle einen Standort, um den Monatsertrag zu sehen</span>
            </div>
          </div>
        </div>
      </section>

      <footer class="app-footer">
        <p>
          Daten: <a href="https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/hourly/solar/" target="_blank" rel="noopener">Deutscher Wetterdienst (DWD), Climate Data Center</a>,
          Lizenz <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a> / GeoNutzV.
          Kartendaten © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-Mitwirkende.
        </p>
      </footer>
    </div>
  `
}

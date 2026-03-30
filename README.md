# Amperecloud Solar Irradiation Explorer

Ein webbasiertes Tool zur interaktiven Analyse von Solarstrahlungsdaten des DWD (CDC) und zur vereinfachten Abschätzung von geneigter Jahresstrahlung sowie PV-Jahresertrag.

## Funktionen

### Hauptseite
- Standortwahl per Karte
- Auswahl der nächstgelegenen DWD-Solarstation
- Laden echter DWD-CDC-Daten
- Interaktive Visualisierung der monatlichen Globalstrahlung
- Auswahl von Jahr und Vergleichszeitraum

### Ertragsrechner
- Eingabe von:
  - Modulazimut
  - Modulneigung
  - Max Power pro Modul
  - Modulfläche
  - Anzahl Module
- Berechnung von:
  - Orientierungsfaktor
  - Geneigter Jahresstrahlung in `kWh/m²`
  - STC-Wirkungsgrad
  - Geschätztem Jahresertrag in `kWh/Jahr`

---

## Verwendete Technologien

- JavaScript
- Vite
- Plotly
- Leaflet
- JSZip
- DWD CDC Open Data

---

## Projektstruktur

```text
src/
  main.js          # Hauptlogik der App
  solarMath.js     # Sonnenstands- und Tilted-Irradiance-Funktionen
  dwdUtils.js      # DWD-Helfer für Parsing und Aggregation
  stations.js      # lokale Fallback-Stationen
  style.css        # Styling
vite.config.js     # Vite-Konfiguration inkl. DWD-Proxy
index.html
package.json
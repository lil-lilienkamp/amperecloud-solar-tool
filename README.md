# Amperecloud Solar Irradiation Explorer

Ein webbasiertes Tool zur interaktiven Analyse von Solarstrahlungsdaten des DWD (CDC) und zur vereinfachten Abschätzung von geneigter Jahresstrahlung sowie PV-Jahresertrag.

## Funktionen

### Hauptseite

- Standortwahl per Karte (OpenStreetMap/Leaflet), inkl. hell/dunkel angepasster Kartendarstellung
- Automatische Auswahl der nächstgelegenen, aktiven DWD-Solarstation
- Laden echter DWD-CDC-Stundenwerte (Globalstrahlung, diffuse Strahlung)
- Interaktive Visualisierung der monatlichen Globalstrahlung mit Jahres-/Vergleichsauswahl
- Kennzahlen zum ausgewählten Jahr, Durchschnitt und besten (vollständigen) Jahr

### Ertragsrechner

- Eingabe von Azimut, Neigung (mit Kompass-/Neigungs-Visualisierung), Modulleistung, -fläche, -anzahl, Strompreis und Systemverlusten (Performance Ratio)
- Berechnung von geneigter Jahresstrahlung (kWh/m²), STC-Wirkungsgrad, Anlagenleistung (kWp), Jahresertrag (kWh), spezifischem Ertrag (kWh/kWp) und Jahresumsatz (€)

### Darstellung

- Helles/dunkles Design nach Systemeinstellung, umschaltbar (Auto/Hell/Dunkel), Wahl wird lokal gespeichert
- Reduzierte Bewegung/Transparenz wird respektiert (`prefers-reduced-motion`, `prefers-reduced-transparency`)

---

## Verwendete Technologien

- JavaScript (Vanilla, ES-Module), Vite
- Plotly (`plotly.js-basic-dist-min`, lazy geladen) für Diagramme
- Leaflet für die Karte
- `fflate` zum Entpacken der DWD-ZIP-Dateien im Browser
- Vitest für Unit-Tests, ESLint + Prettier für Codequalität
- DWD CDC Open Data als Datenquelle

---

## Setup

```bash
npm install
npm run dev       # Entwicklungsserver mit DWD-Proxy, http://localhost:5173
```

### Weitere Skripte

```bash
npm run build      # Produktions-Build nach dist/
npm run preview    # Baut nicht neu, dient dem lokalen Test des Builds (inkl. DWD-Proxy)
npm test           # Vitest einmalig ausführen
npm run test:watch # Vitest im Watch-Modus
npm run lint        # ESLint + Prettier-Check
```

---

## Datenquelle & Lizenz

Die Solarstrahlungsdaten stammen vom **Deutschen Wetterdienst (DWD)**, Climate Data Center (CDC):

- Datensatz: [Hourly station observations of solar incoming (total/diffuse) and longwave downward radiation for Germany](https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/hourly/solar/)
- Lizenz: [Creative Commons BY 4.0](https://creativecommons.org/licenses/by/4.0/) sowie [GeoNutzV](https://www.gesetze-im-internet.de/geonutzv/)
- Bitte bei Weiterverwendung den DWD als Quelle nennen (z. B. „Datenquelle: Deutscher Wetterdienst (DWD), Climate Data Center, CC BY 4.0").
- Kartendaten: © [OpenStreetMap](https://www.openstreetmap.org/copyright)-Mitwirkende.

### Zeitstempel in den DWD-Rohdaten

Jede Stundensumme trägt zwei mögliche Zeitstempel, **beide markieren das Ende des Stundenintervalls**
(siehe `ZENIT = "solar zenith angle at mid of interval"` in der offiziellen Datensatzbeschreibung):

- `MESS_DATUM_WOZ` – **wahre Ortszeit** (lokale, bereits um Zeitgleichung und Längengrad korrigierte Sonnenzeit). Ab 1991 vorhanden und wird bevorzugt verwendet.
- `MESS_DATUM` – UTC. Wird nur für ältere Daten (vor 1991) als Fallback genutzt.

Für die Sonnenstandsberechnung wird die Intervallmitte (`Stunde − 0.5`) verwendet; bei `MESS_DATUM_WOZ` wird die Zeit **direkt** als wahre Sonnenzeit interpretiert (keine weitere Zeitzonen- oder Zeitgleichungskorrektur), bei `MESS_DATUM` (UTC) werden Längengrad-Korrektur und Zeitgleichung angewendet (Zeitzone = 0, da UTC). Das Vermischen beider Korrekturen war ein Bug in einer früheren Version dieses Tools und wurde behoben.

---

## Modellannahmen & Grenzen

Die Abschätzung ist bewusst einfach gehalten und ersetzt keine professionelle Ertragssimulation (z. B. PVGIS, PVsyst):

- **Isotropes Himmelsmodell** für diffuse Strahlung (kein anisotropes Modell wie Perez); Albedo pauschal 0,2.
- **Direktstrahlungs-Transposition** (1/sin(Sonnenhöhe)) wird unterhalb von 3° Sonnenhöhe auf 0 gesetzt, da der Faktor dort numerisch instabil wird und Horizont-/Verschattungseffekte sowie Stundenmittelungs-Fehler dominieren, die das einfache Modell nicht abbildet.
- Keine Verschattung durch Horizont, Nachbargebäude oder Vegetation.
- Die Wetterdaten stammen von der **nächstgelegenen aktiven DWD-Station**, nicht vom exakt gewählten Standort – bei größerer Entfernung (Mittelgebirge, Küste, Inseln) kann das lokale Klima abweichen.
- Nur vollständige Kalenderjahre (alle 12 Monate mit ≥ 95 % der erwarteten Stundenwerte) fließen in „Ø vollständige Jahre" und „Bestes Jahr" ein; das laufende sowie lückenhafte Jahre werden im UI als „unvollständig" markiert, erscheinen aber weiterhin im Diagramm.
- **Systemverluste / Performance Ratio** (Standard 0,85) fasst Wechselrichter-, Verkabelungs-, Verschmutzungs- und Temperaturverluste pauschal zusammen.

---

## Deployment

`opendata.dwd.de` sendet **keinen** `Access-Control-Allow-Origin`-Header. Der Browser kann die Daten daher in Produktion nicht direkt von dort laden – `vite dev` und `vite preview` lösen das lokal über einen Proxy (`/dwd` → `https://opendata.dwd.de`, siehe `vite.config.js`).

Für ein echtes Produktions-Deployment (z. B. statisches Hosting) wird **ein eigener Reverse-Proxy** benötigt, der `/dwd/*` (oder einen beliebigen Pfad) nach `https://opendata.dwd.de/*` weiterleitet – z. B. eine nginx-`location`-Direktive oder eine kleine Serverless-Funktion. Der Basis-Pfad ist über die Umgebungsvariable `VITE_DWD_BASE_URL` konfigurierbar (Standard: `/dwd`):

```bash
# .env.production
VITE_DWD_BASE_URL=https://mein-proxy.example.com/dwd
```

---

## Projektstruktur

```text
src/
  main.js              # Bootstrap, Event-Wiring, Zustand
  ui/
    template.js         # HTML-Grundgerüst (App-Shell)
    icons.js             # Inline-SVG-Icons
    orientationDials.js  # Kompass-/Neigungs-Visualisierung
  theme.js              # Hell/Dunkel/Auto-Theme, persistiert in localStorage
  dataLoading.js        # DWD-Metadaten- & ZIP-Fetch, Entpacken, Normalisieren
  dwdUtils.js           # Parsing/Aggregation der DWD-Produktdateien
  solarMath.js          # Sonnenstand & Tilted-Irradiance-Berechnung
  tiltedSeries.js        # Sonnenstands-Caching + geneigte Monatsserie
  charts.js             # Plotly-Diagramme (lazy geladen, themafähig)
  gradient.js           # „Tempo"-Verlaufsfarbe für Charts/Marker
  constants.js          # Gemeinsame Konstanten
  stations.js           # Lokale Ausweich-Stationsliste (falls Metadaten-Fetch fehlschlägt)
  style.css             # Design-Tokens & Styling
  *.test.js             # Vitest-Unit-Tests
vite.config.js           # Vite-Konfiguration inkl. DWD-Proxy (dev + preview)
index.html
package.json
```

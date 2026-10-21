# Lucy's Race Planner

A map-first training and race app for the 2027 London Marathon and Round the Rock, the 48-mile lap of Jersey. It installs to a phone's home screen and works offline.

**Live:** https://smelliott121.github.io/round-the-rock-planner/

The map fills the screen. A panel slides up over it (drag the handle, or tap it to open and close), with five tabs along the bottom:

- **Today:** countdowns to each race, the weather where she runs (hourly, wind, sunrise, sunset and daylight left) and tides.
- **Race:** the Round the Rock plan. Elevation-adjusted splits to an 11-hour target, checkpoints with arrival times on the map, buffers against cutoffs, what to pick up at each checkpoint, a race-day forecast (from 15 days out) and a printable crew sheet. **Sections** picks a stretch of the course (a leg, or the hilliest 10, 15 or 20 km), flies through it in 3D and exports it as GPX.
- **Run:** makes training routes anywhere. Search a town, use GPS or tap the map, choose a distance, hilly, any or flat, and loop or out-and-back. It tries six directions on real paths and offers the best three, with the weather, a finish-before-dark check and water taps and toilets along the way. Lucy's routes are saved, and any GPX can be imported.
- **Fuel:** carbs and fluid targets, her own gels, drinks and salt tabs, a sweat test calculator and a gut training log.
- **Kit:** a race kit checklist and shoe mileage.

Map tools: water taps and toilets, notes pinned to the map (water, crew spot, steep, take care), and 3D or flat view.

## Data and privacy

Everything Lucy enters is stored on her phone only. Outside services see only coordinates or search text:

| What | Service |
| --- | --- |
| Map | [OpenFreeMap](https://openfreemap.org/) (© OpenMapTiles, OpenStreetMap contributors) |
| 3D terrain | [Mapzen Terrain Tiles on AWS](https://registry.opendata.aws/terrain-tiles/) |
| Heights for routes | [Open-Meteo Elevation](https://open-meteo.com/) (Copernicus DEM GLO-90) |
| Weather and tides | [Open-Meteo](https://open-meteo.com/) forecast and marine models. Tides are model estimates; check [Jersey Met tide tables](https://m.gov.je/Weather/Tides) for anything safety-critical. |
| Routing | [FOSSGIS OSRM](https://routing.openstreetmap.de/about.html) foot profile, at most one request per second |
| Place search | [Nominatim](https://nominatim.openstreetmap.org/), on submit only, cached, at most one request per second ([policy](https://operations.osmfoundation.org/policies/nominatim/)) |
| Water and toilets | [Overpass API](https://overpass-api.de/), cached for a week |

## Code

- `index.html`, `css/app.css`: the app shell.
- `planner.js`: pacing, fuel and section maths (pure functions, testable in Node).
- `js/app.js`: storage, services, map, sheet, tabs, notes, fly-through.
- `js/today.js`, `js/race.js`, `js/run.js`, `js/fuel.js`, `js/kit.js`: one file per tab.
- `sw.js`, `manifest.webmanifest`, `icons/`: install and offline support.
- `map.html`, `routes.html`: redirects from the earlier versions.

## How the pacing works

The course is resampled every 100 m. Each step gets an effort weight from Tobler's hiking function relative to flat ground: a 10% climb costs about 1.4× flat, the quickest gradient is a gentle 5% descent, and steep descents slow down again. A late-race slowdown (default 10%) is added in a straight line from start to finish. The target time, minus checkpoint stops, is shared out in proportion to those weights, so the plan always lands exactly on the target.

Fuel per leg: a drink mix covers the fluid target, gels, chews and food top up carbs in turn, and salt tabs top up sodium to match fluid × sweat sodium. Caffeine products are held back until a chosen km (default halfway). The app warns if fluid is above sweat rate (hyponatraemia risk) or caffeine is above 3–6 mg/kg.

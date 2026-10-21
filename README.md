# Round the Rock Planner

A pacing, fuelling and crew planner for trail ultras, built for Round the Rock, the 48-mile lap of Jersey.

Load the route GPX, set a target time and the checkpoints, and it gives:

- **Elevation-adjusted splits.** Climbs cost more time, gentle descents a little less, so the plan isn't a flat average pace.
- **Arrival times** at every checkpoint, plus the buffer against each cutoff (red under 20 minutes).
- **Fuel and fluid per leg**, from carbs per hour and fluid per hour targets.
- **Her own products.** Enter gels, drink mix, salt tabs, chews and food from the packets, and every checkpoint shows exactly what to pick up for the next leg, plus a race-day kit list. Caffeine is saved for the second half by default.
- **Sweat test calculator.** Weight before and after a run gives sweat rate; sodium is matched to what she drinks using her sweat sodium. The app warns if the fluid target is above sweat rate (hyponatraemia risk) or caffeine is above 3–6 mg/kg.
- **A printable crew sheet.**

Everything runs in the browser and the plan is saved on the device. If the GPX has no elevation (the FKT file doesn't), the app looks up heights along the route from Open-Meteo (Copernicus DEM, 90 m); only the route coordinates are sent.

## Use it

Open `index.html` in a browser, or turn on GitHub Pages (Settings → Pages → deploy from `main`) to get a link that works on a phone.

The route GPX is on the Fastest Known Time "Jersey Round" page.

## How the pacing works

The course is resampled every 100 m. Each step gets an effort weight from Tobler's hiking function, relative to flat ground: a 10% climb costs about 1.4× flat, the quickest gradient is a gentle 5% descent, and steep descents slow down again. A late-race slowdown (default 10%) is added in a straight line from start to finish.

The target finish time, minus checkpoint stops, is shared across the course in proportion to those weights, so the plan always lands exactly on the target.

Engine: `planner.js` (pure functions, testable in Node). Interface: `index.html`.

## Ideas for next

- Pull real training data from COROS (self-service OAuth) to calibrate the climb and fatigue factors from her own runs
- 3D map of Jersey with the course split into training sections
- Race-day weather on the course
- Live crew view with ETA to the next checkpoint
- London Marathon plan (flat course, even splits)

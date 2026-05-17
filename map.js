import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

const BOSTON_LANES_URL =
  'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson';
const CAMBRIDGE_LANES_URL =
  'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson';
const STATIONS_URL = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
const TRAFFIC_URL = 'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';
const TOKEN_STORAGE_KEY = 'bikewatching.mapboxToken';

const svg = d3.select('#map').select('svg');
const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);
const radiusScale = d3.scaleSqrt().range([0, 25]);

let map;
let baseStations = [];
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

const tokenForm = document.getElementById('token-form');
const tokenInput = document.getElementById('mapbox-token');
const statusElement = document.getElementById('status');
const timeSlider = document.getElementById('time-slider');
const selectedTime = document.getElementById('selected-time');
const anyTimeLabel = document.getElementById('any-time');

tokenInput.value = localStorage.getItem(TOKEN_STORAGE_KEY) ?? '';

function setStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.style.color = isError ? '#8a1c1c' : '';
}

function getStoredToken() {
  return localStorage.getItem(TOKEN_STORAGE_KEY)?.trim() ?? '';
}

function saveToken(token) {
  localStorage.setItem(TOKEN_STORAGE_KEY, token.trim());
}

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) {
    return tripsByMinute.flat();
  }

  const matchingTrips = [];

  for (let offset = -60; offset <= 60; offset += 1) {
    const currentMinute = (minute + offset + 1440) % 1440;
    matchingTrips.push(...tripsByMinute[currentMinute]);
  }

  return matchingTrips;
}

function computeStationTraffic(stations, timeFilter = -1) {
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, timeFilter),
    (values) => values.length,
    (trip) => trip.start_station_id,
  );

  const arrivals = d3.rollup(
    filterByMinute(arrivalsByMinute, timeFilter),
    (values) => values.length,
    (trip) => trip.end_station_id,
  );

  return stations.map((station) => {
    const departuresCount = departures.get(station.short_name) ?? 0;
    const arrivalsCount = arrivals.get(station.short_name) ?? 0;

    return {
      ...station,
      departures: departuresCount,
      arrivals: arrivalsCount,
      totalTraffic: departuresCount + arrivalsCount,
    };
  });
}

function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

function updateCirclePositions() {
  svg
    .selectAll('circle')
    .attr('cx', (station) => getCoords(station).cx)
    .attr('cy', (station) => getCoords(station).cy);
}

function renderStations(stations) {
  const circles = svg.selectAll('circle').data(stations, (station) => station.short_name);

  circles.exit().remove();

  const circlesEnter = circles
    .enter()
    .append('circle')
    .attr('stroke-width', 1.2);

  const merged = circlesEnter.merge(circles);

  merged
    .attr('r', (station) => radiusScale(station.totalTraffic))
    .style('--departure-ratio', (station) => {
      const ratio =
        station.totalTraffic === 0 ? 0.5 : station.departures / station.totalTraffic;
      return stationFlow(ratio);
    });

  merged.selectAll('title').remove();
  merged
    .append('title')
    .text(
      (station) =>
        `${station.name}: ${station.totalTraffic} trips (${station.departures} departures, ${station.arrivals} arrivals)`,
    );

  updateCirclePositions();
}

function updateScatterPlot(timeFilter) {
  radiusScale.range(timeFilter === -1 ? [0, 25] : [3, 50]);
  renderStations(computeStationTraffic(baseStations, timeFilter));
}

function updateTimeDisplay() {
  const timeFilter = Number(timeSlider.value);

  if (timeFilter === -1) {
    selectedTime.textContent = '';
    anyTimeLabel.style.display = 'block';
  } else {
    selectedTime.textContent = formatTime(timeFilter);
    anyTimeLabel.style.display = 'none';
  }

  if (baseStations.length > 0) {
    updateScatterPlot(timeFilter);
  }
}

async function initializeMap() {
  const token = getStoredToken();

  if (!token) {
    setStatus('Enter a Mapbox token to load the basemap and overlays.');
    return;
  }

  mapboxgl.accessToken = token;

  if (map) {
    map.remove();
  }

  svg.selectAll('*').remove();
  departuresByMinute = Array.from({ length: 1440 }, () => []);
  arrivalsByMinute = Array.from({ length: 1440 }, () => []);

  setStatus('Loading map and Bluebikes datasets...');

  map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [-71.09415, 42.36027],
    zoom: 12,
    minZoom: 9,
    maxZoom: 18,
  });

  map.addControl(new mapboxgl.NavigationControl(), 'top-left');

  map.on('load', async () => {
    try {
      const [stationResponse] = await Promise.all([
        d3.json(STATIONS_URL),
        d3.csv(TRAFFIC_URL, (trip) => {
          trip.started_at = new Date(trip.started_at);
          trip.ended_at = new Date(trip.ended_at);

          const startedMinutes = minutesSinceMidnight(trip.started_at);
          const endedMinutes = minutesSinceMidnight(trip.ended_at);

          departuresByMinute[startedMinutes].push(trip);
          arrivalsByMinute[endedMinutes].push(trip);
          return trip;
        }),
      ]);

      baseStations = stationResponse.data.stations;
      const initialStations = computeStationTraffic(baseStations);

      radiusScale.domain([0, d3.max(initialStations, (station) => station.totalTraffic) ?? 0]);

      map.addSource('boston-bike-lanes', {
        type: 'geojson',
        data: BOSTON_LANES_URL,
      });

      map.addSource('cambridge-bike-lanes', {
        type: 'geojson',
        data: CAMBRIDGE_LANES_URL,
      });

      const bikeLanePaint = {
        'line-color': '#2ca25f',
        'line-width': 3.5,
        'line-opacity': 0.55,
      };

      map.addLayer({
        id: 'boston-bike-lanes',
        type: 'line',
        source: 'boston-bike-lanes',
        paint: bikeLanePaint,
      });

      map.addLayer({
        id: 'cambridge-bike-lanes',
        type: 'line',
        source: 'cambridge-bike-lanes',
        paint: bikeLanePaint,
      });

      renderStations(initialStations);
      updateTimeDisplay();

      map.on('move', updateCirclePositions);
      map.on('zoom', updateCirclePositions);
      map.on('resize', updateCirclePositions);
      map.on('moveend', updateCirclePositions);

      setStatus(
        `Loaded ${baseStations.length} Bluebikes stations with March 2024 traffic and bike lanes from Boston and Cambridge.`,
      );
    } catch (error) {
      console.error(error);
      setStatus(
        'The map loaded, but one or more datasets failed to load. Check the console for details.',
        true,
      );
    }
  });

  map.on('error', (event) => {
    console.error(event.error);
    if (String(event.error?.message ?? '').toLowerCase().includes('token')) {
      setStatus('Mapbox rejected the token. Paste a valid public token and load the map again.', true);
    }
  });
}

tokenForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const token = tokenInput.value.trim();

  if (!token) {
    setStatus('Enter a Mapbox public token before loading the map.', true);
    return;
  }

  saveToken(token);
  initializeMap();
});

timeSlider.addEventListener('input', updateTimeDisplay);
updateTimeDisplay();
initializeMap();

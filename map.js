import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

console.log('Mapbox GL JS Loaded:', mapboxgl);

const BOSTON_LANES_URL =
  'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson';
const CAMBRIDGE_LANES_URL =
  'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson';
const STATIONS_URL = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
const TRAFFIC_URL = 'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';

const svg = d3.select('#map').select('svg');
const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);
const radiusScale = d3.scaleSqrt().range([0, 25]);

let map;
let baseStations = [];
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

const timeSlider = document.getElementById('time-slider');
const selectedTime = document.getElementById('selected-time');
const anyTimeLabel = document.getElementById('any-time');

mapboxgl.accessToken =
  'pk.eyJ1Ijoic2l5YXNhdGhheWUiLCJhIjoiY21wOThzODBiMHIxZjJwcTBtNjRteDJnYSJ9.c8YX-MZaAv4cUvivS6i8tA';

function getFlowColor(departureRatio) {
  if (departureRatio === 1) {
    return 'steelblue';
  }

  if (departureRatio === 0.5) {
    return 'darkorange';
  }

  return 'hotpink';
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

  merged.selectAll('title').remove();

  merged
    .attr('r', (station) => radiusScale(station.totalTraffic))
    .style('fill', (station) => {
      const ratio =
        station.totalTraffic === 0 ? 0.5 : station.departures / station.totalTraffic;
      return getFlowColor(stationFlow(ratio));
    })
    .each(function (station) {
      d3.select(this)
        .append('title')
        .text(
          `${station.totalTraffic} trips (${station.departures} departures, ${station.arrivals} arrivals)`,
        );
    });

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
  map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [-71.09415, 42.36027],
    zoom: 12,
    minZoom: 5,
    maxZoom: 18,
  });

  map.on('load', async () => {
    try {
      const [jsonData] = await Promise.all([
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

      console.log('Loaded JSON Data:', jsonData);
      baseStations = jsonData.data.stations;
      console.log('Stations Array:', baseStations);
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
        paint: bikeLanePaint
      });

      map.addLayer({
        id: 'cambridge-bike-lanes',
        type: 'line',
        source: 'cambridge-bike-lanes',
        paint: bikeLanePaint
      });

      renderStations(initialStations);
      updateTimeDisplay();

      map.on('move', updateCirclePositions);
      map.on('zoom', updateCirclePositions);
      map.on('resize', updateCirclePositions);
      map.on('moveend', updateCirclePositions);
    } catch (error) {
      console.error(error);
    }
  });
}

timeSlider.addEventListener('input', updateTimeDisplay);
updateTimeDisplay();
initializeMap();

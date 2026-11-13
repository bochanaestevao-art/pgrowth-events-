(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const distanceEl = $("distance");
  const durationEl = $("duration");
  const paceEl = $("pace");
  const accuracyEl = $("accuracy");
  const gpsStatus = $("gps-status");
  const gpsIndicator = $("gps-indicator");
  const messageEl = $("run-message");

  let map;
  let routeLine;
  let currentMarker;
  let watchId = null;
  let timerId = null;
  let running = false;
  let paused = false;
  let started = false;
  let totalDistance = 0;
  let elapsedBeforeSegment = 0;
  let segmentStartedAt = 0;
  let lastPosition = null;
  let acceptedPoints = [];
  let lastGpsTimestamp = 0;
  let lastBearing = 0;

  function formatTime(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return [hours, minutes, remainder]
      .map(value => String(value).padStart(2, "0"))
      .join(":");
  }

  function currentElapsed() {
    return elapsedBeforeSegment +
      (running ? Date.now() - segmentStartedAt : 0);
  }

  function formatPace(distanceKm, milliseconds) {
    if (distanceKm < 0.01) return "--:--";
    const secondsPerKm = Math.floor(milliseconds / 1000 / distanceKm);
    if (!Number.isFinite(secondsPerKm)) return "--:--";
    const minutes = Math.floor(secondsPerKm / 60);
    const seconds = secondsPerKm % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function updateStats() {
    const km = totalDistance / 1000;
    const elapsed = currentElapsed();

    distanceEl.innerHTML = `${km.toFixed(2)} <small>km</small>`;
    durationEl.textContent = formatTime(elapsed);
    paceEl.innerHTML = `${formatPace(km, elapsed)} <small>/km</small>`;
  }

  function updateMessage(message) {
    messageEl.textContent = message;
  }

  function setGpsStatus(message, active = false) {
    gpsStatus.lastChild.textContent = ` ${message}`;
    gpsStatus.classList.toggle("live", active);
    gpsIndicator.textContent = active ? "GPS ACTIVO" : "GPS OFF";
    gpsIndicator.classList.toggle("active", active);
  }

  function distanceBetween(a, b) {
    const radians = degrees => degrees * Math.PI / 180;
    const earthRadius = 6371000;
    const lat1 = radians(a.latitude);
    const lat2 = radians(b.latitude);
    const deltaLat = radians(b.latitude - a.latitude);
    const deltaLon = radians(b.longitude - a.longitude);

    const h = Math.sin(deltaLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) *
      Math.sin(deltaLon / 2) ** 2;

    return 2 * earthRadius * Math.asin(Math.sqrt(h));
  }

  function calculateBearing(from, to) {
    const rad = value => value * Math.PI / 180;
    const deg = value => (value * 180 / Math.PI + 360) % 360;
    const lat1 = rad(from.latitude);
    const lat2 = rad(to.latitude);
    const deltaLon = rad(to.longitude - from.longitude);
    const y = Math.sin(deltaLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
    return deg(Math.atan2(y, x));
  }

  function createDirectionIcon(bearing) {
    return L.divIcon({
      className: "gps-direction-icon",
      html: `<div class="gps-direction-arrow" style="transform:rotate(${bearing}deg)"><svg viewBox="0 0 28 34" width="34" height="40" xmlns="http://www.w3.org/2000/svg"><path d="M14 2 L25 29 L14 22 L3 29 Z" fill="#ffd400" stroke="#171000" stroke-width="2" stroke-linejoin="round"/></svg></div>`,
      iconSize: [34, 40],
      iconAnchor: [17, 20]
    });
  }

  function initializeMap() {
    if (!window.L) {
      updateMessage("Não foi possível carregar o mapa. Verifica a ligação à internet.");
      return;
    }

    map = L.map("run-map", {
      zoomControl: true,
      attributionControl: true
    }).setView([-19.8333, 34.85], 13);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);

    routeLine = L.polyline([], {
      color: "#ffd400",
      weight: 5,
      opacity: 0.9,
      lineJoin: "round"
    }).addTo(map);
  }

  function onGpsSuccess(position) {
    if (!running) return;

    const coords = position.coords;
    const point = {
      latitude: coords.latitude,
      longitude: coords.longitude
    };
    const accuracy = coords.accuracy;

    accuracyEl.innerHTML = `${Math.round(accuracy)} <small>m</small>`;

    if (accuracy > 35) {
      setGpsStatus("Sinal GPS fraco — à procura de maior precisão", false);
      updateMessage("Precisão GPS insuficiente. Procura um espaço aberto e mantém o telemóvel contigo.");
      return;
    }

    const timestamp = position.timestamp || Date.now();

    if (timestamp <= lastGpsTimestamp) return;

    let movementBearing = lastBearing;

    if (lastPosition) {
      const segmentDistance = distanceBetween(lastPosition, point);
      const elapsedSeconds = (timestamp - lastGpsTimestamp) / 1000;

      // Filtra saltos GPS muito improváveis.
      if (elapsedSeconds > 0 && segmentDistance / elapsedSeconds > 12) {
        updateMessage("A verificar a precisão do GPS. Mantém o telemóvel contigo.");
        return;
      }

      // Só actualiza a distância e o rumo quando há deslocamento suficiente.
      if (segmentDistance >= 2) {
        totalDistance += segmentDistance;
        lastBearing = calculateBearing(lastPosition, point);
        movementBearing = lastBearing;
      }
    }

    lastPosition = point;
    lastGpsTimestamp = timestamp;
    acceptedPoints.push([point.latitude, point.longitude]);

    routeLine.setLatLngs(acceptedPoints);

    if (!currentMarker) {
      currentMarker = L.marker([point.latitude, point.longitude], {
        icon: createDirectionIcon(movementBearing),
        interactive: false,
        keyboard: false
      }).addTo(map);
    } else {
      currentMarker.setLatLng([point.latitude, point.longitude]);
      currentMarker.setIcon(createDirectionIcon(movementBearing));
    }

    map.setView([point.latitude, point.longitude], Math.max(map.getZoom(), 16));
    setGpsStatus("GPS ligado — localização actualizada", true);
    updateMessage("GPS activo. A tua corrida está a ser registada.");
    updateStats();
  }

  function onGpsError(error) {
    const messages = {
      1: "Acesso à localização recusado. Autoriza o GPS nas definições do navegador.",
      2: "Localização indisponível. Verifica o GPS do telemóvel e tenta novamente.",
      3: "O GPS demorou demasiado tempo a responder. Tenta novamente."
    };

    setGpsStatus("GPS indisponível", false);
    updateMessage(messages[error.code] || "Ocorreu um erro ao obter a localização.");
  }

  function startGps() {
    if (!navigator.geolocation) {
      updateMessage("Este navegador não suporta geolocalização.");
      return false;
    }

    if (!window.isSecureContext) {
      updateMessage("O GPS exige uma ligação segura HTTPS ou localhost. Abre o site pelo endereço HTTPS.");
      return false;
    }

    watchId = navigator.geolocation.watchPosition(
      onGpsSuccess,
      onGpsError,
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 20000
      }
    );

    return true;
  }

  function stopGps() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  }

  function startTimer() {
    segmentStartedAt = Date.now();
    running = true;
    timerId = window.setInterval(updateStats, 500);
  }

  function stopTimer() {
    if (timerId !== null) {
      window.clearInterval(timerId);
      timerId = null;
    }
    if (running) {
      elapsedBeforeSegment += Date.now() - segmentStartedAt;
    }
    running = false;
    updateStats();
  }

  function startRun() {
    if (started) return;

    if (!window.isSecureContext) {
      updateMessage("Para usar o GPS, abre a página através de HTTPS.");
      return;
    }

    started = true;
    paused = false;
    totalDistance = 0;
    elapsedBeforeSegment = 0;
    lastPosition = null;
    lastGpsTimestamp = 0;
    acceptedPoints = [];

    if (routeLine) routeLine.setLatLngs([]);
    if (currentMarker && map) {
      map.removeLayer(currentMarker);
      currentMarker = null;
    }

    $("start-run").disabled = true;
    $("pause-run").disabled = false;
    $("finish-run").disabled = false;
    $("pause-run").textContent = "Ⅱ PAUSAR";

    startTimer();
    startGps();
    setGpsStatus("A obter localização...", false);
    updateMessage("A procurar sinal GPS. Aguarda alguns instantes num local aberto.");
  }

  function pauseRun() {
    if (!running) return;

    stopTimer();
    stopGps();
    paused = true;

    $("pause-run").textContent = "▶ RETOMAR";
    setGpsStatus("Corrida em pausa", false);
    updateMessage("Corrida pausada. O tempo e a distância estão suspensos.");
  }

  function resumeRun() {
    if (!paused) return;

    paused = false;
    startTimer();
    startGps();

    $("pause-run").textContent = "Ⅱ PAUSAR";
    setGpsStatus("A recuperar GPS...", false);
    updateMessage("A retomar a corrida e a localização GPS.");
  }

  // PGROWTH_RUN_HISTORY_V1
  function saveRunRecord(elapsed, km) {
    if (elapsed <= 0 || km <= 0) return false;

    const historyKey = "pgrowth_fitness_run_history_v1";
    const profileKey = "pgrowth_fitness_athlete_profile_v1";

    try {
      const history = JSON.parse(localStorage.getItem(historyKey) || "[]");
      const profile = JSON.parse(localStorage.getItem(profileKey) || "{}");
      const fields = profile.fields || {};

      const record = {
        id: window.crypto && crypto.randomUUID
          ? crypto.randomUUID()
          : "run-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
        date: new Date().toISOString(),
        timezone: "Africa/Maputo",
        athleteName: fields.name || "",
        distanceKm: Number(km.toFixed(3)),
        durationMs: Math.round(elapsed),
        durationSeconds: Math.round(elapsed / 1000),
        pace: formatPace(km, elapsed),
        route: acceptedPoints.map(point => [point[0], point[1]])
      };

      history.push(record);
      localStorage.setItem(historyKey, JSON.stringify(history));

      window.dispatchEvent(new CustomEvent("pgrowth:run-saved", {
        detail: record
      }));

      return true;
    } catch (error) {
      console.error("Erro ao guardar corrida:", error);
      return false;
    }
  }

  function finishRun() {
    if (!started) return;

    stopTimer();
    stopGps();
    paused = false;
    started = false;

    const elapsed = elapsedBeforeSegment;
    const km = totalDistance / 1000;
    const saved = saveRunRecord(elapsed, km);

    $("final-distance").textContent = `${km.toFixed(2)} km`;
    $("final-duration").textContent = formatTime(elapsed);
    $("final-pace").textContent = `${formatPace(km, elapsed)} /km`;
    $("run-result").hidden = false;

    $("start-run").disabled = false;
    $("pause-run").disabled = true;
    $("finish-run").disabled = true;
    $("pause-run").textContent = "Ⅱ PAUSAR";

    setGpsStatus("Corrida terminada", false);

    if (saved) {
      updateMessage("Corrida concluída e guardada no teu histórico.");
    } else {
      updateMessage("Corrida concluída. Não foi possível guardar um registo com distância GPS válida. Verifica o sinal GPS.");
    }
  }

  $("start-run").addEventListener("click", startRun);

  $("pause-run").addEventListener("click", () => {
    if (running) pauseRun();
    else if (paused) resumeRun();
  });

  $("finish-run").addEventListener("click", finishRun);

  $("close-result").addEventListener("click", () => {
    $("run-result").hidden = true;
  });

  initializeMap();
  updateStats();
})();

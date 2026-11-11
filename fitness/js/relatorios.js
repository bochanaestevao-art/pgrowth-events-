(() => {
  "use strict";

  const HISTORY_KEY = "pgrowth_fitness_run_history_v1";
  const TIME_ZONE = "Africa/Maputo";
  let currentPeriod = "week";
  let allRuns = [];

  const $ = id => document.getElementById(id);

  function readHistory() {
    try {
      const data = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      return Array.isArray(data) ? data.filter(run =>
        run &&
        Number.isFinite(Number(run.distanceKm)) &&
        Number.isFinite(Number(run.durationMs)) &&
        run.date
      ) : [];
    } catch (error) {
      console.error("Erro ao ler histórico:", error);
      return [];
    }
  }

  function maputoDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;

    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);

    const result = {};
    for (const part of parts) {
      if (part.type !== "literal") result[part.type] = Number(part.value);
    }
    return result;
  }

  function dateKey(parts) {
    return parts.year + "-" +
      String(parts.month).padStart(2, "0") + "-" +
      String(parts.day).padStart(2, "0");
  }

  function formatDate(value) {
    return new Intl.DateTimeFormat("pt-PT", {
      timeZone: TIME_ZONE,
      day: "2-digit",
      month: "short",
      year: "numeric"
    }).format(new Date(value));
  }

  function formatDuration(milliseconds) {
    const total = Math.floor(milliseconds / 1000);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;

    return [hours, minutes, seconds]
      .map(value => String(value).padStart(2, "0"))
      .join(":");
  }

  function formatPace(distanceKm, durationMs) {
    if (distanceKm <= 0) return "--:--";

    const seconds = Math.floor(durationMs / 1000 / distanceKm);
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;

    return String(minutes).padStart(2, "0") + ":" +
      String(remainder).padStart(2, "0");
  }

  function getWeekStart(parts) {
    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    const day = date.getUTCDay();
    const difference = day === 0 ? 6 : day - 1;
    date.setUTCDate(date.getUTCDate() - difference);
    return date.toISOString().slice(0, 10);
  }

  function getFilteredRuns() {
    const now = maputoDate(new Date());
    if (!now) return [];

    if (currentPeriod === "all") return [...allRuns];

    if (currentPeriod === "month") {
      const monthPrefix = now.year + "-" + String(now.month).padStart(2, "0");
      return allRuns.filter(run => {
        const parts = maputoDate(run.date);
        return parts && dateKey(parts).startsWith(monthPrefix);
      });
    }

    const start = getWeekStart(now);
    const startDate = new Date(start + "T00:00:00Z");
    const endDate = new Date(startDate);
    endDate.setUTCDate(endDate.getUTCDate() + 7);

    return allRuns.filter(run => {
      const parts = maputoDate(run.date);
      if (!parts) return false;
      const key = dateKey(parts);
      return key >= start && key < endDate.toISOString().slice(0, 10);
    });
  }

  function setPeriodLabel() {
    const now = maputoDate(new Date());
    if (!now) return;

    if (currentPeriod === "week") {
      const start = getWeekStart(now);
      const end = new Date(start + "T00:00:00Z");
      end.setUTCDate(end.getUTCDate() + 6);
      $("reports-period").textContent =
        "Semana de " + start.split("-").reverse().join("/") +
        " a " + end.toISOString().slice(0, 10).split("-").reverse().join("/");
    } else if (currentPeriod === "month") {
      $("reports-period").textContent =
        new Intl.DateTimeFormat("pt-PT", {
          timeZone: TIME_ZONE,
          month: "long",
          year: "numeric"
        }).format(new Date());
    } else {
      $("reports-period").textContent = "Todas as corridas registadas";
    }
  }

  function renderStats(runs) {
    const distance = runs.reduce((sum, run) => sum + Number(run.distanceKm), 0);
    const duration = runs.reduce((sum, run) => sum + Number(run.durationMs), 0);

    $("report-distance").innerHTML =
      distance.toFixed(2).replace(".", ",") + " <small>km</small>";
    $("report-count").textContent = String(runs.length);
    $("report-duration").textContent = formatDuration(duration);
    $("report-pace").innerHTML =
      formatPace(distance, duration) + " <small>/km</small>";
  }

  function renderChart(runs) {
    const container = $("report-chart");
    container.replaceChildren();

    const ordered = [...runs]
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(-7);

    if (!ordered.length) {
      const empty = document.createElement("p");
      empty.className = "report-empty";
      empty.textContent = "Ainda não existem corridas registadas neste período.";
      container.appendChild(empty);
      return;
    }

    const maxDistance = Math.max(...ordered.map(run => Number(run.distanceKm)), 0.1);

    ordered.forEach(run => {
      const column = document.createElement("div");
      column.className = "chart-column";

      const value = document.createElement("b");
      value.textContent = Number(run.distanceKm).toFixed(1) + " km";

      const area = document.createElement("div");
      area.className = "chart-bar-area";

      const bar = document.createElement("div");
      bar.className = "chart-bar";
      bar.style.height = Math.max(4, Number(run.distanceKm) / maxDistance * 88) + "px";
      bar.title = Number(run.distanceKm).toFixed(2) + " km";

      const date = document.createElement("small");
      date.textContent = new Intl.DateTimeFormat("pt-PT", {
        timeZone: TIME_ZONE,
        day: "2-digit",
        month: "2-digit"
      }).format(new Date(run.date));

      area.appendChild(bar);
      column.append(value, area, date);
      container.appendChild(column);
    });
  }

  function renderHistory(runs) {
    const container = $("report-history");
    container.replaceChildren();

    $("history-total").textContent =
      runs.length + (runs.length === 1 ? " registo" : " registos");

    if (!runs.length) {
      const empty = document.createElement("p");
      empty.className = "report-empty";
      empty.textContent = "As tuas corridas concluídas aparecerão aqui.";
      container.appendChild(empty);
      return;
    }

    [...runs]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .forEach(run => {
        const item = document.createElement("article");
        item.className = "history-item";

        const details = document.createElement("div");
        const distance = document.createElement("strong");
        distance.textContent = Number(run.distanceKm).toFixed(2) + " km";

        const info = document.createElement("small");
        info.textContent = formatDate(run.date) +
          " · " + formatDuration(Number(run.durationMs));

        const pace = document.createElement("div");
        pace.className = "history-pace";
        pace.textContent = (run.pace || formatPace(
          Number(run.distanceKm),
          Number(run.durationMs)
        )) + " /km";

        details.append(distance, info);
        item.append(details, pace);
        container.appendChild(item);
      });
  }

  function render() {
    const runs = getFilteredRuns();
    setPeriodLabel();
    renderStats(runs);
    renderChart(runs);
    renderHistory(runs);

    document.querySelectorAll(".report-filter").forEach(button => {
      const active = button.dataset.period === currentPeriod;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  document.querySelectorAll(".report-filter").forEach(button => {
    button.addEventListener("click", () => {
      currentPeriod = button.dataset.period;
      render();
    });
  });

  allRuns = readHistory();
  render();

  window.addEventListener("pageshow", () => {
    allRuns = readHistory();
    render();
  });
})();

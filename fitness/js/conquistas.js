(() => {
  "use strict";

  const HISTORY_KEY = "pgrowth_fitness_run_history_v1";
  const TIMEZONE = "Africa/Maputo";

  const achievements = [
    {
      id: "first-run",
      icon: "🏃",
      name: "Primeiros passos",
      description: "Completa a tua primeira corrida.",
      target: 1,
      value: s => s.runs,
      format: v => `${v} / 1 corrida`
    },
    {
      id: "five-total",
      icon: "🥉",
      name: "Primeiros 5 KM",
      description: "Acumula 5 quilómetros de corrida.",
      target: 5,
      value: s => s.distance,
      format: v => `${v.toFixed(2)} / 5 km`
    },
    {
      id: "ten-total",
      icon: "🥈",
      name: "Conquista dos 10 KM",
      description: "Acumula 10 quilómetros de corrida.",
      target: 10,
      value: s => s.distance,
      format: v => `${v.toFixed(2)} / 10 km`
    },
    {
      id: "five-single",
      icon: "🏅",
      name: "Desafio dos 5 KM",
      description: "Completa 5 km numa única corrida.",
      target: 5,
      value: s => s.bestRun,
      format: v => `${v.toFixed(2)} / 5 km`
    },
    {
      id: "ten-single",
      icon: "🏆",
      name: "Desafio dos 10 KM",
      description: "Completa 10 km numa única corrida.",
      target: 10,
      value: s => s.bestRun,
      format: v => `${v.toFixed(2)} / 10 km`
    },
    {
      id: "three-week",
      icon: "🔥",
      name: "Semana de campeão",
      description: "Completa 3 corridas na mesma semana.",
      target: 3,
      value: s => s.bestWeek,
      format: v => `${v} / 3 corridas`
    },
    {
      id: "ten-runs",
      icon: "⭐",
      name: "Atleta dedicado",
      description: "Completa 10 corridas.",
      target: 10,
      value: s => s.runs,
      format: v => `${v} / 10 corridas`
    },
    {
      id: "fifty-total",
      icon: "💛",
      name: "Resistência de ouro",
      description: "Acumula 50 quilómetros de corrida.",
      target: 50,
      value: s => s.distance,
      format: v => `${v.toFixed(2)} / 50 km`
    },
    {
      id: "hundred-total",
      icon: "👑",
      name: "Lenda da resistência",
      description: "Acumula 100 quilómetros de corrida.",
      target: 100,
      value: s => s.distance,
      format: v => `${v.toFixed(2)} / 100 km`
    }
  ];

  function readHistory() {
    try {
      const data = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      if (!Array.isArray(data)) return [];

      return data.filter(run =>
        run &&
        Number.isFinite(Number(run.distanceKm)) &&
        Number(run.distanceKm) > 0 &&
        Number.isFinite(Number(run.durationMs)) &&
        Number(run.durationMs) > 0 &&
        run.date &&
        !Number.isNaN(new Date(run.date).getTime())
      );
    } catch (error) {
      console.error("Erro ao ler histórico de corridas:", error);
      return [];
    }
  }

  function weekKey(dateValue) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date(dateValue));

    const values = {};
    parts.forEach(part => {
      values[part.type] = part.value;
    });

    const localDate = new Date(Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day)
    ));

    const weekday = localDate.getUTCDay();
    const daysSinceMonday = (weekday + 6) % 7;

    localDate.setUTCDate(localDate.getUTCDate() - daysSinceMonday);

    return localDate.toISOString().slice(0, 10);
  }

  function calculateStats(history) {
    const distance = history.reduce(
      (sum, run) => sum + Number(run.distanceKm),
      0
    );

    const bestRun = history.reduce(
      (best, run) => Math.max(best, Number(run.distanceKm)),
      0
    );

    const weeklyCounts = {};

    history.forEach(run => {
      const key = weekKey(run.date);
      weeklyCounts[key] = (weeklyCounts[key] || 0) + 1;
    });

    const bestWeek = Object.values(weeklyCounts).reduce(
      (best, count) => Math.max(best, count),
      0
    );

    return {
      runs: history.length,
      distance,
      bestRun,
      bestWeek
    };
  }

  function render(stats) {
    const unlocked = achievements.filter(item =>
      item.value(stats) >= item.target
    ).length;

    const percent = Math.round(
      (unlocked / achievements.length) * 100
    );

    document.getElementById("achievement-count").textContent =
      `${unlocked} / ${achievements.length}`;

    document.getElementById("total-runs").textContent =
      stats.runs;

    document.getElementById("total-distance").textContent =
      `${stats.distance.toFixed(2)} km`;

    document.getElementById("best-run").textContent =
      `${stats.bestRun.toFixed(2)} km`;

    document.getElementById("progress-percent").textContent =
      `${percent}%`;

    document.getElementById("overall-progress").style.width =
      `${percent}%`;

    document.getElementById("progress-message").textContent =
      unlocked === achievements.length
        ? "Impressionante! Desbloqueaste todas as conquistas disponíveis."
        : unlocked > 0
          ? `Já desbloqueaste ${unlocked} conquistas. Continua a evoluir!`
          : "A tua próxima conquista começa com o primeiro passo.";

    const container = document.getElementById("achievements-list");

    container.innerHTML = achievements.map(item => {
      const current = Math.max(0, item.value(stats));
      const isUnlocked = current >= item.target;
      const progress = Math.min(100, (current / item.target) * 100);

      return `
        <article class="achievement-card ${isUnlocked ? "unlocked" : "locked"}">
          <div class="achievement-top">
            <div class="achievement-icon">${item.icon}</div>
            <div>
              <h3 class="achievement-name">${item.name}</h3>
              <p class="achievement-description">${item.description}</p>
            </div>
          </div>

          <span class="achievement-status">
            ${isUnlocked ? "✓ CONQUISTA DESBLOQUEADA" : "🔒 POR DESBLOQUEAR"}
          </span>

          <div class="achievement-progress">
            <div style="width:${progress}%"></div>
          </div>

          <small class="achievement-progress-text">
            ${item.format(current)}
          </small>
        </article>
      `;
    }).join("");
  }

  function refreshAchievements() {
    const history = readHistory();
    const stats = calculateStats(history);
    render(stats);
  }

  refreshAchievements();

  window.addEventListener("storage", event => {
    if (event.key === HISTORY_KEY || event.key === null) {
      refreshAchievements();
    }
  });

  window.addEventListener("focus", refreshAchievements);
  window.addEventListener("pageshow", refreshAchievements);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshAchievements();
  });

  window.setInterval(refreshAchievements, 10000);
})();

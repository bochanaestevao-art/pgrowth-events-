(() => {
  "use strict";

  const PROFILE_KEY = "pgrowth_fitness_athlete_profile_v1";
  const HISTORY_KEY = "pgrowth_fitness_run_history_v1";
  const TIME_ZONE = "Africa/Maputo";
  const $ = id => document.getElementById(id);

  function read(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function formatDuration(ms) {
    const total = Math.floor(Math.max(0, ms) / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return [h, m, s].map(v => String(v).padStart(2, "0")).join(":");
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Data indisponível";

    return new Intl.DateTimeFormat("pt-PT", {
      timeZone: TIME_ZONE,
      day: "2-digit",
      month: "short",
      year: "numeric"
    }).format(date);
  }

  function pace(distance, duration) {
    if (!distance || distance <= 0) return "--:--";
    const seconds = Math.floor(duration / 1000 / distance);
    return String(Math.floor(seconds / 60)).padStart(2, "0") +
      ":" + String(seconds % 60).padStart(2, "0");
  }

  function show(id, value, fallback) {
    const element = $(id);
    if (element) element.textContent =
      value && String(value).trim() ? String(value).trim() : fallback;
  }

  function initials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "AT";
    return parts.length === 1
      ? parts[0].slice(0, 2).toUpperCase()
      : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function renderAccount() {
    const profile = read(PROFILE_KEY, {});
    const fields = profile.fields || {};
    const name = fields.name || "";

    show("account-name", name, "Meu Perfil");
    show("account-full-name", name, "Ainda não preenchido");
    show("account-phone", fields.phone, "Ainda não preenchido");
    show("account-city", fields.city, "Ainda não preenchida");
    show("account-province", fields.province, "Ainda não preenchida");

    let birth = "Não indicada";
    if (fields.birthDate) {
      const date = new Date(fields.birthDate + "T00:00:00");
      if (!Number.isNaN(date.getTime())) {
        birth = new Intl.DateTimeFormat("pt-PT", {
          day: "2-digit", month: "long", year: "numeric"
        }).format(date);
      }
    }
    show("account-birth", birth, "Não indicada");

    const avatar = $("account-avatar");
    if (avatar) avatar.textContent = initials(name);

    show("account-level", fields.level, "Não definido");
    show("account-weight", fields.weight ? fields.weight + " kg" : "", "Não indicado");
    show("account-height", fields.height ? fields.height + " cm" : "", "Não indicada");

    const objectives = Array.isArray(fields.objectives) ? fields.objectives : [];
    const allObjectives = [...objectives];
    if (fields.customObjective) allObjectives.push(fields.customObjective);

    const objectiveList = $("account-objectives");
    if (objectiveList) {
      objectiveList.replaceChildren();
      if (!allObjectives.length) {
        objectiveList.textContent = "Ainda não definiste os teus objectivos.";
      } else {
        allObjectives.forEach(objective => {
          const item = document.createElement("span");
          item.className = "account-objective-tag";
          item.textContent = objective;
          objectiveList.appendChild(item);
        });
      }
    }

    if (!name) {
      show(
        "account-feedback",
        "Ainda não preencheste os teus dados. Abre o Perfil do Atleta para começar.",
        ""
      );
    } else {
      show("account-feedback", "Perfil actualizado neste dispositivo.", "");
    }
  }

  function renderActivity() {
    const history = read(HISTORY_KEY, []);
    const valid = Array.isArray(history) ? history.filter(run =>
      run &&
      Number.isFinite(Number(run.distanceKm)) &&
      Number(run.distanceKm) > 0 &&
      Number.isFinite(Number(run.durationMs)) &&
      Number(run.durationMs) > 0 &&
      run.date &&
      !Number.isNaN(new Date(run.date).getTime())
    ) : [];

    const distance = valid.reduce((sum, run) => sum + Number(run.distanceKm), 0);
    const duration = valid.reduce((sum, run) => sum + Number(run.durationMs), 0);

    show("account-run-count", String(valid.length), "0");
    show("account-total-distance", distance.toFixed(2).replace(".", ",") + " km", "0,00 km");
    show("account-total-duration", formatDuration(duration), "00:00:00");
    show("account-average-pace", pace(distance, duration) + " /km", "--:-- /km");

    const recent = $("account-recent-runs");
    if (!recent) return;

    recent.replaceChildren();

    const latest = [...valid]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 3);

    if (!latest.length) {
      const empty = document.createElement("p");
      empty.className = "account-activity-empty";
      empty.textContent = "Ainda não tens corridas concluídas. A tua primeira conquista começa agora.";
      recent.appendChild(empty);
      return;
    }

    latest.forEach(run => {
      const item = document.createElement("article");
      item.className = "account-recent-run";

      const info = document.createElement("div");
      const distanceLabel = document.createElement("strong");
      distanceLabel.textContent = Number(run.distanceKm).toFixed(2) + " km";

      const dateLabel = document.createElement("small");
      dateLabel.textContent = formatDate(run.date);

      info.append(distanceLabel, dateLabel);

      const durationLabel = document.createElement("span");
      durationLabel.textContent = formatDuration(Number(run.durationMs));

      item.append(info, durationLabel);
      recent.appendChild(item);
    });
  }

  function loadAccount() {
    renderAccount();
    renderActivity();
  }

  loadAccount();
  window.addEventListener("pageshow", loadAccount);
  window.addEventListener("storage", loadAccount);
  window.addEventListener("focus", loadAccount);
})();

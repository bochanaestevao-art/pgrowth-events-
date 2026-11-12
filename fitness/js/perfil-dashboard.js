(() => {
  const PROFILE_KEY = "pgrowth_fitness_athlete_profile_v1";
  const DISMISSED_KEY = "pgrowth_fitness_reminders_dismissed_v1";
  const STARTED_KEY = "pgrowth_fitness_reminders_started_v1";

  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = "css/perfil.css";
  document.head.appendChild(css);

  const profileLink = document.createElement("a");
  profileLink.href = "perfil.html";
  profileLink.className = "fitness-profile-shortcut";
  profileLink.innerHTML = '<span>◎</span> PERFIL DO ATLETA';
  profileLink.setAttribute("aria-label", "Abrir Perfil do Atleta");
  document.body.appendChild(profileLink);

  const reminder = document.createElement("section");
  reminder.className = "fitness-reminder";
  reminder.setAttribute("role", "dialog");
  reminder.setAttribute("aria-live", "polite");
  reminder.innerHTML = `
    <div class="fitness-reminder-top">
      <span class="fitness-reminder-icon">♧</span>
      <span>LEMBRETE DE TREINO</span>
    </div>
    <div class="fitness-reminder-time"></div>
    <h2>Está na hora de correr!</h2>
    <p>O teu treino está programado. Prepara-te para cumprir o teu objectivo.</p>
    <button type="button" class="fitness-reminder-start">COMEÇAR CORRIDA</button>
    <button type="button" class="fitness-reminder-cancel">CANCELAR</button>
  `;
  reminder.hidden = true;
  document.body.appendChild(reminder);

  const timeLabel = reminder.querySelector(".fitness-reminder-time");
  const startButton = reminder.querySelector(".fitness-reminder-start");
  const cancelButton = reminder.querySelector(".fitness-reminder-cancel");

  let activeReminderKey = null;

  function read(key) {
    try { return JSON.parse(localStorage.getItem(key) || "{}"); }
    catch { return {}; }
  }

  function maputoNow() {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Maputo",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(new Date());

    return Object.fromEntries(parts.map(part => [part.type, part.value]));
  }

  function checkReminder() {
    const profile = read(PROFILE_KEY);
    if (!profile.fields || !profile.fields.remindersEnabled || !profile.schedule) {
      reminder.hidden = true;
      activeReminderKey = null;
      return;
    }

    const now = maputoNow();
    const days = { Sun: "0", Mon: "1", Tue: "2", Wed: "3", Thu: "4", Fri: "5", Sat: "6" };
    const day = days[now.weekday];
    const plannedTime = profile.schedule[day];

    if (!plannedTime) {
      reminder.hidden = true;
      activeReminderKey = null;
      return;
    }

    const currentMinutes = Number(now.hour) * 60 + Number(now.minute);
    const [hour, minute] = plannedTime.split(":").map(Number);
    const plannedMinutes = hour * 60 + minute;

    // O lembrete pode aparecer durante os 60 minutos seguintes à hora programada.
    if (currentMinutes < plannedMinutes || currentMinutes >= plannedMinutes + 60) {
      reminder.hidden = true;
      activeReminderKey = null;
      return;
    }

    const dateKey = `${now.year}-${now.month}-${now.day}`;
    const key = `${dateKey}-${day}-${plannedTime}`;
    const dismissed = read(DISMISSED_KEY);
    const started = read(STARTED_KEY);

    if (dismissed[key] || started[key]) {
      reminder.hidden = true;
      activeReminderKey = null;
      return;
    }

    activeReminderKey = key;
    timeLabel.textContent = plannedTime;
    reminder.hidden = false;
  }

  function closeReminder(storageKey) {
    if (activeReminderKey) {
      const data = read(storageKey);
      data[activeReminderKey] = true;
      try { localStorage.setItem(storageKey, JSON.stringify(data)); } catch {}
    }
    reminder.hidden = true;
    activeReminderKey = null;
  }

  startButton.addEventListener("click", () => {
    closeReminder(STARTED_KEY);
    window.location.href = "corrida.html";
  });

  cancelButton.addEventListener("click", () => {
    closeReminder(DISMISSED_KEY);
  });

  checkReminder();
  window.setInterval(checkReminder, 15000);
  window.addEventListener("focus", checkReminder);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) checkReminder();
  });
})();



/* PGROWTH FITNESS — RESUMO DINÂMICO DO ATLETA */
(() => {
  "use strict";

  const PROFILE_KEY = "pgrowth_fitness_athlete_profile_v1";
  const HISTORY_KEY = "pgrowth_fitness_run_history_v1";

  const style = document.createElement("style");
  style.textContent = `
    .fitness-live-summary {
      margin: 24px auto;
      padding: 22px;
      width: min(1100px, calc(100% - 32px));
      border: 1px solid rgba(150,255,80,.22);
      border-radius: 20px;
      background: linear-gradient(135deg,#101810,#080b08);
      color: #fff;
      box-sizing: border-box;
    }
    .fitness-live-summary .summary-eyebrow {
      color: #a8ff60;
      font-size: 10px;
      letter-spacing: 2px;
    }
    .fitness-live-summary h2 {
      margin: 8px 0 18px;
      font-size: clamp(19px,4vw,26px);
    }
    .fitness-live-summary h2 span { color: #a8ff60; }
    .fitness-live-grid {
      display: grid;
      grid-template-columns: repeat(3,minmax(0,1fr));
      gap: 10px;
    }
    .fitness-live-grid div {
      padding: 13px;
      border-radius: 12px;
      background: rgba(255,255,255,.045);
      min-width: 0;
    }
    .fitness-live-grid small {
      display: block;
      color: #9da99e;
      font-size: 9px;
      letter-spacing: 1px;
      margin-bottom: 8px;
    }
    .fitness-live-grid strong {
      color: #a8ff60;
      font-size: clamp(16px,4vw,23px);
      overflow-wrap: anywhere;
    }
    .fitness-live-summary a {
      display: inline-block;
      margin-top: 17px;
      color: #a8ff60;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 1px;
      text-decoration: none;
    }
    @media(max-width:480px) {
      .fitness-live-summary { padding: 17px; }
      .fitness-live-grid { gap: 7px; }
      .fitness-live-grid div { padding: 10px 8px; }
    }
  `;
  document.head.appendChild(style);

  const panel = document.createElement("section");
  panel.className = "fitness-live-summary";
  panel.innerHTML = `
    <span class="summary-eyebrow">O TEU DESEMPENHO</span>
    <h2>Bem-vindo, <span id="fitness-summary-name">Atleta</span></h2>
    <div class="fitness-live-grid">
      <div><small>CORRIDAS</small><strong id="fitness-summary-runs">0</strong></div>
      <div><small>QUILÓMETROS</small><strong id="fitness-summary-distance">0,00</strong></div>
      <div><small>MELHOR CORRIDA</small><strong id="fitness-summary-best">0,00 km</strong></div>
    </div>
    <a href="meu-perfil.html">CONSULTAR O MEU PROGRESSO →</a>
  `;

  const featureGrid = document.querySelector(".features");
  if (featureGrid) featureGrid.insertAdjacentElement("afterend", panel);

  function read(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)) ?? fallback;
    } catch {
      return fallback;
    }
  }

  function refresh() {
    const profile = read(PROFILE_KEY, {});
    const fields = profile.fields || {};
    const history = read(HISTORY_KEY, []);
    const runs = Array.isArray(history) ? history.filter(run =>
      run &&
      Number.isFinite(Number(run.distanceKm)) &&
      Number(run.distanceKm) > 0 &&
      Number.isFinite(Number(run.durationMs)) &&
      Number(run.durationMs) > 0
    ) : [];

    const distance = runs.reduce((sum, run) => sum + Number(run.distanceKm), 0);
    const best = runs.reduce((max, run) => Math.max(max, Number(run.distanceKm)), 0);

    const name = document.getElementById("fitness-summary-name");
    const count = document.getElementById("fitness-summary-runs");
    const total = document.getElementById("fitness-summary-distance");
    const record = document.getElementById("fitness-summary-best");

    if (name) name.textContent = fields.name || "Atleta";
    if (count) count.textContent = String(runs.length);
    if (total) total.textContent = distance.toFixed(2).replace(".", ",");
    if (record) record.textContent = best.toFixed(2) + " km";
  }

  if (featureGrid) {
    refresh();
    window.addEventListener("pageshow", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    window.setInterval(refresh, 15000);
  }
})();

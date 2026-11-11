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



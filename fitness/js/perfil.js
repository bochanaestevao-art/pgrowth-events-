(() => {
  const STORAGE_KEY = "pgrowth_fitness_athlete_profile_v1";
  const form = document.getElementById("athlete-profile-form");
  const feedback = document.getElementById("profile-feedback");
  if (!form) return;

  const dayRows = [...document.querySelectorAll(".training-day")];

  dayRows.forEach(row => {
    const checkbox = row.querySelector('input[type="checkbox"]');
    const time = row.querySelector('input[type="time"]');
    checkbox.addEventListener("change", () => {
      time.disabled = !checkbox.checked;
      if (checkbox.checked && !time.value) time.value = "06:00";
      if (!checkbox.checked) time.value = "";
    });
  });

  function getProfile() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch {
      return null;
    }
  }

  function loadProfile() {
    const data = getProfile();
    if (!data) return;

    for (const [name, value] of Object.entries(data.fields || {})) {
      if (name === "objectives") {
        form.querySelectorAll('[name="objectives"]').forEach(input => {
          input.checked = value.includes(input.value);
        });
      } else {
        const input = form.elements.namedItem(name);
        if (input && input.type !== "checkbox") input.value = value ?? "";
        if (input && input.type === "checkbox") input.checked = Boolean(value);
      }
    }

    for (const row of dayRows) {
      const day = row.dataset.day;
      const saved = data.schedule?.[day];
      const checkbox = row.querySelector('input[type="checkbox"]');
      const time = row.querySelector('input[type="time"]');
      checkbox.checked = Boolean(saved);
      time.disabled = !saved;
      time.value = saved || "";
    }
  }

  form.addEventListener("submit", event => {
    event.preventDefault();

    const fields = {};
    for (const element of [...form.elements]) {
      if (!element.name || element.name === "objectives" || element.name === "remindersEnabled" || element.name === "soundEnabled") continue;
      if (element.type !== "submit") fields[element.name] = element.value.trim();
    }

    fields.objectives = [...form.querySelectorAll('[name="objectives"]:checked')].map(input => input.value);
    fields.remindersEnabled = form.elements.remindersEnabled.checked;
    fields.soundEnabled = form.elements.soundEnabled.checked;

    const schedule = {};
    for (const row of dayRows) {
      const day = row.dataset.day;
      const checkbox = row.querySelector('input[type="checkbox"]');
      const time = row.querySelector('input[type="time"]');
      if (checkbox.checked) {
        if (!time.value) {
          feedback.textContent = "Define a hora para todos os dias seleccionados.";
          time.focus();
          return;
        }
        schedule[day] = time.value;
      }
    }

    if (Object.keys(schedule).length === 0) {
      fields.remindersEnabled = false;
    }

    const profile = {
      fields,
      schedule,
      updatedAt: new Date().toISOString(),
      timezone: "Africa/Maputo"
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
      feedback.textContent = "Perfil guardado com sucesso neste dispositivo.";
    } catch {
      feedback.textContent = "Não foi possível guardar. Verifica o espaço disponível no navegador.";
    }
  });

  loadProfile();
})();

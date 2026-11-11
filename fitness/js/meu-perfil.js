(() => {
  "use strict";

  const PROFILE_KEY = "pgrowth_fitness_athlete_profile_v1";

  function readProfile() {
    try {
      const saved = localStorage.getItem(PROFILE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch (error) {
      console.error("Não foi possível ler o perfil:", error);
      return {};
    }
  }

  function show(id, value, fallback) {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = value && String(value).trim()
        ? String(value).trim()
        : fallback;
    }
  }

  function initials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "AT";
    return parts.length === 1
      ? parts[0].slice(0, 2).toUpperCase()
      : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function loadAccount() {
    const profile = readProfile();
    const fields = profile.fields || {};
    const name = fields.name || "";

    show("account-name", name, "Meu Perfil");
    show("account-full-name", name, "Ainda não preenchido");
    show("account-phone", fields.phone, "Ainda não preenchido");
    show("account-city", fields.city, "Ainda não preenchida");
    show("account-province", fields.province, "Ainda não preenchida");

    let birthDate = "Não indicada";
    if (fields.birthDate) {
      const date = new Date(fields.birthDate + "T00:00:00");
      if (!Number.isNaN(date.getTime())) {
        birthDate = new Intl.DateTimeFormat("pt-PT", {
          day: "2-digit",
          month: "long",
          year: "numeric"
        }).format(date);
      }
    }
    show("account-birth", birthDate, "Não indicada");

    const avatar = document.getElementById("account-avatar");
    if (avatar) avatar.textContent = initials(name);

    if (!name) {
      show(
        "account-feedback",
        "Ainda não preencheste os teus dados. Abre o Perfil do Atleta para começar.",
        ""
      );
    }
  }

  loadAccount();
  window.addEventListener("pageshow", loadAccount);
})();

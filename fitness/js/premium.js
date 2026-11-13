const API = "https:" + "/" + "/" + "pgrowth-events-fitness-api.vercel.app/api/premium";
const $ = (selector) => document.querySelector(selector);
const state = { data: null, lastReply: "", selectedAthlete: null, token: "" };

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 3200);
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[char]);
}

function dateText(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("pt-MZ");
}

async function getToken() {
  if (!window.PGrowthSession?.token) throw new Error("Sessão não encontrada. Inicia sessão novamente.");
  const token = await window.PGrowthSession.token();
  if (!token) throw new Error("A tua sessão expirou. Inicia sessão novamente.");
  return token;
}

async function request(action, method = "GET", payload = {}) {
  const token = await getToken();
  const options = {
    method,
    headers: { Authorization: `Bearer ${token}` }
  };
  const [actionName, extraParams] = action.split("&");
  let url = `${API}?action=${encodeURIComponent(actionName)}${extraParams ? "&" + extraParams : ""}`;
  if (method === "POST") {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify({ action, ...payload });
    url = API;
  }
  const response = await fetch(url, options);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Não foi possível concluir a operação.");
  return result;
}

function showEmpty(container, message) {
  container.innerHTML = `<div class="empty-state">${escapeHTML(message)}</div>`;
}

function renderCards(container, items, empty, render) {
  if (!Array.isArray(items) || !items.length) return showEmpty(container, empty);
  container.innerHTML = items.map(render).join("");
}

function renderOverview(data) {
  state.data = data;
  $("#loading").classList.add("hidden");
  $("#passStatus").textContent = data.activePass ? "PASSE COMPLETO ACTIVO" : "PASSE COMPLETO NÃO ACTIVO";

  if (data.role === "COACH" || data.role === "ADMIN") {
    $("#coachArea").classList.remove("hidden");
    $("#coachRole").textContent = data.role === "ADMIN" ? "ADMINISTRADOR" : "TREINADOR";
    if (data.role === "ADMIN") $("#adminTools").classList.remove("hidden");
    loadCoachAthletes();
    loadManagementData();
    return;
  }

  if (!data.activePass) {
    $("#lockedBox").classList.remove("hidden");
    return;
  }

  $("#athleteArea").classList.remove("hidden");
  $("#athleteRole").textContent = "ATLETA PREMIUM";

  renderCards($("#nutritionList"), data.nutritionPlans, "Ainda não tens um plano de nutrição atribuído. O teu profissional poderá disponibilizá-lo aqui.", item => `
    <article class="info-card"><h3>${escapeHTML(item.title)}</h3><p>${escapeHTML(item.description || "")}</p><p>${formatContent(item.content)}</p><small class="card-meta">Plano profissional</small></article>`);

  renderCards($("#workoutList"), data.workoutPlans, "Ainda não tens um plano de treino atribuído.", item => `
    <article class="info-card"><h3>${escapeHTML(item.title)}</h3><p>${escapeHTML(item.description || "")}</p><p>${formatContent(item.content)}</p><small class="card-meta">Plano de treino</small></article>`);

  renderCards($("#tipsList"), data.tips, "As próximas dicas CT GULERA serão apresentadas aqui.", item => `
    <article class="info-card"><small class="card-meta">${escapeHTML(item.category || "DICA CT GULERA")}</small><h3>${escapeHTML(item.title)}</h3><p>${escapeHTML(item.content)}</p></article>`);

  renderTimeline($("#checkinsList"), data.checkins, item => `
    <article class="timeline-item"><small>${dateText(item.recorded_at)}</small><h3>Registo de evolução</h3><p>${item.weight_kg ? `Peso: ${escapeHTML(item.weight_kg)} kg · ` : ""}${item.height_cm ? `Altura: ${escapeHTML(item.height_cm)} cm · ` : ""}${item.energy_level ? `Energia: ${escapeHTML(item.energy_level)}/10` : ""}</p><p>${escapeHTML(item.mood || "")} ${escapeHTML(item.notes || "")}</p></article>`);

  renderTimeline($("#supportMessages"), data.messages, item => `
    <article class="timeline-item"><small>${escapeHTML(item.sender_role)} · ${dateText(item.created_at)}</small><p>${escapeHTML(item.message)}</p></article>`);

  renderCards($("#questionsList"), data.questions, "Ainda não enviaste perguntas ao treinador.", item => `
    <article class="info-card"><small class="card-meta">${escapeHTML(item.status || "OPEN")}</small><h3>${escapeHTML(item.subject)}</h3><p>${escapeHTML(item.question)}</p></article>`);

  renderTimeline($("#announcementsList"), data.announcements, item => `
    <article class="announcement"><strong>${escapeHTML(item.title)}</strong><p>${escapeHTML(item.message)}</p></article>`);

  renderChat(data.messages);
}

function formatContent(content) {
  if (!content) return "";
  if (typeof content === "string") return escapeHTML(content);
  if (Array.isArray(content)) return content.map(x => `<p>${escapeHTML(typeof x === "string" ? x : JSON.stringify(x))}</p>`).join("");
  return Object.entries(content).map(([key, value]) => `<p><strong>${escapeHTML(key)}:</strong> ${escapeHTML(typeof value === "object" ? JSON.stringify(value) : value)}</p>`).join("");
}

function renderTimeline(container, items, render) {
  if (!Array.isArray(items) || !items.length) return showEmpty(container, "Ainda não existem registos.");
  container.innerHTML = items.map(render).join("");
}

function renderChat(messages) {
  const box = $("#chatMessages");
  box.innerHTML = "";
  (messages || []).forEach(item => {
    const bubble = document.createElement("div");
    bubble.className = `chat-bubble ${item.sender_role === "ATHLETE" ? "mine" : ""}`;
    bubble.innerHTML = `${escapeHTML(item.message)}<small>${escapeHTML(item.sender_role)} · ${dateText(item.created_at)}</small>`;
    box.appendChild(bubble);
    if (item.sender_role !== "ATHLETE" && !item.read_at) {
      request("mark-read", "POST", { messageId: item.id }).catch(() => {});
    }
    if (item.sender_role !== "ATHLETE") state.lastReply = item.message;
  });
  box.scrollTop = box.scrollHeight;
}

async function loadCoachAthletes() {
  try {
    const result = await request("coach-athletes");
    const list = $("#coachAthletes");
    if (!result.assignments?.length) return showEmpty(list, "Ainda não existem atletas atribuídos a este treinador.");
    list.innerHTML = result.assignments.map(item => `
      <button class="athlete-choice" data-athlete="${escapeHTML(item.athlete_id)}" data-name="${escapeHTML(item.athlete_name || "Atleta")}">
        ${escapeHTML(item.athlete_name || "Atleta")}
      </button>`).join("");
    list.querySelectorAll("[data-athlete]").forEach(button => {
      button.addEventListener("click", () => selectAthlete(button.dataset.athlete, button));
    });
  } catch (error) {
    showEmpty($("#coachAthletes"), error.message);
  }
}

async function loadManagementData() {
  try {
    const data = await request("management-data");
    const box = $("#managementContent");


    const plans = [
      ...(data.nutritionPlans || []).map(p => ({...p, kind:"NUTRIÇÃO"})),
      ...(data.workoutPlans || []).map(p => ({...p, kind:"TREINO"}))
    ];

    const fillSelect = (formId, fieldName, items, placeholder, labelFor, valueFor = item => item.id) => {
      const select = document.querySelector("#" + formId + ' [name="' + fieldName + '"]');
      if (!select) return;
      const current = select.value;
      select.innerHTML = '<option value="">' + escapeHTML(placeholder) + '</option>' +
        items.map(item => '<option value="' + escapeHTML(valueFor(item)) + '">' +
          escapeHTML(labelFor(item)) + '</option>').join("");
      if (items.some(item => valueFor(item) === current)) select.value = current;
    };

    fillSelect("manageCoachForm", "userId", data.users || [], "Selecciona uma conta...", item => item.name);
    fillSelect("assignPlanForm", "athleteId", data.athletes || [], "Selecciona um atleta...", item => item.name);
    fillSelect("assignCoachForm", "athleteId", data.athletes || [], "Selecciona um atleta...", item => item.name);
    fillSelect("assignCoachForm", "coachUserId", (data.coaches || []).filter(item => item.active), "Selecciona um treinador...", item => item.display_name || "Treinador", item => item.user_id);

    const planForm = $("#assignPlanForm");
    const typeSelect = planForm?.elements.type;
    const planSelect = planForm?.elements.planId;

    if (typeSelect && planSelect) {
      const updatePlanOptions = () => {
        const available = typeSelect.value === "nutrition"
          ? data.nutritionPlans || []
          : data.workoutPlans || [];
        const previous = planSelect.value;
        planSelect.innerHTML = '<option value="">Selecciona um plano...</option>' +
          available.filter(item => item.status === "PUBLISHED").map(item =>
            '<option value="' + escapeHTML(item.id) + '">' +
            escapeHTML(item.title) + '</option>'
          ).join("");
        if (available.some(item => item.id === previous && item.status === "PUBLISHED")) {
          planSelect.value = previous;
        }
      };
      typeSelect.onchange = updatePlanOptions;
      updatePlanOptions();
    }

    const planHTML = plans.length
      ? plans.map(p => `<article class="timeline-item">
          <strong>${escapeHTML(p.kind)} · ${escapeHTML(p.title)}</strong>
          <p>${escapeHTML(p.status)} · ID: <code>${escapeHTML(p.id)}</code></p>
        </article>`).join("")
      : "<p class='section-intro'>Ainda não existem planos.</p>";

    const coachHTML = data.coaches?.length
      ? data.coaches.map(c => `<article class="timeline-item">
          <strong>${escapeHTML(c.display_name || "Treinador")}</strong>
          <p>${c.active ? "ACTIVO" : "INACTIVO"} · UUID: <code>${escapeHTML(c.user_id)}</code></p>
        </article>`).join("")
      : "";

    const tipHTML = data.tips?.length
      ? data.tips.map(t => `<article class="timeline-item">
          <strong>${escapeHTML(t.title)}</strong>
          <p>${escapeHTML(t.category || "DICA")} · ${escapeHTML(t.status)}</p>
        </article>`).join("")
      : "";

    box.innerHTML = "<h4>Planos disponíveis</h4>" + planHTML +
      (data.coaches ? "<h4>Treinadores registados</h4>" + coachHTML : "") +
      "<h4>Dicas publicadas ou guardadas</h4>" +
      (tipHTML || "<p class='section-intro'>Ainda não existem dicas.</p>");
  } catch (error) {
    $("#managementContent").textContent = error.message;
  }
}

async function selectAthlete(athleteId, button) {
  state.selectedAthlete = athleteId;
  document.querySelectorAll(".athlete-choice").forEach(el => el.classList.remove("active"));
  button.classList.add("active");
  $("#selectedAthlete").textContent = `Atleta seleccionado: ${button.dataset.name || "Atleta"}`;
  $("#coachReplyForm").classList.add("hidden");
  $("#coachMessageForm").classList.remove("hidden");
  $("#coachMessageForm").elements.athleteId?.remove();
  try {
    const data = await request(`athlete-history&athleteId=${encodeURIComponent(athleteId)}`);
    const history = $("#coachHistory");
    history.innerHTML = "";
    const questions = data.questions || [];
    const messages = data.messages || [];
    const checkins = data.checkins || [];
    history.innerHTML = `<h4>Perguntas (${questions.length})</h4>` +
      (questions.length ? questions.map(q => `
        <article class="timeline-item">
          <small>${escapeHTML(q.status)} · ${dateText(q.created_at)}</small>
          <h3>${escapeHTML(q.subject)}</h3><p>${escapeHTML(q.question)}</p>
          <button class="secondary-button" data-question="${escapeHTML(q.id)}">RESPONDER</button>
        </article>`).join("") : `<p class="section-intro">Sem perguntas.</p>`) +
      `<h4>Mensagens (${messages.length})</h4>` +
      messages.map(m => `<article class="timeline-item"><small>${escapeHTML(m.sender_role)} · ${dateText(m.created_at)}</small><p>${escapeHTML(m.message)}</p></article>`).join("") +
      `<h4>Registos de evolução (${checkins.length})</h4>` +
      checkins.map(c => `<article class="timeline-item"><small>${dateText(c.recorded_at)}</small><p>${c.weight_kg ? `Peso: ${escapeHTML(c.weight_kg)} kg · ` : ""}${c.energy_level ? `Energia: ${escapeHTML(c.energy_level)}/10` : ""}</p><p>${escapeHTML(c.notes || "")}</p></article>`).join("");
    history.querySelectorAll("[data-question]").forEach(btn => btn.addEventListener("click", () => {
      $("#coachReplyForm").classList.remove("hidden");
      $("#coachReplyForm").elements.athleteId.value = athleteId;
      $("#coachReplyForm").elements.questionId.value = btn.dataset.question;
      $("#coachReplyForm").scrollIntoView({ behavior: "smooth", block: "center" });
    }));
  } catch (error) {
    $("#coachHistory").textContent = error.message;
  }
}

document.querySelectorAll(".tab").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(tab => tab.classList.toggle("active", tab === button));
    document.querySelectorAll(".content-section").forEach(section => section.classList.toggle("active", section.id === `section-${button.dataset.section}`));
  });
});

$("#checkinForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  ["weightKg", "heightCm", "energyLevel"].forEach(key => {
    if (values[key] === "") delete values[key];
    else if (values[key] !== undefined) values[key] = Number(values[key]);
  });
  try {
    await request("checkin", "POST", values);
    toast("Registo guardado com sucesso.");
    form.reset();
    const fresh = await request("overview");
    renderOverview(fresh);
    document.querySelector('[data-section="progress"]').click();
  } catch (error) { toast(error.message); }
});

$("#chatForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = form.elements.message.value.trim();
  if (!message) return;
  try {
    const result = await request("message", "POST", { message });
    form.reset();
    const fresh = await request("overview");
    renderOverview(fresh);
    document.querySelector('[data-section="chat"]').click();
    if (typeof result.automaticReply === "string") state.lastReply = result.automaticReply;
    else if (result.automaticReply?.message) state.lastReply = result.automaticReply.message;
    toast("Mensagem enviada ao CT GULERA.");
  } catch (error) { toast(error.message); }
});

$("#questionForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await request("ask-coach", "POST", {
      subject: form.elements.subject.value.trim(),
      question: form.elements.question.value.trim()
    });
    form.reset();
    toast("Pergunta enviada ao treinador.");
    renderOverview(await request("overview"));
    document.querySelector('[data-section="support"]').click();
  } catch (error) { toast(error.message); }
});

$("#coachReplyForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await request("reply-question", "POST", {
      athleteId: form.elements.athleteId.value,
      questionId: form.elements.questionId.value,
      reply: form.elements.reply.value.trim()
    });
    form.reset();
    form.classList.add("hidden");
    toast("Resposta enviada ao atleta.");
    const button = document.querySelector(".athlete-choice.active");
    if (button) await selectAthlete(state.selectedAthlete, button);
  } catch (error) { toast(error.message); }
});

$("#coachMessageForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!state.selectedAthlete) return toast("Selecciona primeiro um atleta.");
  const form = event.currentTarget;
  try {
    await request("coach-message", "POST", {
      athleteId: state.selectedAthlete,
      message: form.elements.message.value.trim()
    });
    form.reset();
    toast("Mensagem privada enviada.");
  } catch (error) { toast(error.message); }
});

$("#planForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const content = JSON.parse(form.elements.content.value);
    if (!content || typeof content !== "object") {
      throw new Error("O conteúdo do plano deve ser um objecto ou lista JSON.");
    }
    await request("save-content", "POST", {
      type: form.elements.type.value,
      title: form.elements.title.value.trim(),
      description: form.elements.description.value.trim(),
      content,
      status: form.elements.status.value
    });
    form.reset();
    form.elements.content.value = "{}";
    toast("Plano guardado com sucesso.");
    await loadManagementData();
  } catch (error) {
    toast(error instanceof SyntaxError ? "O conteúdo JSON não é válido." : error.message);
  }
});

$("#tipForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await request("publish-tip", "POST", {
      title: form.elements.title.value.trim(),
      category: form.elements.category.value.trim(),
      content: form.elements.content.value.trim(),
      status: "PUBLISHED"
    });
    form.reset();
    toast("Dica publicada.");
    await loadManagementData();
  } catch (error) { toast(error.message); }
});

$("#manageCoachForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await request("manage-coach", "POST", {
      userId: form.elements.userId.value.trim(),
      displayName: form.elements.displayName.value.trim(),
      active: form.elements.active.value === "true"
    });
    form.reset();
    toast("Registo do treinador actualizado.");
    await loadManagementData();
  } catch (error) { toast(error.message); }
});

$("#assignPlanForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await request("assign-plan", "POST", {
      athleteId: form.elements.athleteId.value.trim(),
      type: form.elements.type.value,
      planId: form.elements.planId.value.trim(),
      notes: form.elements.notes.value.trim()
    });
    form.reset();
    toast("Plano atribuído ao atleta.");
  } catch (error) { toast(error.message); }
});

$("#assignCoachForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await request("assign-coach", "POST", {
      athleteId: form.elements.athleteId.value.trim(),
      coachUserId: form.elements.coachUserId.value.trim()
    });
    form.reset();
    toast("Treinador atribuído ao atleta.");
    await loadCoachAthletes();
  } catch (error) { toast(error.message); }
});

$("#broadcastForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await request("broadcast", "POST", {
      title: form.elements.title.value.trim(),
      message: form.elements.message.value.trim()
    });
    form.reset();
    toast("Comunicado publicado.");
  } catch (error) { toast(error.message); }
});

$("#speakLast").addEventListener("click", async () => {
  if (!state.lastReply) return toast("Ainda não existe uma resposta para ouvir.");
  const button = $("#speakLast");
  button.disabled = true;
  button.textContent = "A preparar voz...";
  try {
    const { TtsSession } = await import("../assets/ct-gulera-voice/ct-gulera-piper.js");
    const session = await TtsSession.create({ voiceId: "pt_PT-tugão-medium" });
    const audioBlob = await session.predict(state.lastReply);
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);
    audio.onended = () => URL.revokeObjectURL(audioUrl);
    audio.onerror = () => URL.revokeObjectURL(audioUrl);
    await audio.play();
  } catch (error) {
    toast("Não foi possível iniciar a voz neste dispositivo.");
  } finally {
    button.disabled = false;
    button.textContent = "🔊 Ouvir última resposta";
  }
});

async function start() {
  try {
    await getToken();
    const data = await request("overview");
    renderOverview(data);
  } catch (error) {
    $("#loading").classList.add("hidden");
    if (/sessão|inicia sessão/i.test(error.message)) {
      window.location.href = "acesso.html";
      return;
    }
    $("#errorBox").textContent = error.message;
    $("#errorBox").classList.remove("hidden");
  }
}

start();

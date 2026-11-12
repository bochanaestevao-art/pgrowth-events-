(() => {
  "use strict";

  const STORAGE = "pgrowth_fitness_challenges_v1";
  const RUNS = "pgrowth_fitness_run_history_v1";
  const API = "https://pgrowth-events-fitness-api.vercel.app/api/challenges";

  const definitions = [
    {id:"run-1k",category:"corrida",title:"Primeiro quilómetro",desc:"Completa uma corrida de pelo menos 1 quilómetro.",target:1,unit:"km",kind:"run-best",symbol:"1 KM"},
    {id:"run-5k",category:"corrida",title:"Desafio 5 KM",desc:"Completa uma corrida de 5 quilómetros.",target:5,unit:"km",kind:"run-best",symbol:"5 KM"},
    {id:"run-10k",category:"corrida",title:"Desafio 10 KM",desc:"Completa uma corrida de 10 quilómetros.",target:10,unit:"km",kind:"run-best",symbol:"10 KM"},
    {id:"run-week25",category:"corrida",title:"Semana de 25 KM",desc:"Acumula 25 quilómetros numa semana.",target:25,unit:"km",kind:"run-week",symbol:"25 KM"},
    {id:"run-month100",category:"corrida",title:"100 KM no mês",desc:"Acumula 100 quilómetros durante o mês.",target:100,unit:"km",kind:"run-month",symbol:"100 KM"},
    {id:"end-15",category:"resistencia",title:"Resistência inicial",desc:"Completa 15 minutos de actividade contínua.",target:15,unit:"min",kind:"manual",symbol:"15 MIN"},
    {id:"end-30",category:"resistencia",title:"30 minutos sem parar",desc:"Regista uma sessão contínua de 30 minutos.",target:30,unit:"min",kind:"manual",symbol:"30 MIN"},
    {id:"end-45",category:"resistencia",title:"Desafio 45 minutos",desc:"Acumula 45 minutos de resistência.",target:45,unit:"min",kind:"manual",symbol:"45 MIN"},
    {id:"end-5days",category:"resistencia",title:"Consistência de 5 dias",desc:"Regista cinco sessões de treino em dias diferentes.",target:5,unit:"sessões",kind:"manual",symbol:"5 DIAS"},
    {id:"str-push",category:"forca",title:"20 flexões",desc:"Completa 20 flexões com técnica adequada.",target:20,unit:"reps",kind:"manual",symbol:"PUSH"},
    {id:"str-squat",category:"forca",title:"50 agachamentos",desc:"Completa 50 agachamentos.",target:50,unit:"reps",kind:"manual",symbol:"SQUAT"},
    {id:"str-abs",category:"forca",title:"30 abdominais",desc:"Completa 30 repetições de abdominais.",target:30,unit:"reps",kind:"manual",symbol:"ABS"},
    {id:"str-plank",category:"forca",title:"Prancha de 60 segundos",desc:"Mantém a posição de prancha durante 60 segundos.",target:60,unit:"seg",kind:"manual",symbol:"PLANK"},
    {id:"ex-sets",category:"exercicios",title:"Três séries completas",desc:"Regista três séries de um exercício.",target:3,unit:"séries",kind:"manual",symbol:"3 SET"},
    {id:"ex-100",category:"exercicios",title:"100 repetições",desc:"Acumula 100 repetições de exercícios.",target:100,unit:"reps",kind:"manual",symbol:"100"},
    {id:"ex-4sessions",category:"exercicios",title:"Quatro sessões",desc:"Completa quatro sessões de exercício.",target:4,unit:"sessões",kind:"manual",symbol:"4X"},
    {id:"cardio-15",category:"cardio",title:"Cardio 15 minutos",desc:"Regista 15 minutos de actividade cardiovascular.",target:15,unit:"min",kind:"manual",symbol:"15 MIN"},
    {id:"cardio-30",category:"cardio",title:"Cardio 30 minutos",desc:"Regista 30 minutos de actividade cardiovascular.",target:30,unit:"min",kind:"manual",symbol:"30 MIN"},
    {id:"cardio-3",category:"cardio",title:"Três sessões de cardio",desc:"Completa três sessões de cardio.",target:3,unit:"sessões",kind:"manual",symbol:"3X"},
    {id:"cardio-120",category:"cardio",title:"120 minutos semanais",desc:"Acumula 120 minutos de cardio.",target:120,unit:"min",kind:"manual",symbol:"120"}
  ];

  const labels = {
    corrida:"Corrida",
    resistencia:"Resistência",
    forca:"Força",
    exercicios:"Exercícios",
    cardio:"Cardio"
  };

  let data = loadLocal();
  let filter = "todos";
  let syncTimer = null;
  let syncBusy = false;
  let syncPending = false;
  let syncMessage = "Dados guardados neste dispositivo";
  let cloudReady = false;

  function loadLocal() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE) || "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  function makeId() {
    return window.crypto?.randomUUID
      ? crypto.randomUUID()
      : "challenge-" + Date.now() + "-" + Math.random().toString(36).slice(2,8);
  }

  function saveData() {
    localStorage.setItem(STORAGE, JSON.stringify(data));
    syncMessage = cloudReady ? "A guardar na tua conta…" : "Guardado neste dispositivo";
    updateSyncStatus();
    scheduleCloudSave();
  }

  function stateFor(challenge) {
    if (!data[challenge.id]) {
      data[challenge.id] = {
        target:challenge.target,
        startedAt:new Date().toISOString(),
        value:0,
        logs:[],
        attempts:[],
        completedAt:null
      };
    }

    const state = data[challenge.id];
    if (!Array.isArray(state.logs)) state.logs = [];
    if (!Array.isArray(state.attempts)) state.attempts = [];
    if (!Number.isFinite(Number(state.target)) || Number(state.target) <= 0) {
      state.target = challenge.target;
    }
    return state;
  }

  function readRuns() {
    try {
      const value = JSON.parse(localStorage.getItem(RUNS) || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function dateOf(run) {
    const date = new Date(run.date || run.created_at || 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function startOfWeek(date) {
    const result = new Date(date);
    result.setHours(0,0,0,0);
    result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
    return result;
  }

  function runProgress(challenge, state) {
    const started = new Date(state.startedAt || 0);
    const runs = readRuns().filter(run => {
      const date = dateOf(run);
      return date && date >= started;
    });

    if (challenge.kind === "run-best") {
      return runs.reduce((best, run) =>
        Math.max(best, Number(run.distanceKm) || 0), 0);
    }

    const now = new Date();
    const periodStart = challenge.kind === "run-week"
      ? startOfWeek(now)
      : new Date(now.getFullYear(), now.getMonth(), 1);

    return runs.reduce((sum, run) => {
      const date = dateOf(run);
      if (!date || date < periodStart || date > now) return sum;
      return sum + (Number(run.distanceKm) || 0);
    }, 0);
  }

  function progressFor(challenge, state) {
    return challenge.kind === "manual"
      ? Number(state.value) || 0
      : runProgress(challenge, state);
  }

  function format(value) {
    return Number(value.toFixed(2)).toLocaleString("pt-MZ");
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    })[char]);
  }

  function toast(message) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("show"), 2500);
  }

  function updateSyncStatus() {
    const el = document.getElementById("sync-status");
    if (el) el.textContent = syncMessage;
  }

  async function cloudRequest(method, challengeData) {
    const session = window.PGrowthSession;
    if (!session?.token) throw new Error("Inicia sessão para sincronizar.");

    const token = await session.token();
    const response = await fetch(API, {
      method,
      headers: {
        Authorization:"Bearer " + token,
        ...(method === "POST" ? {"Content-Type":"application/json"} : {})
      },
      ...(method === "POST"
        ? {body:JSON.stringify({challengeData})}
        : {})
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Falha na sincronização.");
    return result;
  }

  async function syncFromCloud() {
    if (!window.PGrowthSession?.read?.()) {
      syncMessage = "Inicia sessão para sincronizar os teus desafios";
      updateSyncStatus();
      return;
    }

    try {
      syncMessage = "A carregar os teus desafios…";
      updateSyncStatus();

      const remote = await cloudRequest("GET");
      const cloud = remote.challengeData?.challenges || {};
      const local = data;
      const cloudHasData = Object.keys(cloud).length > 0;

      if (!cloudHasData && Object.keys(local).length > 0) {
        // Primeira sincronização: importar o progresso antigo.
        data = local;
        cloudReady = true;
        await cloudRequest("POST", {version:1,challenges:data});
      } else {
        // A nuvem prevalece nos desafios existentes; os locais em falta são preservados.
        data = {...local,...cloud};
        cloudReady = true;
        localStorage.setItem(STORAGE, JSON.stringify(data));

        if (Object.keys(local).some(id => !Object.prototype.hasOwnProperty.call(cloud,id))) {
          await cloudRequest("POST", {version:1,challenges:data});
        }
      }

      syncMessage = "Sincronizado com a tua conta";
      updateSyncStatus();
    } catch (error) {
      cloudReady = false;
      syncMessage = "Sincronização indisponível — dados locais preservados";
      updateSyncStatus();
      console.warn("Fitness challenges sync:", error.message);
    }
  }

  function scheduleCloudSave() {
    if (!cloudReady) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(saveCloud, 900);
  }

  async function saveCloud() {
    if (!cloudReady) return;
    if (syncBusy) {
      syncPending = true;
      return;
    }

    syncBusy = true;
    try {
      await cloudRequest("POST", {version:1,challenges:data});
      syncMessage = "Sincronizado com a tua conta";
    } catch (error) {
      syncMessage = "Guardado localmente; sincronização pendente";
      console.warn("Fitness challenges save:", error.message);
    } finally {
      syncBusy = false;
      updateSyncStatus();
      if (syncPending) {
        syncPending = false;
        saveCloud();
      }
    }
  }

  function recordCompletion(challenge, state, current) {
    if (current < Number(state.target) || state.completedAt) return;

    state.completedAt = new Date().toISOString();
    state.attempts.push({
      date:state.completedAt,
      result:current,
      target:Number(state.target),
      unit:challenge.unit,
      status:"Concluído"
    });
    saveData();
  }

  function stats() {
    let active = 0, done = 0, achievements = 0;
    definitions.forEach(challenge => {
      const state = stateFor(challenge);
      const current = progressFor(challenge,state);
      if (current >= Number(state.target)) {
        done++;
        achievements += state.attempts.length || 1;
      } else active++;
    });
    return {active,done,achievements};
  }


  function challengeCopy(challenge, state) {
    const target = format(Number(state.target));
    const unit = challenge.unit;
    let title;
    let desc;

    if (challenge.kind === "run-best") {
      title = "Desafio de " + target + " km";
      desc = "Completa uma corrida de pelo menos " + target + " km.";
    } else if (challenge.kind === "run-week") {
      title = "Meta semanal de " + target + " km";
      desc = "Acumula " + target + " km durante uma semana.";
    } else if (challenge.kind === "run-month") {
      title = "Meta mensal de " + target + " km";
      desc = "Acumula " + target + " km durante o mês.";
    } else if (unit === "min") {
      title = "Meta de " + target + " minutos";
      desc = "Regista " + target + " minutos de actividade.";
    } else if (unit === "reps") {
      title = "Meta de " + target + " repetições";
      desc = "Completa " + target + " repetições neste exercício.";
    } else if (unit === "seg") {
      title = "Meta de " + target + " segundos";
      desc = "Mantém o exercício durante " + target + " segundos.";
    } else if (unit === "sessões") {
      title = "Meta de " + target + " sessões";
      desc = "Completa " + target + " sessões de treino.";
    } else if (unit === "séries") {
      title = "Meta de " + target + " séries";
      desc = "Regista " + target + " séries completas.";
    } else {
      title = "Meta de " + target + " " + unit;
      desc = "Alcança " + target + " " + unit + " neste desafio.";
    }

    return {title, desc};
  }

  function cardHtml(challenge) {
    const state = stateFor(challenge);
    const copy = challengeCopy(challenge,state);
    const current = progressFor(challenge,state);
    recordCompletion(challenge,state,current);

    const target = Number(state.target);
    const percent = Math.min(100,Math.round(current / target * 100));
    const done = current >= target;

    return `
      <a class="challenge ${done ? "done" : ""}" href="desafio.html?id=${encodeURIComponent(challenge.id)}">
        <div class="card-top">
          <span class="symbol">${escapeHtml(challenge.symbol)}</span>
          <span class="tag">${escapeHtml(labels[challenge.category])}</span>
        </div>
        <h3>${escapeHtml(copy.title)}</h3>
        <div class="description">${escapeHtml(copy.desc)}</div>
        <div class="goal-line"><span>PROGRESSO</span><strong>${format(current)} / ${format(target)} ${escapeHtml(challenge.unit)}</strong></div>
        <div class="progress"><span style="width:${percent}%"></span></div>
        <div class="progress-text"><span>${percent}% concluído</span><span>${done ? "Meta alcançada" : "Em progresso"}</span></div>
        <div class="open-challenge">${done ? "VER CONQUISTA" : "ABRIR DESAFIO"} <span>→</span></div>
      </a>`;
  }

  function renderList() {
    const grid = document.getElementById("challenge-grid");
    if (!grid) return;

    const visible = definitions.filter(item =>
      filter === "todos" || item.category === filter
    );
    grid.innerHTML = visible.map(cardHtml).join("");

    const result = stats();
    document.getElementById("active-count").textContent = result.active;
    document.getElementById("done-count").textContent = result.done;
    document.getElementById("achievement-count").textContent = result.achievements;
    updateSyncStatus();
  }

  function renderDetail() {
    const root = document.getElementById("challenge-detail");
    if (!root) return;

    const id = new URLSearchParams(location.search).get("id");
    const challenge = definitions.find(item => item.id === id);

    if (!challenge) {
      root.innerHTML = '<div class="detail-panel"><h2>Desafio não encontrado</h2><a href="desafios.html">Voltar aos desafios</a></div>';
      return;
    }

    const state = stateFor(challenge);
    const copy = challengeCopy(challenge,state);
    const current = progressFor(challenge,state);
    recordCompletion(challenge,state,current);

    const target = Number(state.target);
    const percent = Math.min(100,Math.round(current / target * 100));
    const done = current >= target;
    const logs = state.logs.slice().reverse();
    const attempts = state.attempts.slice().reverse();

    root.innerHTML = `
      <section class="detail-hero ${done ? "completed" : ""}">
        <span class="detail-symbol">${escapeHtml(challenge.symbol)}</span>
        <span class="tag">${escapeHtml(labels[challenge.category])}</span>
        <h1>${escapeHtml(copy.title)}</h1>
        <p>${escapeHtml(copy.desc)}</p>
        <div class="detail-progress-line">
          <strong>${format(current)} <small>/ ${format(target)} ${escapeHtml(challenge.unit)}</small></strong>
          <span>${percent}%</span>
        </div>
        <div class="progress"><span style="width:${percent}%"></span></div>
        <p class="detail-state">${done ? "META ALCANÇADA — PARABÉNS!" : "DESAFIO EM PROGRESSO"}</p>
      </section>

      <section class="detail-panel">
        <h2>A tua meta</h2>
        <p>Personaliza o objectivo deste desafio.</p>
        <form id="target-form" class="detail-form">
          <input id="target-input" type="number" min="0.1" step="any" value="${target}" required>
          <button type="submit">GUARDAR META</button>
        </form>
      </section>

      ${challenge.kind === "manual" ? `
        <section class="detail-panel">
          <h2>Registar actividade</h2>
          <p>Introduz apenas a quantidade que realmente realizaste (${escapeHtml(challenge.unit)}).</p>
          <form id="log-form" class="detail-form">
            <input name="amount" type="number" min="0.01" step="any" placeholder="Quantidade realizada" required>
            <button type="submit">REGISTAR PROGRESSO</button>
          </form>
        </section>
      ` : `
        <section class="detail-panel">
          <h2>Ligação ao Run With Coach</h2>
          <p>O progresso é calculado automaticamente a partir das corridas guardadas neste dispositivo. Guarda as tuas corridas para actualizar este desafio.</p>
          <a class="detail-link" href="corrida.html">ABRIR RUN WITH COACH →</a>
        </section>
      `}

      <section class="detail-panel">
        <h2>Histórico desta tentativa</h2>
        ${logs.length ? `<div class="record-list">${logs.map(item => `
          <div class="record">
            <strong>+${format(Number(item.amount)||0)} ${escapeHtml(item.unit || challenge.unit)}</strong>
            <span>${escapeHtml(new Date(item.date).toLocaleString("pt-MZ"))}</span>
          </div>`).join("")}</div>` : '<p class="empty-detail">Ainda não existem registos nesta tentativa.</p>'}
      </section>

      <section class="detail-panel">
        <h2>Conquistas e tentativas anteriores</h2>
        ${attempts.length ? `<div class="record-list">${attempts.map(item => `
          <div class="record">
            <strong>${escapeHtml(item.status || "Resultado")}: ${format(Number(item.result)||0)} ${escapeHtml(item.unit || challenge.unit)}</strong>
            <span>${escapeHtml(new Date(item.date).toLocaleString("pt-MZ"))} · Meta ${format(Number(item.target)||0)}</span>
          </div>`).join("")}</div>` : '<p class="empty-detail">As tuas conquistas e tentativas aparecerão aqui.</p>'}
      </section>

      <section class="detail-panel">
        <h2>Gerir desafio</h2>
        <p>Reiniciar começa uma nova tentativa. Os resultados anteriores ficam preservados.</p>
        <button type="button" class="reset-button" id="reset-challenge">↻ REINICIAR DESAFIO</button>
      </section>
    `;

    document.getElementById("target-form").addEventListener("submit",event => {
      event.preventDefault();
      const value = Number(document.getElementById("target-input").value);
      if (!Number.isFinite(value) || value <= 0) {
        toast("A meta deve ser superior a zero.");
        return;
      }
      state.target = value;
      state.completedAt = null;
      if (progressFor(challenge,state) >= value) recordCompletion(challenge,state,progressFor(challenge,state));
      saveData();
      renderDetail();
      toast("Meta actualizada.");
    });

    const logForm = document.getElementById("log-form");
    if (logForm) logForm.addEventListener("submit",event => {
      event.preventDefault();
      const amount = Number(new FormData(logForm).get("amount"));
      if (!Number.isFinite(amount) || amount <= 0) {
        toast("Introduz uma quantidade válida.");
        return;
      }
      state.value = (Number(state.value)||0) + amount;
      state.logs.push({
        id:makeId(),
        date:new Date().toISOString(),
        amount,
        unit:challenge.unit
      });
      recordCompletion(challenge,state,progressFor(challenge,state));
      saveData();
      renderDetail();
      toast("Progresso registado.");
    });

    document.getElementById("reset-challenge").addEventListener("click",() => {
      if (!confirm("Reiniciar este desafio? Os resultados anteriores serão preservados.")) return;
      const result = progressFor(challenge,state);
      state.attempts.push({
        date:new Date().toISOString(),
        result,
        target:Number(state.target),
        unit:challenge.unit,
        status:result >= Number(state.target) ? "Concluído" : "Reiniciado"
      });
      state.startedAt = new Date().toISOString();
      state.value = 0;
      state.logs = [];
      state.completedAt = null;
      saveData();
      renderDetail();
      toast("Nova tentativa iniciada. Histórico preservado.");
    });
  }

  function init() {
    const isDetail = Boolean(document.getElementById("challenge-detail"));

    if (!isDetail) {
      const filters = document.getElementById("filters");
      filters?.addEventListener("click",event => {
        const button = event.target.closest("[data-filter]");
        if (!button) return;
        filter = button.dataset.filter;
        document.querySelectorAll("[data-filter]").forEach(item =>
          item.classList.toggle("active",item === button)
        );
        renderList();
      });
    }

    window.addEventListener("storage",event => {
      if (event.key === RUNS || event.key === STORAGE) {
        data = loadLocal();
        isDetail ? renderDetail() : renderList();
      }
    });

    syncFromCloud().finally(() => {
      isDetail ? renderDetail() : renderList();
    });

    window.addEventListener("focus",() => {
      isDetail ? renderDetail() : renderList();
    });
  }

  init();
})();

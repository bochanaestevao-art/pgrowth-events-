(() => {
'use strict';

const API = 'https://pgrowth-events-fitness-api.vercel.app/api/teams';
const RUNS = 'pgrowth_fitness_run_history_v1';
const PROFILE = 'pgrowth_fitness_athlete_profile_v1';
const INVITES = 'pgrowth_fitness_team_invites_v1';
const MAX_TEAMS = 6;
const MAX_MEMBERS = 10;

const $ = id => document.getElementById(id);
const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
}[c]));

const read = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
};

const km = value => `${(Number(value) || 0).toFixed(2)} km`;
const invites = read(INVITES, {});
let teams = [];
let discoveries = [];
let challenges = [];
let rankings = [];
let memberCounts = {};
let userId = '';
let loading = false;

const toast = message => {
  const el = $('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 3000);
};

async function request(action, payload = {}) {
  if (!window.PGrowthSession) {
    throw new Error('Sistema de sessão indisponível. Actualiza a página.');
  }

  const token = await window.PGrowthSession.token();

  const response = await fetch(API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ action, ...payload })
  });

  const result = await response.json().catch(() => ({}));

  if (response.status === 401) {
    throw new Error('A sessão expirou. Entra novamente.');
  }

  if (!response.ok || result.success === false) {
    throw new Error(result.error || 'Não foi possível concluir a operação.');
  }

  return result.data;
}

function owned(team) {
  return team.organizer_id === userId;
}

function activeTeams() {
  return teams.filter(t => t.status !== 'ARCHIVED');
}

function myMembershipTeam() {
  return activeTeams().find(t => !owned(t)) || null;
}

function ownedTeams() {
  return activeTeams().filter(owned);
}

function saveInvites() {
  localStorage.setItem(INVITES, JSON.stringify(invites));
}

function getRuns() {
  const runs = read(RUNS, []);
  return Array.isArray(runs)
    ? runs.filter(r => Number(r.distanceKm) > 0)
    : [];
}

function renderStats() {
  $('statTeams').textContent = `${ownedTeams().length}/${MAX_TEAMS}`;

  $('statMembers').textContent = Object.values(memberCounts)
    .reduce((sum, count) => sum + count, 0);

  $('statChallenges').textContent =
    challenges.filter(c => c.status === 'OPEN').length;
}

function teamCard(team, management = false) {
  const isOwner = owned(team);
  const count = memberCounts[team.id] || 0;
  const invite = invites[team.id] || '';
  const isPublic = team.is_public === true;

  let actions = '';

  if (isOwner) {
    actions = `
      ${invite ? `<button class="btn secondary" data-action="copy" data-id="${safe(team.id)}">COPIAR CONVITE</button>` : ''}
      <button class="btn secondary" data-action="publish" data-id="${safe(team.id)}" data-public="${isPublic}">
        ${isPublic ? 'TORNAR PRIVADA' : 'PUBLICAR AO PÚBLICO'}
      </button>
      <button class="btn danger" data-action="archive" data-id="${safe(team.id)}">ARQUIVAR EQUIPA</button>
    `;
  } else {
    actions = `
      <button class="btn danger" data-action="leave" data-id="${safe(team.id)}">SAIR DA EQUIPA</button>
    `;
  }

  return `
    <article class="team-card">
      <div class="team-top">
        <div class="team-logo">♟</div>
        <div style="flex:1;min-width:0">
          <h3>${safe(team.name)}</h3>
          <p>${safe(team.description || 'Equipa PGrowth Fitness')}</p>
          <span class="pill">${count}/${MAX_MEMBERS} PARTICIPANTES</span>
          <span class="pill ${team.status === 'PUBLISHED' ? 'gold' : 'gray'}">
            ${team.status === 'PUBLISHED' ? (isPublic ? 'PÚBLICA' : 'PRIVADA') : 'RASCUNHO'}
          </span>
        </div>
      </div>
      <p>${isOwner ? 'Organizador desta equipa' : 'Membro participante'}</p>
      ${management ? `<p class="muted">O organizador não ocupa uma vaga de participante.</p>` : ''}
      <div class="actions">${actions}</div>
    </article>
  `;
}

function renderMine() {
  const list = activeTeams();

  $('myTeams').innerHTML = list.length
    ? list.map(t => teamCard(t)).join('')
    : `<div class="empty"><strong>Ainda não tens equipas.</strong>Cria uma equipa ou entra com um código de convite.</div>`;

  $('createBox').classList.toggle('hidden', ownedTeams().length >= MAX_TEAMS);
}

function renderManage() {
  $('manageTeams').innerHTML = activeTeams().length
    ? activeTeams().map(t => teamCard(t, true)).join('')
    : `<div class="empty"><strong>Sem equipas para gerir.</strong>Cria ou integra uma equipa primeiro.</div>`;
}

function renderDiscover() {
  const current = myMembershipTeam();

  const available = discoveries.filter(team =>
    team.organizer_id !== userId &&
    (!current || current.id !== team.id)
  );

  $('publicTeams').innerHTML = available.length
    ? available.map(team => `
      <article class="team-card">
        <div class="team-top">
          <div class="team-logo">♟</div>
          <div>
            <h3>${safe(team.name)}</h3>
            <p>${safe(team.description || 'Equipa PGrowth Fitness')}</p>
          </div>
        </div>
        <span class="pill gold">PÚBLICA</span>
        <div class="actions">
          <button class="btn secondary" data-action="join-public" data-id="${safe(team.id)}">
            ENTRAR NA EQUIPA
          </button>
        </div>
      </article>
    `).join('')
    : `<div class="empty"><strong>Nenhuma equipa disponível.</strong>As equipas públicas aparecerão aqui.</div>`;
}

function renderIndividual() {
  const runs = getRuns();
  const profile = read(PROFILE, {});
  const fields = profile.fields || {};
  const name = fields.name || profile.name || profile.fullName || 'Atleta deste dispositivo';
  const distance = runs.reduce((sum, run) => sum + Number(run.distanceKm || 0), 0);

  $('individualRanking').innerHTML = `
    <div class="card">
      <div class="rank-row">
        <div class="rank-number">1</div>
        <div class="rank-info">
          <strong>${safe(name)}</strong>
          <small>${runs.length} corridas GPS guardadas neste dispositivo</small>
        </div>
        <div class="rank-value">${km(distance)}</div>
      </div>
      <p class="muted">Este é o teu resumo local, não uma classificação geral verificada.</p>
    </div>
  `;
}

function renderTeamRanking() {
  $('teamRanking').innerHTML = rankings.length
    ? `<div class="card">
        ${rankings.map((team, index) => `
          <div class="rank-row">
            <div class="rank-number">${index + 1}</div>
            <div class="rank-info"><strong>${safe(team.name)}</strong></div>
            <div class="rank-value">${km(team.distanceKm)}</div>
          </div>
        `).join('')}
        <p class="muted">Ranking calculado no servidor exclusivamente com actividades VERIFIED.</p>
      </div>`
    : `<div class="empty"><strong>Ranking à espera de resultados.</strong>Só corridas verificadas entram na classificação.</div>`;
}

function renderChallenges() {
  const current = myMembershipTeam();

  $('challengeList').innerHTML = challenges.length
    ? challenges.map(challenge => {
        const ownChallenge = activeTeams().some(t => t.id === challenge.creator_team_id);
        const canAccept = current &&
          current.id !== challenge.creator_team_id &&
          challenge.status === 'OPEN';

        return `
          <article class="challenge-card">
            <div class="challenge-top">
              <div>
                <h3>${safe(challenge.title)}</h3>
                <p>Desafio entre equipas</p>
              </div>
              <span class="pill gold">ABERTO</span>
            </div>
            <p>${safe(challenge.description || 'Desafio colectivo PGrowth Fitness.')}</p>
            <strong>${safe(challenge.target_km)} km · ${safe(challenge.duration_days)} dias</strong>
            ${canAccept ? `
              <div class="actions">
                <button class="btn secondary" data-action="accept" data-id="${safe(challenge.id)}">
                  ACEITAR DESAFIO
                </button>
              </div>
            ` : ''}
            ${!current && !ownChallenge ? '<p class="muted">Entra numa equipa para poderes aceitar desafios.</p>' : ''}
          </article>
        `;
      }).join('')
    : `<div class="empty"><strong>Nenhum desafio publicado.</strong>Os desafios das equipas aparecerão aqui.</div>`;
}

function fillSelect() {
  const select = $('challengeTeam');
  const list = ownedTeams();

  select.innerHTML = list.length
    ? list.map(t => `<option value="${safe(t.id)}">${safe(t.name)}</option>`).join('')
    : '<option value="">Precisas de organizar uma equipa</option>';

  $('challengeForm').querySelector('button[type="submit"]').disabled = !list.length;
}

function render() {
  renderStats();
  renderMine();
  renderManage();
  renderDiscover();
  renderIndividual();
  renderTeamRanking();
  renderChallenges();
  fillSelect();
}

async function loadData() {
  if (loading) return;
  loading = true;

  try {
    const sessionApi = window.PGrowthSession;
    if (!sessionApi || typeof sessionApi.read !== "function") {
      throw new Error("Sistema de sessão não carregou. Actualiza a página.");
    }
    const session = sessionApi.read();
    userId = session?.user?.id || '';

    if (!userId) {
      throw new Error('Inicia sessão para aceder às equipas.');
    }

    const results = await Promise.all([
      request('mine'),
      request('discover'),
      request('list_challenges'),
      request('rankings')
    ]);

    teams = Array.isArray(results[0]) ? results[0] : [];
    discoveries = Array.isArray(results[1]) ? results[1] : [];
    challenges = Array.isArray(results[2]) ? results[2] : [];
    rankings = Array.isArray(results[3]) ? results[3] : [];

    memberCounts = {};

    await Promise.all(activeTeams().map(async team => {
      try {
        const result = await request('team_members', { teamId: team.id });
        memberCounts[team.id] = Number(result.participantCount || 0);
      } catch {
        memberCounts[team.id] = 0;
      }
    }));

    render();
  } catch (error) {
    toast(error.message);
  } finally {
    loading = false;
  }
}

document.querySelectorAll('[data-tab]').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-tab]').forEach(item =>
      item.classList.toggle('active', item === button)
    );

    document.querySelectorAll('.panel').forEach(panel =>
      panel.classList.toggle('active', panel.id === `panel-${button.dataset.tab}`)
    );
  });
});

$('createForm').addEventListener('submit', async event => {
  event.preventDefault();

  const name = $('teamName').value.trim();
  const description = $('teamDescription').value.trim();

  if (ownedTeams().length >= MAX_TEAMS) {
    return toast('Limite de 6 equipas atingido.');
  }

  if (name.length < 3) return toast('O nome deve ter pelo menos 3 caracteres.');

  const button = event.submitter;
  button.disabled = true;

  try {
    const result = await request('create', { name, description });
    const team = result.team;

    if (!team?.id || !result.inviteCode) {
      throw new Error('A equipa foi criada, mas não recebemos o código de convite.');
    }

    invites[team.id] = result.inviteCode;
    saveInvites();

    try {
      await request('publish', { teamId: team.id, isPublic: false });
      toast('Equipa criada e publicada como privada!');
    } catch (error) {
      toast('Equipa criada. Publicação pendente: ' + error.message);
    }

    event.target.reset();
    await loadData();
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});

$('addMemberBtn').addEventListener('click', async () => {
  const inviteCode = $('memberName').value.trim().toUpperCase();

  if (inviteCode.length < 4) {
    return toast('Introduz um código de convite válido.');
  }

  const button = $('addMemberBtn');
  button.disabled = true;

  try {
    await request('join', { inviteCode });
    $('memberName').value = '';
    toast('Entraste na equipa com sucesso!');
    await loadData();
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});

$('challengeForm').addEventListener('submit', async event => {
  event.preventDefault();

  const payload = {
    teamId: $('challengeTeam').value,
    title: $('challengeTitle').value.trim(),
    targetKm: Number($('challengeTarget').value),
    durationDays: Number($('challengeDays').value),
    description: $('challengeDescription').value.trim()
  };

  if (!payload.teamId) return toast('Selecciona uma equipa que organizas.');

  const button = event.submitter;
  button.disabled = true;

  try {
    await request('create_challenge', payload);
    event.target.reset();
    $('challengeDays').value = 7;
    toast('Desafio publicado no servidor!');
    await loadData();
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;

  const action = button.dataset.action;
  const id = button.dataset.id;
  button.disabled = true;

  try {
    if (action === 'copy') {
      const code = invites[id];

      if (!code) throw new Error('O convite só está disponível no dispositivo do organizador que criou a equipa.');

      const text = `Convite PGrowth Fitness: ${code}`;

      try {
        await navigator.clipboard.writeText(text);
        toast('Código de convite copiado!');
      } catch {
        toast(text);
      }
      return;
    }

    if (action === 'publish') {
      const isPublic = button.dataset.public !== 'true';

      await request('publish', { teamId: id, isPublic });
      toast(isPublic ? 'Equipa publicada ao público!' : 'Equipa agora privada.');
      await loadData();
      return;
    }

    if (action === 'archive') {
      const team = teams.find(t => t.id === id);
      if (!team || !confirm(`Arquivar "${team.name}"? Os membros sairão e o histórico será preservado.`)) return;

      await request('archive', { teamId: id });
      toast('Equipa arquivada. Histórico preservado.');
      await loadData();
      return;
    }

    if (action === 'leave') {
      if (!confirm('Queres sair da tua equipa actual?')) return;

      await request('leave');
      toast('Saíste da equipa.');
      await loadData();
      return;
    }

    if (action === 'join-public') {
      await request('join', { teamId: id });
      toast('Entraste na equipa!');
      await loadData();
      return;
    }

    if (action === 'accept') {
      await request('accept_challenge', { challengeId: id });
      toast('A tua equipa aceitou o desafio!');
      await loadData();
    }
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});

const memberField = $('memberName').closest('.field');
memberField.querySelector('label').textContent = 'Código de convite';
$('memberName').placeholder = 'Ex.: ABC123';
$('memberName').setAttribute('autocomplete', 'off');
$('memberName').removeAttribute('maxlength');
$('memberTeam').closest('.field').classList.add('hidden');
$('addMemberBtn').textContent = 'ENTRAR COM CONVITE';

$('panel-mine').querySelector('.muted').textContent =
  'Até 6 equipas por organizador · 10 participantes por equipa';

$('createBox').querySelector('p').textContent =
  'O organizador não ocupa uma das 10 vagas de participantes.';

$('panel-mine').querySelector('.notice').textContent =
  'A criação, publicação e gestão são validadas no servidor. A criação exige Passe Completo activo.';

$('panel-discover').querySelector('.muted').textContent =
  'Equipas públicas disponíveis na comunidade PGrowth Fitness';

$('panel-teamrank').querySelector('.muted').textContent =
  'Classificação baseada apenas em corridas verificadas pelo servidor';

$('panel-manage').querySelector('h2').textContent = 'Entrar numa equipa';

$('panel-manage').querySelector('.notice').textContent =
  'Arquivar encerra as participações activas, invalida os convites antigos e preserva o histórico.';

render();
loadData();
})();

import { createHash, randomBytes } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).origin : "";
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ALLOWED_ORIGIN = "https://pgrowth-events.vercel.app";

const TABLES = {
  teams: "fitness_teams",
  members: "fitness_team_memberships",
  activities: "fitness_team_activities",
  challenges: "fitness_team_challenges",
  acceptances: "fitness_team_challenge_acceptances",
  passes: "fitness_athlete_passes"
};

function json(res, status, data) {
  res.status(status).json(data);
}

function safeTeam(team) {
  if (!team) return null;

  const {
    id,
    organizer_id,
    name,
    description,
    status,
    is_public,
    renewed_from_team_id,
    created_at
  } = team;

  return {
    id,
    organizer_id,
    name,
    description,
    status,
    is_public,
    renewed_from_team_id,
    created_at
  };
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function db(table, query = "", options = {}) {
  const { method = "GET", body, prefer = "return=representation" } = options;

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}${query}`,
    {
      method,
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: prefer
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    }
  );

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const error = new Error(
      data?.message || data?.details || "Erro na base de dados."
    );
    error.status = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

async function authenticate(req) {
  const authorization = req.headers.authorization || "";
  const token = authorization.replace(/^Bearer\s+/i, "");

  if (!token || !ANON_KEY) {
    throw Object.assign(new Error("Sessão não autenticada."), {
      status: 401
    });
  }

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw Object.assign(new Error("Sessão inválida ou expirada."), {
      status: 401
    });
  }

  return response.json();
}

async function requirePass(userId) {
  const now = encodeURIComponent(new Date().toISOString());

  const passes = await db(
    TABLES.passes,
    `?user_id=eq.${encodeURIComponent(userId)}` +
    `&status=eq.ACTIVE&valid_until=gt.${now}&select=id&limit=1`
  );

  if (!passes?.length) {
    throw Object.assign(
      new Error("É necessário ter um Passe Completo activo para gerir equipas."),
      { status: 403 }
    );
  }
}

async function getTeam(teamId) {
  const rows = await db(
    TABLES.teams,
    `?id=eq.${encodeURIComponent(teamId)}&select=*&limit=1`
  );

  if (!rows?.length) {
    throw Object.assign(new Error("Equipa não encontrada."), {
      status: 404
    });
  }

  return rows[0];
}

async function requireOrganizer(teamId, userId) {
  const team = await getTeam(teamId);

  if (team.organizer_id !== userId) {
    throw Object.assign(
      new Error("Só o organizador pode executar esta operação."),
      { status: 403 }
    );
  }

  if (team.status === "ARCHIVED") {
    throw Object.assign(new Error("Esta equipa está arquivada."), {
      status: 409
    });
  }

  await requirePass(userId);
  return team;
}

async function activeMembership(userId) {
  const rows = await db(
    TABLES.members,
    `?user_id=eq.${encodeURIComponent(userId)}` +
    `&status=eq.ACTIVE&select=*&limit=1`
  );

  return rows?.[0] || null;
}

async function activeMemberCount(teamId) {
  const rows = await db(
    TABLES.members,
    `?team_id=eq.${encodeURIComponent(teamId)}` +
    `&status=eq.ACTIVE&select=id`
  );

  return rows?.length || 0;
}

function inviteCode() {
  return randomBytes(9).toString("hex").toUpperCase();
}

async function createTeam(userId, input) {
  await requirePass(userId);

  const name = String(input.name || "").trim();
  const description = String(input.description || "").trim();

  if (name.length < 3 || name.length > 70) {
    throw Object.assign(
      new Error("O nome da equipa deve ter entre 3 e 70 caracteres."),
      { status: 400 }
    );
  }

  if (description.length > 500) {
    throw Object.assign(new Error("Descrição demasiado longa."), {
      status: 400
    });
  }

  const existing = await db(
    TABLES.teams,
    `?organizer_id=eq.${encodeURIComponent(userId)}` +
    "&status=neq.ARCHIVED&select=id"
  );

  if (existing.length >= 6) {
    throw Object.assign(
      new Error("O limite é de 6 equipas activas por organizador."),
      { status: 409 }
    );
  }

  const code = inviteCode();

  const created = await db(TABLES.teams, "", {
    method: "POST",
    body: {
      organizer_id: userId,
      name,
      description,
      status: "DRAFT",
      is_public: false,
      invite_code_hash: hash(code)
    }
  });

  return {
    team: safeTeam(created?.[0]),
    inviteCode: code
  };
}

async function joinTeam(userId, input) {
  const current = await activeMembership(userId);

  if (current) {
    throw Object.assign(
      new Error("Já pertences a uma equipa. Sai primeiro da equipa actual."),
      { status: 409 }
    );
  }

  let team;

  if (input.inviteCode) {
    const codeHash = hash(String(input.inviteCode).trim().toUpperCase());

    const rows = await db(
      TABLES.teams,
      `?invite_code_hash=eq.${encodeURIComponent(codeHash)}` +
      "&status=eq.PUBLISHED&select=*&limit=1"
    );

    team = rows?.[0];
  } else if (input.teamId) {
    team = await getTeam(input.teamId);
  }

  if (!team || team.status !== "PUBLISHED") {
    throw Object.assign(
      new Error("Equipa indisponível ou convite inválido."),
      { status: 404 }
    );
  }

  if (team.organizer_id === userId) {
    throw Object.assign(
      new Error("O organizador não ocupa uma vaga de participante."),
      { status: 400 }
    );
  }

  if (!input.inviteCode && !team.is_public) {
    throw Object.assign(
      new Error("Esta equipa é privada. Usa o código de convite."),
      { status: 403 }
    );
  }

  const count = await activeMemberCount(team.id);

  if (count >= 10) {
    throw Object.assign(
      new Error("Esta equipa já atingiu o limite de 10 participantes."),
      { status: 409 }
    );
  }

  const membership = await db(TABLES.members, "", {
    method: "POST",
    body: {
      team_id: team.id,
      user_id: userId,
      status: "ACTIVE",
      joined_via: input.inviteCode ? "INVITE" : "PUBLIC"
    }
  });

  return { membership: membership?.[0], team: safeTeam(team) };
}

async function leaveTeam(userId) {
  const membership = await activeMembership(userId);

  if (!membership) {
    throw Object.assign(
      new Error("Não tens uma equipa activa."),
      { status: 404 }
    );
  }

  const result = await db(
    TABLES.members,
    `?id=eq.${encodeURIComponent(membership.id)}`,
    {
      method: "PATCH",
      body: {
        status: "LEFT",
        left_at: new Date().toISOString()
      }
    }
  );

  return { membership: result?.[0] };
}

async function archiveTeam(userId, teamId) {
  const team = await requireOrganizer(teamId, userId);

  await db(
    TABLES.teams,
    `?id=eq.${encodeURIComponent(teamId)}`,
    {
      method: "PATCH",
      body: {
        status: "ARCHIVED",
        is_public: false,
        invite_code_hash: null
      }
    }
  );

  const members = await db(
    TABLES.members,
    `?team_id=eq.${encodeURIComponent(teamId)}&status=eq.ACTIVE`,
    {
      method: "PATCH",
      body: {
        status: "LEFT",
        left_at: new Date().toISOString()
      }
    }
  );

  return {
    archived: true,
    endedMemberships: members?.length || 0,
    teamId: team.id
  };
}

async function listTeams(userId) {
  const safeFields =
    "id,organizer_id,name,description,status,is_public,renewed_from_team_id";

  const organized = await db(
    TABLES.teams,
    `?organizer_id=eq.${encodeURIComponent(userId)}&select=${safeFields}`
  );

  const memberships = await db(
    TABLES.members,
    `?user_id=eq.${encodeURIComponent(userId)}` +
    "&status=eq.ACTIVE&select=team_id"
  );

  const ids = memberships.map(item => item.team_id);

  let joined = [];

  if (ids.length) {
    joined = await db(
      TABLES.teams,
      `?id=in.(${ids.join(",")})&select=${safeFields}`
    );
  }

  const map = new Map();

  [...organized, ...joined].forEach(team => map.set(team.id, team));

  return [...map.values()];
}

async function discoverTeams() {
  return db(
    TABLES.teams,
    "?status=eq.PUBLISHED&is_public=eq.true&select=id,name,description,created_at"
  );
}

async function publishTeam(userId, teamId, isPublic) {
  await requireOrganizer(teamId, userId);

  const result = await db(
    TABLES.teams,
    `?id=eq.${encodeURIComponent(teamId)}`,
    {
      method: "PATCH",
      body: {
        status: "PUBLISHED",
        is_public: Boolean(isPublic)
      }
    }
  );

  return { team: safeTeam(result?.[0]) };
}

async function createChallenge(userId, input) {
  await requireOrganizer(input.teamId, userId);

  const title = String(input.title || "").trim();
  const targetKm = Number(input.targetKm);
  const durationDays = Number(input.durationDays);

  if (
    title.length < 3 ||
    title.length > 100 ||
    !Number.isFinite(targetKm) ||
    targetKm <= 0 ||
    !Number.isInteger(durationDays) ||
    durationDays < 1 ||
    durationDays > 90
  ) {
    throw Object.assign(new Error("Dados do desafio inválidos."), {
      status: 400
    });
  }

  const starts = new Date();
  const ends = new Date(starts);
  ends.setDate(ends.getDate() + durationDays);

  const result = await db(TABLES.challenges, "", {
    method: "POST",
    body: {
      creator_team_id: input.teamId,
      created_by: userId,
      title,
      description: String(input.description || "").slice(0, 500),
      target_km: targetKm,
      duration_days: durationDays,
      status: "OPEN",
      starts_at: starts.toISOString(),
      ends_at: ends.toISOString()
    }
  });

  return { challenge: result?.[0] };
}

async function acceptChallenge(userId, input) {
  const membership = await activeMembership(userId);

  if (!membership) {
    throw Object.assign(
      new Error("Tens de pertencer a uma equipa para aceitar desafios."),
      { status: 403 }
    );
  }

  const challengeRows = await db(
    TABLES.challenges,
    `?id=eq.${encodeURIComponent(input.challengeId)}` +
    "&status=eq.OPEN&select=*&limit=1"
  );

  const challenge = challengeRows?.[0];

  if (!challenge) {
    throw Object.assign(new Error("Desafio indisponível."), {
      status: 404
    });
  }

  if (challenge.creator_team_id === membership.team_id) {
    throw Object.assign(
      new Error("A tua equipa não pode aceitar o próprio desafio."),
      { status: 400 }
    );
  }

  const existing = await db(
    TABLES.acceptances,
    `?challenge_id=eq.${encodeURIComponent(input.challengeId)}` +
    `&team_id=eq.${encodeURIComponent(membership.team_id)}` +
    "&select=id&limit=1"
  );

  if (existing.length) {
    throw Object.assign(
      new Error("A tua equipa já respondeu a este desafio."),
      { status: 409 }
    );
  }

  const result = await db(TABLES.acceptances, "", {
    method: "POST",
    body: {
      challenge_id: input.challengeId,
      team_id: membership.team_id,
      accepted_by: userId,
      status: "ACCEPTED"
    }
  });

  return { acceptance: result?.[0] };
}

async function submitActivity(userId, input) {
  const membership = await activeMembership(userId);

  if (!membership) {
    throw Object.assign(
      new Error("Tens de pertencer a uma equipa para enviar uma actividade."),
      { status: 403 }
    );
  }

  const distance = Number(input.distanceKm);
  const duration = Number(input.durationMs);

  if (
    !Number.isFinite(distance) ||
    distance <= 0 ||
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    throw Object.assign(new Error("Dados da corrida inválidos."), {
      status: 400
    });
  }

  const duplicate = await db(
    TABLES.activities,
    `?client_run_id=eq.${encodeURIComponent(input.clientRunId || "")}` +
    "&select=id&limit=1"
  );

  if (duplicate.length) {
    throw Object.assign(
      new Error("Esta corrida já foi enviada."),
      { status: 409 }
    );
  }

  const result = await db(TABLES.activities, "", {
    method: "POST",
    body: {
      team_id: membership.team_id,
      athlete_id: userId,
      membership_id: membership.id,
      client_run_id: input.clientRunId || null,
      distance_km: distance,
      duration_ms: duration,
      pace: String(input.pace || ""),
      activity_date: input.activityDate || new Date().toISOString(),
      timezone: "Africa/Maputo",
      route: Array.isArray(input.route) ? input.route : [],
      verification_status: "PENDING"
    }
  });

  return {
    activity: result?.[0],
    message: "Corrida recebida e pendente de verificação."
  };
}

async function rankings() {
  const teams = await db(
    TABLES.teams,
    "?status=eq.PUBLISHED&select=id,name"
  );

  const activities = await db(
    TABLES.activities,
    "?verification_status=eq.VERIFIED&select=team_id,athlete_id,distance_km"
  );

  const totals = {};

  for (const activity of activities) {
    const id = activity.team_id;
    totals[id] = (totals[id] || 0) + Number(activity.distance_km || 0);
  }

  return teams
    .map(team => ({
      teamId: team.id,
      name: team.name,
      distanceKm: Number((totals[team.id] || 0).toFixed(2))
    }))
    .sort((a, b) => b.distanceKm - a.distanceKm);
}

async function listTeamMembers(userId, teamId) {
  if (!teamId) throw Object.assign(new Error("Equipa não indicada."), { status: 400 });
  const team = await getTeam(teamId);
  const own = await db(TABLES.members, "?team_id=eq." + encodeURIComponent(teamId) + "&user_id=eq." + encodeURIComponent(userId) + "&status=eq.ACTIVE&select=id&limit=1");
  if (team.organizer_id !== userId && !own.length) throw Object.assign(new Error("Sem acesso aos membros desta equipa."), { status: 403 });
  const members = await db(TABLES.members, "?team_id=eq." + encodeURIComponent(teamId) + "&status=eq.ACTIVE&select=id,team_id,user_id,status,joined_at,joined_via&order=joined_at.asc");
  return { organizerId: team.organizer_id, members, participantCount: members.length, maximumParticipants: 10 };
}

async function listChallenges() {
  return db(TABLES.challenges, "?status=eq.OPEN&select=id,creator_team_id,created_by,title,description,target_km,duration_days,status,starts_at,ends_at,created_at&order=created_at.desc");
}

async function listChallengeAcceptances(userId, challengeId) {
  if (!challengeId) {
    throw Object.assign(new Error("Desafio não indicado."), { status: 400 });
  }

  const rows = await db(
    TABLES.challenges,
    "?id=eq." + encodeURIComponent(challengeId) + "&select=id,creator_team_id&limit=1"
  );

  const challenge = rows && rows[0];
  if (!challenge) {
    throw Object.assign(new Error("Desafio não encontrado."), { status: 404 });
  }

  const creator = await getTeam(challenge.creator_team_id);
  const membership = await activeMembership(userId);

  const acceptances = await db(
    TABLES.acceptances,
    "?challenge_id=eq." + encodeURIComponent(challengeId) +
    "&select=id,challenge_id,team_id,status,accepted_at&order=accepted_at.asc"
  );

  const isCreator = creator.organizer_id === userId;
  const isParticipant = membership &&
    acceptances.some(item => item.team_id === membership.team_id);

  if (!isCreator && !isParticipant) {
    throw Object.assign(new Error("Não tens autorização para consultar estas respostas."), { status: 403 });
  }

  return acceptances;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type"
  );
  res.setHeader("Vary", "Origin");

  if (req.headers.origin && req.headers.origin !== ALLOWED_ORIGIN) {
    return json(res, 403, { error: "Origem não autorizada." });
  }

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
    return json(res, 500, { error: "Configuração do servidor incompleta." });
  }

  try {
    const user = await authenticate(req);
    const input = req.method === "GET" ? req.query : (req.body || {});
    const action = input.action;

    let result;

    switch (action) {
      case "mine":
        result = await listTeams(user.id);
        break;

      case "discover":
        result = await discoverTeams();
        break;

      case "rankings":
        result = await rankings();
        break;

      case "team_members":
      result = await listTeamMembers(user.id, input.teamId);
      break;

    case "list_challenges":
      result = await listChallenges();
      break;

    case "challenge_acceptances":
      result = await listChallengeAcceptances(user.id, input.challengeId);
      break;
    case "create":
        result = await createTeam(user.id, input);
        break;

      case "join":
        result = await joinTeam(user.id, input);
        break;

      case "leave":
        result = await leaveTeam(user.id);
        break;

      case "publish":
        result = await publishTeam(
          user.id,
          input.teamId,
          input.isPublic
        );
        break;

      case "archive":
        result = await archiveTeam(user.id, input.teamId);
        break;

      case "create_challenge":
        result = await createChallenge(user.id, input);
        break;

      case "accept_challenge":
        result = await acceptChallenge(user.id, input);
        break;

      case "submit_activity":
        result = await submitActivity(user.id, input);
        break;

      default:
        return json(res, 400, { error: "Acção desconhecida." });
    }

    return json(res, 200, { success: true, data: result });

  } catch (error) {
    console.error("FITNESS_TEAMS_API:", error.message);

    return json(res, error.status || 500, {
      success: false,
      error: error.message || "Erro interno."
    });
  }
}

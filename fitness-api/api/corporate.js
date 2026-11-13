import { createHash, randomBytes } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).origin : "";
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ORIGIN = "https://pgrowth-events.vercel.app";

function send(res, status, data) {
  return res.status(status).json(data);
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function db(path, method = "GET", body = null) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    ...(body === null ? {} : { body: JSON.stringify(body) })
  });

  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) {
    throw new Error(data?.message || data?.hint || data?.details || "Erro na base de dados.");
  }
  return data;
}

async function rpc(name, body) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) throw new Error(data?.message || "Falha na operação administrativa.");
  return data;
}

async function authenticate(req) {
  const header = req.headers.authorization || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Sessão não encontrada.");

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error("Sessão inválida ou expirada.");

  return await response.json();
}

async function isAdmin(userId) {
  const rows = await db(
    `fitness_admins?user_id=eq.${encodeURIComponent(userId)}&select=user_id`
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function membership(companyId, userId) {
  const rows = await db(
    `fitness_company_members?company_id=eq.${companyId}&user_id=eq.${userId}&status=eq.ACTIVE&select=*`
  );
  return rows?.[0] || null;
}

async function requireManager(companyId, userId) {
  const member = await membership(companyId, userId);
  if (!member || !["OWNER", "COMPANY_ADMIN"].includes(member.role)) {
    throw new Error("Sem autorização para gerir esta empresa.");
  }
  return member;
}

async function requireDepartmentManager(companyId, departmentId, userId) {
  const member = await membership(companyId, userId);
  if (!member) throw new Error("Não és membro desta empresa.");
  if (["OWNER", "COMPANY_ADMIN"].includes(member.role)) return member;
  if (member.role === "DEPARTMENT_HEAD" && member.department_id === departmentId) return member;
  throw new Error("Sem autorização para gerir este departamento.");
}

function required(value, label, max = 180) {
  const result = String(value || "").trim();
  if (!result || result.length > max) throw new Error(`${label} inválido.`);
  return result;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", ORIGIN);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return send(res, 405, { error: "Método não permitido." });

  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
    return send(res, 500, { error: "Configuração Supabase incompleta." });
  }

  try {
    const user = await authenticate(req);
    const userId = user.id;
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const action = required(body.action, "Operação", 60);

    // REGISTO DE EMPRESA E CRIAÇÃO DO RESPONSÁVEL
    if (action === "REGISTER_COMPANY") {
      const company = await db("fitness_companies", "POST", {
        name: required(body.name, "Nome da empresa"),
        legal_name: body.legal_name || null,
        nuit: body.nuit || null,
        industry: body.industry || null,
        province: body.province || null,
        city: body.city || null,
        address: body.address || null,
        contact_name: required(body.contact_name, "Nome do responsável"),
        contact_email: required(body.contact_email, "Email", 254).toLowerCase(),
        contact_phone: required(body.contact_phone, "Telefone", 40),
        created_by: userId,
        status: "PENDING"
      });
      const created = company[0];
      await db("fitness_company_members", "POST", {
        company_id: created.id,
        user_id: userId,
        role: "OWNER",
        status: "ACTIVE"
      });
      return send(res, 201, { success: true, company: created });
    }


    // EMPRESAS DO UTILIZADOR AUTENTICADO
    if (action === "MY_COMPANIES") {
      const memberships = await db(
        `fitness_company_members?user_id=eq.${encodeURIComponent(userId)}&status=eq.ACTIVE&select=company_id,role,department_id`
      );
      const ids = [...new Set((memberships || []).map(item => item.company_id))];
      if (!ids.length) return send(res, 200, { success: true, companies: [] });

      const companies = await db(
        `fitness_companies?id=in.(${ids.join(",")})&select=*`
      );
      const result = (companies || []).map(company => ({
        ...company,
        membership: memberships.find(item => item.company_id === company.id)
      }));
      return send(res, 200, { success: true, companies: result });
    }

    // PAINEL EMPRESARIAL
    if (action === "GET_DASHBOARD") {
      const member = await membership(body.company_id, userId);
      if (!member) throw new Error("Não tens acesso a esta empresa.");

      const companyId = encodeURIComponent(body.company_id);
      const [companies, members, departments, contracts, challenges, events] = await Promise.all([
        db(`fitness_companies?id=eq.${companyId}&select=*`),
        db(`fitness_company_members?company_id=eq.${companyId}&select=*`),
        db(`fitness_company_departments?company_id=eq.${companyId}&select=*`),
        db(`fitness_company_contracts?company_id=eq.${companyId}&select=*&order=created_at.desc`),
        db(`fitness_company_challenges?company_id=eq.${companyId}&select=*&order=created_at.desc`),
        db(`fitness_company_events?company_id=eq.${companyId}&select=*&order=starts_at.asc`)
      ]);
      return send(res, 200, {
        success: true,
        company: companies?.[0] || null,
        my_membership: member,
        members, departments, contracts, challenges, events
      });
    }

    // ADMIN: LISTAR EMPRESAS E PAGAMENTOS PENDENTES
    if (action === "ADMIN_LIST") {
      if (!(await isAdmin(userId))) throw new Error("Acesso reservado ao administrador PGrowth.");
      const [companies, payments] = await Promise.all([
        db("fitness_companies?select=*&order=created_at.desc"),
        db("fitness_company_payments?status=eq.PENDING&select=*&order=created_at.asc")
      ]);
      return send(res, 200, { success: true, companies, pending_payments: payments });
    }

    // ADMIN: DEFINIR PREÇO E PERÍODO DO CONTRATO
    if (action === "ADMIN_SET_CONTRACT") {
      if (!(await isAdmin(userId))) throw new Error("Acesso reservado ao administrador PGrowth.");
      const companyId = required(body.company_id, "Empresa");
      const period = required(body.period_type, "Período");
      if (!["MONTHLY", "QUARTERLY", "ANNUAL", "CUSTOM"].includes(period)) {
        throw new Error("Período contratual inválido.");
      }
      const price = Number(body.price_mzn);
      if (!Number.isFinite(price) || price <= 0) throw new Error("Preço negociado inválido.");

      const record = await db("fitness_company_contracts", "POST", {
        company_id: companyId,
        period_type: period,
        price_mzn: price,
        currency: "MZN",
        collaborators_limit: null,
        additional_terms: body.additional_terms || null,
        starts_at: period === "CUSTOM" && body.starts_at ? body.starts_at : null,
        ends_at: period === "CUSTOM" && body.ends_at ? body.ends_at : null,
        status: "PENDING_PAYMENT",
        created_by: userId
      });
      return send(res, 201, { success: true, contract: record[0] });
    }

    // EMPRESA: SUBMETER PAGAMENTO
    if (action === "SUBMIT_PAYMENT") {
      const companyId = required(body.company_id, "Empresa");
      await requireManager(companyId, userId);
      const contractId = required(body.contract_id, "Contrato");
      const contracts = await db(
        `fitness_company_contracts?id=eq.${encodeURIComponent(contractId)}&company_id=eq.${encodeURIComponent(companyId)}&status=eq.PENDING_PAYMENT&select=*`
      );
      const contract = contracts?.[0];
      if (!contract) throw new Error("Contrato pendente de pagamento não encontrado.");

      const amount = Number(body.amount_mzn);
      if (!Number.isFinite(amount) || amount !== Number(contract.price_mzn)) {
        throw new Error("O valor deve corresponder ao preço negociado.");
      }

      const payment = await db("fitness_company_payments", "POST", {
        company_id: companyId,
        contract_id: contractId,
        amount_mzn: amount,
        payment_method: required(body.payment_method, "Método de pagamento", 30),
        payment_reference: required(body.payment_reference, "Referência de pagamento", 120),
        proof_url: body.proof_url || null,
        submitted_by: userId,
        status: "PENDING"
      });
      return send(res, 201, { success: true, payment: payment[0] });
    }

    // ADMIN: APROVAR PAGAMENTO E ACTIVAR CONTRATO
    if (action === "ADMIN_APPROVE_PAYMENT") {
      if (!(await isAdmin(userId))) throw new Error("Acesso reservado ao administrador PGrowth.");
      const result = await rpc("fitness_corporate_approve_payment", {
        p_payment_id: required(body.payment_id, "Pagamento"),
        p_admin_user_id: userId
      });
      return send(res, 200, result);
    }

    // ADMIN: REJEITAR PAGAMENTO
    if (action === "ADMIN_REJECT_PAYMENT") {
      if (!(await isAdmin(userId))) throw new Error("Acesso reservado ao administrador PGrowth.");
      const paymentId = required(body.payment_id, "Pagamento");
      const rows = await db(
        `fitness_company_payments?id=eq.${encodeURIComponent(paymentId)}&status=eq.PENDING&select=*`
      );
      if (!rows?.[0]) throw new Error("Pagamento pendente não encontrado.");
      await db(`fitness_company_payments?id=eq.${encodeURIComponent(paymentId)}`, "PATCH", {
        status: "REJECTED",
        approved_by: userId,
        approved_at: new Date().toISOString(),
        admin_note: String(body.admin_note || "Pagamento rejeitado").slice(0, 500)
      });
      return send(res, 200, { success: true, status: "REJECTED" });
    }

    // EMPRESA: CRIAR DEPARTAMENTO
    if (action === "CREATE_DEPARTMENT") {
      const companyId = required(body.company_id, "Empresa");
      await requireManager(companyId, userId);
      const rows = await db("fitness_company_departments", "POST", {
        company_id: companyId,
        name: required(body.name, "Nome do departamento"),
        description: body.description || null
      });
      return send(res, 201, { success: true, department: rows[0] });
    }

    // EMPRESA: CRIAR CONVITE
    if (action === "INVITE_MEMBER") {
      const companyId = required(body.company_id, "Empresa");
      await requireManager(companyId, userId);
      const token = randomBytes(32).toString("hex");
      const departmentId = body.department_id || null;
      if (departmentId) {
        const departments = await db(
          `fitness_company_departments?id=eq.${encodeURIComponent(departmentId)}&company_id=eq.${encodeURIComponent(companyId)}&select=id`
        );
        if (!departments?.length) throw new Error("Departamento inválido.");
      }
      const rows = await db("fitness_company_invites", "POST", {
        company_id: companyId,
        department_id: departmentId,
        email: body.email ? String(body.email).trim().toLowerCase() : null,
        phone: body.phone ? String(body.phone).trim() : null,
        role: body.role === "DEPARTMENT_HEAD" ? "DEPARTMENT_HEAD" : "MEMBER",
        token_hash: hash(token),
        invited_by: userId,
        expires_at: new Date(Date.now() + 7 * 86400000).toISOString()
      });
      return send(res, 201, {
        success: true,
        invite: { id: rows[0].id, token, expires_at: rows[0].expires_at }
      });
    }

    // COLABORADOR: ACEITAR CONVITE
    if (action === "ACCEPT_INVITE") {
      const token = required(body.token, "Código de convite", 200);
      const rows = await db(
        `fitness_company_invites?token_hash=eq.${hash(token)}&status=eq.PENDING&select=*`
      );
      const invite = rows?.[0];
      if (!invite || new Date(invite.expires_at).getTime() <= Date.now()) {
        throw new Error("Convite inválido ou expirado.");
      }
      const existing = await membership(invite.company_id, userId);
      if (existing) throw new Error("Já pertences a esta empresa.");
      const member = await db("fitness_company_members", "POST", {
        company_id: invite.company_id,
        user_id: userId,
        role: invite.role,
        department_id: invite.department_id,
        status: "ACTIVE"
      });
      await db(`fitness_company_invites?id=eq.${invite.id}`, "PATCH", {
        status: "ACCEPTED",
        accepted_by: userId,
        accepted_at: new Date().toISOString()
      });
      return send(res, 200, { success: true, membership: member[0] });
    }

    // DESAFIO EMPRESARIAL OU DEPARTAMENTAL
    if (action === "CREATE_CHALLENGE") {
      const companyId = required(body.company_id, "Empresa");
      const departmentId = body.department_id || null;
      if (departmentId) {
        await requireDepartmentManager(companyId, departmentId, userId);
      } else {
        await requireManager(companyId, userId);
      }
      const starts = new Date(body.starts_at);
      const ends = new Date(body.ends_at);
      if (!Number.isFinite(starts.getTime()) || !Number.isFinite(ends.getTime()) || ends <= starts) {
        throw new Error("Datas do desafio inválidas.");
      }
      const rows = await db("fitness_company_challenges", "POST", {
        company_id: companyId,
        department_id: departmentId,
        title: required(body.title, "Título do desafio"),
        description: body.description || null,
        category: body.category || "RUN",
        metric: body.metric || "DISTANCE_KM",
        goal: Number(body.goal),
        starts_at: starts.toISOString(),
        ends_at: ends.toISOString(),
        created_by: userId,
        status: "ACTIVE"
      });
      return send(res, 201, { success: true, challenge: rows[0] });
    }

    // EVENTO EMPRESARIAL
    if (action === "CREATE_EVENT") {
      const companyId = required(body.company_id, "Empresa");
      await requireManager(companyId, userId);
      const starts = new Date(body.starts_at);
      const ends = new Date(body.ends_at);
      if (!Number.isFinite(starts.getTime()) || !Number.isFinite(ends.getTime()) || ends <= starts) {
        throw new Error("Datas do evento inválidas.");
      }
      const rows = await db("fitness_company_events", "POST", {
        company_id: companyId,
        department_id: body.department_id || null,
        title: required(body.title, "Título do evento"),
        description: body.description || null,
        location: body.location || null,
        starts_at: starts.toISOString(),
        ends_at: ends.toISOString(),
        created_by: userId,
        status: "SCHEDULED"
      });
      return send(res, 201, { success: true, event: rows[0] });
    }

    return send(res, 400, { error: "Operação empresarial desconhecida." });
  } catch (error) {
    const message = error?.message || "Erro interno.";
    const status = /sessão|autorização|acesso reservado|não tens acesso|não pertences|não és membro/i.test(message)
      ? 403
      : 400;
    return send(res, status, { error: message });
  }
}

(() => {
'use strict';

const API = 'https:' + String.fromCharCode(47, 47) + 'pgrowth-events-fitness-api.vercel.app/api';
const $ = id => document.getElementById(id);
const state = { token: null, queues: {} };

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[c]);
}

function message(text, type='') {
  const el = $('globalMessage');
  el.className = 'notice' + (type ? ' ' + type : '');
  el.textContent = text;
}

async function token() {
  if (!window.PGrowthSession?.token) throw new Error('Sessão PGrowth não encontrada. Entra novamente na tua conta.');
  const value = await window.PGrowthSession.token();
  if (!value) throw new Error('A sessão expirou. Inicia sessão novamente.');
  state.token = value;
  return value;
}

async function request(api, action, method='GET', payload={}) {
  const auth = await token();
  const url = new URL(API + '/' + api);
  const options = {
    method,
    headers: {
      'Authorization': 'Bearer ' + auth,
      'Content-Type': 'application/json'
    }
  };
  if (method === 'GET') url.searchParams.set('action', action);
  else options.body = JSON.stringify({ ...payload, action });

  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || `Erro HTTP ${response.status}`);
  return data;
}

function list(data, ...keys) {
  if (Array.isArray(data)) return data;
  for (const key of keys) if (Array.isArray(data?.[key])) return data[key];
  return [];
}

function date(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? esc(value) : d.toLocaleString('pt-MZ');
}

function item(title, lines, buttons='') {
  return `<article class="item"><strong>${esc(title)}</strong>${lines.map(x=>`<p>${esc(x)}</p>`).join('')}${buttons ? `<div class="actions">${buttons}</div>` : ''}</article>`;
}

function actionButton(label, action, id, decision, danger=false) {
  return `<button class="${danger?'danger':''}" data-action="${action}" data-id="${esc(id)}" data-decision="${decision}">${label}</button>`;
}

function renderQueue(target, rows, renderer, empty='Não existem pedidos pendentes.') {
  $(target).innerHTML = rows.length ? rows.map(renderer).join('') : `<div class="empty">${empty}</div>`;
}

async function loadPasses() {
  const data = await request('pass', 'admin-orders');
  const rows = list(data, 'orders', 'data');
  state.queues.passes = rows;
  $('nPasses').textContent = rows.length;
  renderQueue('passQueue', rows, o => item(
    o.buyer_name || o.full_name || 'Pedido de Passe',
    [
      `Plano: ${o.plan_name || '—'} · Valor: ${o.requested_amount ?? '—'} MT`,
      `Referência: ${o.order_reference || o.id || '—'}`,
      `Pagamento: ${o.payment_method || '—'} · Comprovativo: ${o.transfer_code || o.payment_message || '—'}`,
      `Data: ${date(o.created_at)}`
    ],
    actionButton('APROVAR','pass-review',o.id,'APPROVED') +
    actionButton('REJEITAR','pass-review',o.id,'REJECTED',true)
  ));
}

async function loadCoaches() {
  const data = await request('premium', 'coach-requests');
  const rows = list(data, 'requests', 'coachRequests', 'data');
  state.queues.coaches = rows;
  $('nCoaches').textContent = rows.length;
  renderQueue('coachQueue', rows, o => item(
    o.athlete_name || o.full_name || o.user_name || 'Pedido de acompanhamento',
    [
      `Treinador: ${o.coach_name || o.coach_user_id || '—'}`,
      `Atleta: ${o.athlete_id || o.user_id || '—'}`,
      `Nota: ${o.request_note || 'Sem nota adicional'}`,
      `Data: ${date(o.created_at)}`
    ],
    actionButton('APROVAR','coach-review',o.id,'APPROVED') +
    actionButton('REJEITAR','coach-review',o.id,'REJECTED',true)
  ));
}

async function loadCompanies() {
  const data = await request('corporate', 'ADMIN_LIST', 'POST');
  const rows = list(data, 'pending_payments', 'payments', 'pendingPayments');
  state.queues.companies = rows;
  $('nCompanies').textContent = rows.length;
  renderQueue('companyQueue', rows, o => item(
    o.company_name || o.company?.name || 'Pagamento empresarial',
    [
      `Valor: ${o.amount_mzn ?? o.amount ?? '—'} MT`,
      `Empresa: ${o.company_id || '—'}`,
      `Referência/comprovativo: ${o.transfer_code || o.payment_reference || o.payment_message || '—'}`,
      `Data: ${date(o.created_at)}`
    ],
    actionButton('APROVAR','company-review',o.id,'APPROVED') +
    actionButton('REJEITAR','company-review',o.id,'REJECTED',true)
  ));
}

async function loadOrders() {
  const data = await request('marketplace', 'admin-orders');
  const rows = list(data, 'orders', 'data');
  state.queues.orders = rows;
  $('nOrders').textContent = rows.filter(x=>x.payment_status==='PENDING').length;
  renderQueue('orderQueue', rows, o => item(
    `${o.product_name || 'Produto'} · ${o.order_reference || ''}`,
    [
      `Cliente: ${o.buyer_name || '—'} · Telefone: ${o.phone || '—'}`,
      `Quantidade: ${o.quantity || 0} · Total: ${o.total_amount_mzn ?? '—'} MT`,
      `Pagamento: ${o.payment_method || '—'} · Comprovativo: ${o.transfer_code || o.payment_message || '—'}`,
      `Estado: ${o.payment_status || '—'} · ${date(o.created_at)}`
    ],
    o.payment_status === 'PENDING'
      ? actionButton('APROVAR','order-review',o.id,'APPROVED') +
        actionButton('REJEITAR','order-review',o.id,'REJECTED',true)
      : ''
  ), 'Ainda não existem encomendas.');
}

async function loadCommissions() {
  const data = await request('premium', 'commissions');
  const rows = list(data, 'commissions', 'data').filter(x=>['PENDING','APPROVED'].includes(String(x.status||'').toUpperCase()));
  state.queues.commissions = rows;
  renderQueue('commissionQueue', rows, o => item(
    o.coach_name || o.coach_user_id || 'Comissão de treinador',
    [
      `Valor: ${o.amount_mzn ?? o.amount ?? '—'} MT`,
      `Estado: ${o.status || '—'}`,
      `Criada: ${date(o.created_at)}`
    ],
    (o.status === 'PENDING'
      ? actionButton('APROVAR COMISSÃO','commission-review',o.id,'APPROVE')
      : actionButton('REGISTAR PAGAMENTO','commission-review',o.id,'PAY'))
  ), 'Não existem comissões por tratar.');
}

async function loadAll() {
  $('refresh').disabled = true;
  message('A carregar dados administrativos...');
  const jobs = [
    ['Passes',loadPasses],
    ['Treinadores',loadCoaches],
    ['Empresas',loadCompanies],
    ['Marketplace',loadOrders],
    ['Comissões',loadCommissions]
  ];
  const results = await Promise.allSettled(jobs.map(x=>x[1]()));
  const failed = results.map((r,i)=>r.status==='rejected' ? `${jobs[i][0]}: ${r.reason.message}` : null).filter(Boolean);
  $('refresh').disabled = false;

  if (failed.length === jobs.length) {
    message('Não foi possível confirmar o acesso administrativo. ' + failed.join(' | '), 'error');
  } else if (failed.length) {
    message('Central parcialmente carregada. Alguns módulos não responderam: ' + failed.join(' | '), 'error');
  } else {
    message('Sessão validada. Dados administrativos actualizados.', 'good');
  }
}

async function perform(button) {
  const { action, id, decision } = button.dataset;
  if (!id) return;
  const isReject = decision === 'REJECTED';
  const confirmText = isReject
    ? 'Confirmas a rejeição deste pedido?'
    : action === 'commission-review'
      ? decision === 'PAY' ? 'Confirmas que esta comissão foi paga?' : 'Confirmas a aprovação desta comissão?'
      : 'Confirmas a aprovação deste pedido?';
  if (!window.confirm(confirmText)) return;

  button.disabled = true;
  try {
    if (action === 'pass-review') {
      await request('pass','admin-review','POST',{orderId:id,decision,adminNote:''});
    } else if (action === 'coach-review') {
      await request('premium','review-coach-request','POST',{requestId:id,decision,adminNote:''});
    } else if (action === 'company-review') {
      await request('corporate',decision==='APPROVED'?'ADMIN_APPROVE_PAYMENT':'ADMIN_REJECT_PAYMENT','POST',{payment_id:id,admin_note:''});
    } else if (action === 'order-review') {
      await request('marketplace','admin-review-order','POST',{orderId:id,decision,adminNote:''});
    } else if (action === 'commission-review') {
      await request('premium','manage-commission','POST',{commissionId:id,decision});
    }
    message('Operação enviada e aceite pelo servidor.', 'good');
    await loadAll();
  } catch (error) {
    message('Não foi possível concluir a operação: ' + error.message, 'error');
    button.disabled = false;
  }
}

document.addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (button) perform(button);
});

$('refresh').addEventListener('click', loadAll);
$('logout').addEventListener('click', async () => {
  if (!confirm('Queres terminar a sessão PGrowth?')) return;
  try { await window.PGrowthSession?.logout?.(); } catch {}
  location.href = 'acesso.html';
});

(async () => {
  try {
    await token();
    await loadAll();
  } catch (error) {
    message(error.message + ' Acede primeiro à tua conta PGrowth.', 'error');
    $('passQueue').innerHTML = '<div class="empty">Sessão necessária.</div>';
    $('coachQueue').innerHTML = '<div class="empty">Sessão necessária.</div>';
    $('companyQueue').innerHTML = '<div class="empty">Sessão necessária.</div>';
    $('orderQueue').innerHTML = '<div class="empty">Sessão necessária.</div>';
    $('commissionQueue').innerHTML = '<div class="empty">Sessão necessária.</div>';
  }
})();
})();

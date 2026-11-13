(() => {
  'use strict';

  const API = "https://pgrowth-events-fitness-api.vercel.app/api/corporate";
  const ROOT_ID = 'pgrowth-corporate-root';

  if (document.getElementById(ROOT_ID)) return;

  const style = document.createElement('style');
  style.textContent = `
    #${ROOT_ID}{font-family:inherit;color:#17243a;margin:28px auto;max-width:1100px}
    #${ROOT_ID} *{box-sizing:border-box}
    #${ROOT_ID} .corp-shell{background:linear-gradient(145deg,#f8fbff,#edf3fa);border:1px solid #dce6f2;border-radius:20px;padding:22px}
    #${ROOT_ID} .corp-head{background:linear-gradient(120deg,#102b50,#1764a5);color:white;padding:24px;border-radius:16px;margin-bottom:20px}
    #${ROOT_ID} .corp-head h2{margin:0 0 8px;font-size:24px}
    #${ROOT_ID} .corp-head p{margin:0;color:#dcecff;font-size:14px}
    #${ROOT_ID} .corp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}
    #${ROOT_ID} .corp-card{background:white;border:1px solid #dce5ef;border-radius:14px;padding:17px;margin:14px 0}
    #${ROOT_ID} h3{margin:0 0 14px;color:#163b65;font-size:17px}
    #${ROOT_ID} label{display:block;font-size:13px;font-weight:700;margin:12px 0 5px;color:#34465e}
    #${ROOT_ID} input,#${ROOT_ID} select,#${ROOT_ID} textarea{width:100%;padding:12px;border:1px solid #ccd8e6;border-radius:9px;background:#fff;color:#17243a;font:inherit;font-size:14px}
    #${ROOT_ID} textarea{min-height:75px;resize:vertical}
    #${ROOT_ID} button{border:0;border-radius:9px;padding:12px 16px;font-weight:800;cursor:pointer;font:inherit}
    #${ROOT_ID} .primary{background:#1764a5;color:white}
    #${ROOT_ID} .secondary{background:#e8f0f8;color:#17436f}
    #${ROOT_ID} .danger{background:#fff0f0;color:#a62c2c}
    #${ROOT_ID} .corp-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:14px}
    #${ROOT_ID} .corp-status{padding:12px;border-radius:10px;background:#edf4fb;margin:12px 0;font-size:14px;white-space:pre-wrap}
    #${ROOT_ID} .corp-status.error{background:#fff0f0;color:#9c2525}
    #${ROOT_ID} .corp-status.success{background:#eaf8ef;color:#176333}
    #${ROOT_ID} .corp-muted{color:#68788c;font-size:13px}
    #${ROOT_ID} .corp-item{padding:12px 0;border-bottom:1px solid #e8edf3;font-size:14px}
    #${ROOT_ID} .corp-item:last-child{border-bottom:0}
    #${ROOT_ID} .corp-pill{display:inline-block;padding:4px 9px;border-radius:20px;background:#e8f0f8;color:#17436f;font-size:11px;font-weight:800}
    #${ROOT_ID} .corp-section{margin-top:20px}
    #${ROOT_ID} .corp-hidden{display:none!important}
    @media(max-width:600px){#${ROOT_ID} .corp-shell{padding:12px}#${ROOT_ID} .corp-head{padding:18px}#${ROOT_ID} .corp-head h2{font-size:20px}}
  `;
  document.head.appendChild(style);

  const root = document.createElement('section');
  root.id = ROOT_ID;
  root.innerHTML = `
    <div class="corp-shell">
      <header class="corp-head">
        <h2>PGROWTH CORPORATE</h2>
        <p>Cartão Empresarial · Gestão de empresas, colaboradores e desafios corporativos</p>
      </header>
      <div id="corp-message" class="corp-status">A carregar o Cartão Empresarial...</div>
      <div id="corp-content"></div>
    </div>
  `;

  const target = document.querySelector('main') || document.body;
  target.appendChild(root);

  const content = root.querySelector('#corp-content');
  const message = root.querySelector('#corp-message');

  let companies = [];
  let currentCompany = null;
  let dashboard = null;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    })[c]);
  }

  function notify(text, type = '') {
    message.textContent = text;
    message.className = 'corp-status' + (type ? ' ' + type : '');
  }

  async function sessionToken() {
    if (window.PGrowthSession && typeof window.PGrowthSession.token === 'function') {
      return await window.PGrowthSession.token();
    }
    return null;
  }

  async function request(action, data = {}) {
    const token = await sessionToken();
    if (!token) throw new Error('A sessão expirou. Entre novamente na sua conta PGrowth.');

    const response = await fetch(API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({ action, ...data })
    });

    let result;
    try { result = await response.json(); }
    catch (_) { throw new Error('Resposta inválida do servidor.'); }

    if (!response.ok || result.success === false) {
      throw new Error(result.error || result.message || 'Não foi possível concluir a operação.');
    }
    return result;
  }

  function field(label, name, type = 'text', required = true, placeholder = '') {
    return `
      <label>${escapeHtml(label)}</label>
      <input name="${escapeHtml(name)}" type="${escapeHtml(type)}"
        ${required ? 'required' : ''}
        ${placeholder ? `placeholder="${escapeHtml(placeholder)}"` : ''}>
    `;
  }

  function selectField(label, name, options, required = true) {
    return `
      <label>${escapeHtml(label)}</label>
      <select name="${escapeHtml(name)}" ${required ? 'required' : ''}>
        ${options.map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('')}
      </select>
    `;
  }

  function formData(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  function button(text, action, cls = 'primary') {
    return `<button type="button" class="${cls}" data-action="${escapeHtml(action)}">${escapeHtml(text)}</button>`;
  }

  function registrationView() {
    content.innerHTML = `
      <div class="corp-card">
        <h3>Registar empresa</h3>
        <p class="corp-muted">Crie o perfil empresarial. O acesso corporativo será activado após validação do contrato e aprovação do pagamento.</p>
        <form id="corp-register">
          ${field('Nome da empresa','company_name')}
          ${field('NUIT','nuit', 'text', false)}
          ${field('Sector de actividade','industry', 'text', false)}
          ${field('Nome do responsável','contact_name')}
          ${field('Telefone','phone','tel')}
          ${field('E-mail empresarial','email','email',false)}
          ${field('Cidade / Província','location','text',false)}
          <div class="corp-actions"><button class="primary" type="submit">REGISTAR EMPRESA</button></div>
        </form>
      </div>
    `;
  }

  function companyPicker() {
    if (companies.length <= 1) return '';
    return `
      <div class="corp-card">
        <h3>As minhas empresas</h3>
        <select id="corp-company-picker">
          ${companies.map(c => `<option value="${escapeHtml(c.id)}" ${currentCompany && c.id === currentCompany.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
        </select>
      </div>
    `;
  }

  function listItems(items, render) {
    if (!Array.isArray(items) || !items.length) return '<p class="corp-muted">Ainda não existem registos.</p>';
    return items.map(render).join('');
  }

  function dashboardView() {
    const company = dashboard.company || currentCompany || {};
    const contracts = dashboard.contracts || [];
    const members = dashboard.members || [];
    const departments = dashboard.departments || [];
    const challenges = dashboard.challenges || [];
    const events = dashboard.events || [];
    const contract = contracts[0] || {};
    const departmentOptions = [
      { value:'', label:'Toda a empresa' },
      ...departments.map(d => ({ value:d.id, label:d.name }))
    ];

    content.innerHTML = `
      ${companyPicker()}
      <div class="corp-card">
        <div class="corp-grid">
          <div><span class="corp-muted">EMPRESA</span><h3>${escapeHtml(company.name || 'Empresa')}</h3></div>
          <div><span class="corp-muted">ESTADO</span><p><span class="corp-pill">${escapeHtml(company.status || 'PENDING')}</span></p></div>
          <div><span class="corp-muted">COLABORADORES</span><h3>${members.length}</h3></div>
          <div><span class="corp-muted">CONTRATO</span><h3>${escapeHtml(contract.status || 'Sem contrato')}</h3></div>
        </div>
      </div>

      <div class="corp-card">
        <h3>Contrato empresarial</h3>
        <p class="corp-muted">Preço fixo negociado por período. Colaboradores ilimitados. O acesso só é activado após aprovação manual do pagamento pela administração PGrowth.</p>
        ${listItems(contracts, c => `
          <div class="corp-item">
            <strong>${escapeHtml(c.period || 'Período')}</strong> · ${escapeHtml(c.amount_mzn ?? '—')} MT
            <span class="corp-pill">${escapeHtml(c.status || 'PENDING')}</span>
            <div class="corp-muted">${escapeHtml(c.starts_at || 'Por iniciar')} ${c.ends_at ? ' — ' + escapeHtml(c.ends_at) : ''}</div>
          </div>
        `)}
        <form id="corp-payment">
          <h3>Submeter pagamento</h3>
          ${selectField('Contrato','contract_id',contracts.map(c => ({value:c.id,label:`${c.period} · ${c.amount_mzn} MT · ${c.status}`})))}
          ${field('Valor pago (MT)','amount_mzn','number')}
          ${selectField('Método de pagamento','payment_method',[
            {value:'MPESA',label:'M-Pesa'},
            {value:'EMOLA',label:'e-Mola'},
            {value:'BANK',label:'Transferência bancária'},
            {value:'CASH',label:'Numerário'}
          ])}
          ${field('Referência / comprovativo (URL)','proof_url','url',false)}
          <button class="primary" type="submit">SUBMETER PAGAMENTO</button>
        </form>
      </div>

      <div class="corp-grid">
        <div class="corp-card">
          <h3>Departamentos</h3>
          ${listItems(departments, d => `<div class="corp-item">${escapeHtml(d.name)}</div>`)}
          <form id="corp-department">
            ${field('Nome do departamento','name')}
            ${field('Descrição','description','text',false)}
            <button class="primary" type="submit">CRIAR DEPARTAMENTO</button>
          </form>
        </div>
        <div class="corp-card">
          <h3>Convidar colaborador</h3>
          <form id="corp-invite">
            ${field('Nome do colaborador','full_name')}
            ${field('E-mail','email','email',false)}
            ${field('Telefone','phone','tel',false)}
            ${selectField('Departamento','department_id',departmentOptions,false)}
            ${selectField('Função','role',[
              {value:'MEMBER',label:'Colaborador'},
              {value:'DEPARTMENT_HEAD',label:'Chefe de departamento'}
            ])}
            <button class="primary" type="submit">GERAR CONVITE</button>
          </form>
          <p class="corp-muted">O convite será gerado para partilhar com o colaborador.</p>
        </div>
      </div>

      <div class="corp-card">
        <h3>Desafios corporativos</h3>
        ${listItems(challenges, c => `<div class="corp-item"><strong>${escapeHtml(c.title)}</strong> · ${escapeHtml(c.status || 'ACTIVE')}<div class="corp-muted">${escapeHtml(c.description || '')}</div></div>`)}
        <form id="corp-challenge">
          ${field('Título do desafio','title')}
          ${field('Descrição','description','text',false)}
          ${selectField('Âmbito','scope',[
            {value:'COMPANY',label:'Toda a empresa'},
            {value:'DEPARTMENT',label:'Departamento'}
          ])}
          ${selectField('Departamento','department_id',departmentOptions,false)}
          ${selectField('Tipo de meta','metric',[
            {value:'DISTANCE_KM',label:'Distância (km)'},
            {value:'DURATION_MIN',label:'Duração (minutos)'},
            {value:'SESSIONS',label:'Número de actividades'}
          ])}
          ${field('Meta','target_value','number')}
          ${field('Data de início','starts_at','date')}
          ${field('Data de fim','ends_at','date')}
          <button class="primary" type="submit">CRIAR DESAFIO</button>
        </form>
      </div>

      <div class="corp-card">
        <h3>Eventos empresariais</h3>
        ${listItems(events, e => `<div class="corp-item"><strong>${escapeHtml(e.title)}</strong><div class="corp-muted">${escapeHtml(e.starts_at || '')}</div></div>`)}
        <form id="corp-event">
          ${field('Nome do evento','title')}
          ${field('Descrição','description','text',false)}
          ${field('Local','location','text',false)}
          ${field('Data e hora','starts_at','datetime-local')}
          <button class="primary" type="submit">CRIAR EVENTO</button>
        </form>
      </div>

      <div class="corp-card">
        <h3>Colaboradores</h3>
        ${listItems(members, m => `<div class="corp-item"><strong>${escapeHtml(m.full_name || m.user_id || 'Colaborador')}</strong> · ${escapeHtml(m.role || 'MEMBER')} <span class="corp-pill">${escapeHtml(m.status || 'ACTIVE')}</span></div>`)}
      </div>
      <div class="corp-actions">${button('ACTUALIZAR PAINEL','refresh','secondary')}</div>
      <div class="corp-card">
        <h3>Administração PGrowth</h3>
        <p class="corp-muted">Área exclusiva para administradores autorizados. O servidor confirma as permissões antes de apresentar os dados.</p>
        ${button('ABRIR ADMINISTRAÇÃO','admin','secondary')}
        <div id="corp-admin-area"></div>
      </div>
    `;
  }

  async function loadCompanies() {
    const result = await request('MY_COMPANIES');
    companies = result.companies || [];
    if (!companies.length) {
      currentCompany = null;
      dashboard = null;
      registrationView();
      notify('Ainda não existe uma empresa associada à sua conta.', '');
      return;
    }
    currentCompany = companies[0];
    await loadDashboard(currentCompany.id);
  }

  async function loadDashboard(companyId) {
    notify('A carregar os dados da empresa...');
    const result = await request('GET_DASHBOARD', { company_id: companyId });
    dashboard = result;
    currentCompany = result.company || companies.find(c => c.id === companyId) || currentCompany;
    dashboardView();
    notify('Painel empresarial actualizado.', 'success');
  }

  async function adminView() {
    const area = root.querySelector('#corp-admin-area');
    if (!area) return;
    area.innerHTML = '<p class="corp-muted">A carregar administração...</p>';
    try {
      const result = await request('ADMIN_LIST');
      const allCompanies = result.companies || [];
      const payments = result.payments || [];
      area.innerHTML = `
        <div class="corp-section">
          <h3>Empresas registadas</h3>
          ${listItems(allCompanies, c => `<div class="corp-item"><strong>${escapeHtml(c.name)}</strong> · ${escapeHtml(c.status)} · ${escapeHtml(c.id)}</div>`)}
        </div>
        <div class="corp-section">
          <h3>Pagamentos pendentes</h3>
          ${listItems(payments, p => `
            <div class="corp-item">
              <strong>${escapeHtml(p.amount_mzn)} MT</strong> · ${escapeHtml(p.payment_method)} · ${escapeHtml(p.status)}
              <div class="corp-muted">Contrato: ${escapeHtml(p.contract_id)}</div>
              <div class="corp-actions">
                <button class="primary" data-payment-approve="${escapeHtml(p.id)}">APROVAR</button>
                <button class="danger" data-payment-reject="${escapeHtml(p.id)}">REJEITAR</button>
              </div>
            </div>
          `)}
        </div>
        <div class="corp-card">
          <h3>Definir contrato</h3>
          <form id="corp-admin-contract">
            ${field('ID da empresa','company_id')}
            ${selectField('Período','period',[
              {value:'MONTHLY',label:'Mensal'},
              {value:'QUARTERLY',label:'Trimestral'},
              {value:'ANNUAL',label:'Anual'},
              {value:'CUSTOM',label:'Personalizado'}
            ])}
            ${field('Preço negociado (MT)','amount_mzn','number')}
            ${field('Data de início (personalizado)','starts_at','date',false)}
            ${field('Data de fim (personalizado)','ends_at','date',false)}
            <button class="primary" type="submit">CRIAR CONTRATO</button>
          </form>
        </div>
      `;
    } catch (error) {
      area.innerHTML = `<div class="corp-status error">${escapeHtml(error.message)}</div>`;
    }
  }

  content.addEventListener('submit', async event => {
    const form = event.target;
    if (!form.id.startsWith('corp-')) return;
    event.preventDefault();

    try {
      const data = formData(form);
      let result;

      switch (form.id) {
        case 'corp-register':
          result = await request('REGISTER_COMPANY', data);
          notify('Empresa registada. Aguarde a configuração e aprovação do contrato.', 'success');
          await loadCompanies();
          break;

        case 'corp-payment':
          data.amount_mzn = Number(data.amount_mzn);
          result = await request('SUBMIT_PAYMENT', {
            ...data,
            company_id: currentCompany.id
          });
          notify('Pagamento submetido para aprovação da administração PGrowth.', 'success');
          await loadDashboard(currentCompany.id);
          break;

        case 'corp-department':
          result = await request('CREATE_DEPARTMENT', {
            ...data,
            company_id: currentCompany.id
          });
          notify('Departamento criado.', 'success');
          await loadDashboard(currentCompany.id);
          break;

        case 'corp-invite':
          if (!data.email && !data.phone) throw new Error('Indique o e-mail ou o telefone do colaborador.');
          result = await request('INVITE_MEMBER', {
            ...data,
            company_id: currentCompany.id
          });
          notify('Convite criado. Código: ' + (result.token || result.invite_token || 'consulte a resposta do servidor'), 'success');
          await loadDashboard(currentCompany.id);
          break;

        case 'corp-challenge':
          data.target_value = Number(data.target_value);
          data.company_id = currentCompany.id;
          if (data.scope === 'COMPANY') data.department_id = null;
          result = await request('CREATE_CHALLENGE', data);
          notify('Desafio criado.', 'success');
          await loadDashboard(currentCompany.id);
          break;

        case 'corp-event':
          result = await request('CREATE_EVENT', {
            ...data,
            company_id: currentCompany.id
          });
          notify('Evento empresarial criado.', 'success');
          await loadDashboard(currentCompany.id);
          break;

        case 'corp-admin-contract':
          data.amount_mzn = Number(data.amount_mzn);
          result = await request('ADMIN_SET_CONTRACT', data);
          notify('Contrato criado.', 'success');
          await adminView();
          break;
      }
    } catch (error) {
      notify(error.message || 'Ocorreu um erro.', 'error');
    }
  });

  content.addEventListener('change', async event => {
    if (event.target.id === 'corp-company-picker') {
      try { await loadDashboard(event.target.value); }
      catch (error) { notify(error.message, 'error'); }
    }
  });

  content.addEventListener('click', async event => {
    const target = event.target.closest('button');
    if (!target) return;

    try {
      if (target.dataset.action === 'refresh') {
        await loadDashboard(currentCompany.id);
      } else if (target.dataset.action === 'admin') {
        await adminView();
      } else if (target.dataset.paymentApprove) {
        await request('ADMIN_APPROVE_PAYMENT', { payment_id: target.dataset.paymentApprove });
        notify('Pagamento aprovado e contrato processado.', 'success');
        await adminView();
      } else if (target.dataset.paymentReject) {
        const reason = window.prompt('Motivo da rejeição:') || '';
        if (!reason.trim()) return;
        await request('ADMIN_REJECT_PAYMENT', {
          payment_id: target.dataset.paymentReject,
          reason
        });
        notify('Pagamento rejeitado.', 'success');
        await adminView();
      }
    } catch (error) {
      notify(error.message, 'error');
    }
  });

  if (!sessionToken()) {
    notify('Entre na sua conta PGrowth para aceder ao Cartão Empresarial.', 'error');
    content.innerHTML = '';
  } else {
    loadCompanies().catch(error => notify(error.message, 'error'));
  }
})();

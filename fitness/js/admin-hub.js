(() => {
  "use strict";

  if (document.getElementById("pgrowth-admin-hub")) return;

  const style = document.createElement("style");
  style.textContent = `
    #pgrowth-admin-hub {
      margin: 22px 0;
      color: inherit;
      font-family: inherit;
    }
    #pgrowth-admin-hub .hub-heading {
      display:flex;
      justify-content:space-between;
      align-items:center;
      flex-wrap:wrap;
      gap:12px;
      margin-bottom:16px;
    }
    #pgrowth-admin-hub .hub-heading h2 {
      margin:0;
      font-size:22px;
      font-weight:900;
    }
    #pgrowth-admin-hub .hub-heading p {
      margin:5px 0 0;
      opacity:.7;
      font-size:13px;
    }
    #pgrowth-admin-hub .hub-grid {
      display:grid;
      grid-template-columns:repeat(auto-fit,minmax(210px,1fr));
      gap:13px;
    }
    #pgrowth-admin-hub .hub-card {
      display:flex;
      flex-direction:column;
      justify-content:space-between;
      min-height:145px;
      padding:18px;
      border:1px solid rgba(214,173,85,.28);
      border-radius:13px;
      background:linear-gradient(145deg,#191919,#0b0b0b);
      color:#fff;
      text-decoration:none;
      transition:transform .2s,border-color .2s;
    }
    #pgrowth-admin-hub .hub-card:hover {
      transform:translateY(-3px);
      border-color:#d6ad55;
    }
    #pgrowth-admin-hub .hub-icon {
      font-size:25px;
      margin-bottom:12px;
    }
    #pgrowth-admin-hub .hub-card strong {
      display:block;
      font-size:15px;
      margin-bottom:7px;
      color:#e0bd70;
    }
    #pgrowth-admin-hub .hub-card span {
      font-size:12px;
      line-height:1.5;
      opacity:.75;
    }
    #pgrowth-admin-hub .hub-arrow {
      margin-top:13px;
      font-size:11px;
      font-weight:900;
      letter-spacing:1px;
      color:#e0bd70;
    }
    #pgrowth-admin-hub .hub-note {
      margin-top:15px;
      padding:13px 15px;
      border-left:3px solid #d6ad55;
      border-radius:5px;
      background:rgba(214,173,85,.07);
      font-size:12px;
      line-height:1.6;
      opacity:.85;
    }
  `;
  document.head.appendChild(style);

  const section = document.createElement("section");
  section.id = "pgrowth-admin-hub";
  section.innerHTML = `
    <div class="hub-heading">
      <div>
        <h2>PGrowth · Centro de Administração</h2>
        <p>Gestão centralizada da plataforma Fitness</p>
      </div>
    </div>

    <div class="hub-grid">
      <a class="hub-card" href="admin-passes.html">
        <div>
          <div class="hub-icon">🎟️</div>
          <strong>Passes Completos</strong>
          <span>Consultar pedidos e gerir aprovações dos Passes.</span>
        </div>
        <div class="hub-arrow">ABRIR MÓDULO →</div>
      </a>

      <a class="hub-card" href="marketplace-admin.html">
        <div>
          <div class="hub-icon">🛍️</div>
          <strong>Marketplace</strong>
          <span>Gerir produtos, eventos e encomendas.</span>
        </div>
        <div class="hub-arrow">ABRIR MÓDULO →</div>
      </a>

      <a class="hub-card" href="treinadores.html">
        <div>
          <div class="hub-icon">🏋️</div>
          <strong>Área de Treinadores</strong>
          <span>Acesso à área profissional existente.</span>
        </div>
        <div class="hub-arrow">ABRIR ÁREA →</div>
      </a>
    </div>

    <div class="hub-note">
      Os módulos existentes continuam preservados. A centralização das operações,
      permissões administrativas, desafios e vídeos será integrada sem retirar
      funcionalidades aos atletas nem apagar dados existentes.
    </div>
  `;

  const main = document.querySelector("main") ||
               document.querySelector(".container") ||
               document.body;

  main.prepend(section);
})();

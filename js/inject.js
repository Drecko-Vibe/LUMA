// =========================================================
// INTERFACE
// =========================================================
function criarSubBotao(nome, sigla, acao) {
  const wrapper = document.createElement('div');
  wrapper.className = 'luma-sub-btn-wrapper';

  const label = document.createElement('div');
  label.className = 'luma-sub-label';
  label.innerText = nome;

  const btn = document.createElement('button');
  btn.className = 'luma-sub-btn';
  btn.dataset.lumaAction = acao;
  btn.innerHTML = '<span>' + sigla + '</span>';

  wrapper.appendChild(label);
  wrapper.appendChild(btn);

  return wrapper;
}

function injetarBotaoLuma() {
  if (document.getElementById('luma-fab-container')) return;

  const container = document.createElement('div');
  container.id = 'luma-fab-container';

  const quickHub = document.createElement('div');
  quickHub.id = 'luma-quick-hub';

  const btnTagSense = criarSubBotao('TagSense', 'T', 'tagsense');
  quickHub.appendChild(btnTagSense);
  quickHub.appendChild(criarSubBotao('Varredura', 'V', 'varredura'));

  const btnMonitoring = criarSubBotao('Monitoring', 'M', 'monitoring');
  btnMonitoring.style.display = 'none';
  quickHub.appendChild(btnMonitoring);

  const botaoPrincipal = document.createElement('button');
  botaoPrincipal.id = 'luma-main-fab';
  botaoPrincipal.innerHTML = '<span class="luma-fab-icon">L</span>';

  container.appendChild(quickHub);
  container.appendChild(botaoPrincipal);
  document.body.appendChild(container);

  if (typeof iniciarFisicaDoLuma === 'function') {
    iniciarFisicaDoLuma();
  }
}

window.addEventListener('load', injetarBotaoLuma);
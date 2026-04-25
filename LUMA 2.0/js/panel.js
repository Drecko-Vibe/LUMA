// =========================================================
// UTILIDADE GLOBAL (A Chave Mestra para todos os Motores)
// =========================================================
function getLumaTokenGlobal() {
    let token = localStorage.getItem('authorization') || sessionStorage.getItem('authorization');
    
    if (!token) {
        const match = document.cookie.match(/(?:^|; )authorization=([^;]*)/);
        if (match) token = decodeURIComponent(match[1]);
    }

    if (token && !token.toLowerCase().startsWith('bearer ')) {
        token = `Bearer ${token}`;
    }
    
    return token;
}

// =========================================================
// MÓDULO DE NEGÓCIOS: MOTOR DA VARREDURA
// =========================================================
const MotorVarredura = {
  estado: {
    rodando: false, pausado: false, cancelado: false,
    progressoAtual: 0, metaTotal: 0, relevantesEncontrados: 0,
    resultadosGlobais: [], protocolosJaLidos: new Set()
  },

  capturarConfiguracoes() {
    const painel = document.getElementById('luma-panel-container');
    const escopoMsg = painel.querySelector('input[name="luma-msg-scope"]:checked').value;
    
    return {
      prompt: painel.querySelector('#luma-varredura-prompt').value.trim(),
      preFiltroLigado: painel.querySelector('#luma-toggle-filtro').checked,
      preFiltroTexto: painel.querySelector('#luma-varredura-prefiltro').value.trim(),
      escopo: escopoMsg,
      quantidade: (() => {
        const select = painel.querySelector('#luma-qtd-itens').value;
        const input = parseInt(painel.querySelector('#luma-qtd-input').value);
        return select === 'outro' ? (input > 0 ? input : 50) : select;
      })(),
      tipoExportacao: painel.querySelector('#luma-tipo-export').value,
      baixarAoConcluir: painel.querySelector('#luma-check-baixar').checked
    };
  },

iniciarEventos() {
    const painel = document.getElementById('luma-panel-container');

    const btnIniciar = painel.querySelector('#luma-btn-iniciar');
    const btnPausar = painel.querySelector('#luma-btn-pausar');
    const btnCancelar = painel.querySelector('#luma-btn-cancelar');
    const btnExportar = painel.querySelector('#luma-btn-exportar');
    if (btnIniciar) btnIniciar.addEventListener('click', () => this.acaoIniciar());
    if (btnPausar) btnPausar.addEventListener('click', () => this.acaoPausar());
    if (btnCancelar) btnCancelar.addEventListener('click', () => this.acaoCancelar());
    if (btnExportar) btnExportar.addEventListener('click', () => this.acaoExportar());
    const elSelect = painel.querySelector('#luma-qtd-itens');
    const elDiv = painel.querySelector('#luma-qtd-custom');
    const elInput = painel.querySelector('#luma-qtd-input');
    const btnAbrirSelect = painel.querySelector('#luma-btn-abrir-select');

    if (elSelect) {
      elSelect.addEventListener('change', (e) => {
        if (e.target.value === 'outro') {
          elSelect.style.opacity = '0'; 
          elSelect.style.pointerEvents = 'none';
          if (elDiv) elDiv.style.display = 'block';
          if (elInput) elInput.focus();
        } else {
          elSelect.style.opacity = '1';
          elSelect.style.pointerEvents = 'auto';
          if (elDiv) elDiv.style.display = 'none';
        }
      });
    }

    if (btnAbrirSelect) {
      btnAbrirSelect.addEventListener('click', (e) => {
        e.preventDefault();
        if (elDiv) elDiv.style.display = 'none';
        if (elSelect) {
          elSelect.style.opacity = '1';
          elSelect.style.pointerEvents = 'auto';
          elSelect.value = '50';
          void elSelect.offsetHeight;
          try { elSelect.showPicker(); } catch(err) { elSelect.focus(); }
        }
      });
    }
  },

 acaoIniciar() {
    if (this.estado.rodando) return;
    const config = this.capturarConfiguracoes();
    if (!config.prompt) return alert("LUMA: Por favor, digite um prompt para a IA antes de iniciar.");

    this.estado.metaTotal = config.quantidade === "todos" ? 999999 : parseInt(config.quantidade);
    this.estado.progressoAtual = 0;
    this.estado.relevantesEncontrados = 0;
    this.estado.resultadosGlobais = [];
    this.estado.protocolosJaLidos.clear();
    
    this.estado.rodando = true; this.estado.pausado = false; this.estado.cancelado = false;
    this.atualizarInterfaceBotoes(); this.iniciarAnimacaoStatus();
    
    this.estado.primeiraRodada = true; 
    
    this.processarPaginaAtual();
  },

  async processarPaginaAtual() {
    if (this.estado.cancelado) return;

    const token = getLumaTokenGlobal();
    if (!token) return alert("LUMA Erro: Não encontrei o token de acesso. Recarregue a página.");

    const config = this.capturarConfiguracoes();

    // 1. DUPLA PROTEÇÃO: Tenta pegar do Espião (Cofre) OU da Memória do Chrome
    let urlSalva = sessionStorage.getItem('LUMA_LAST_FILTER');

    if (!urlSalva) {
        const resources = performance.getEntriesByType("resource");
        const lastRequest = resources.reverse().find(r => r.name.includes("/service_report/list"));
        if (lastRequest) urlSalva = lastRequest.name;
    }

    let apiUrl = "";
    if (urlSalva) {
        const urlObj = new URL(urlSalva.startsWith('http') ? urlSalva : window.location.origin + urlSalva);
        const limiteDesejado = this.estado.metaTotal === 999999 ? 50 : Math.min(50, this.estado.metaTotal - this.estado.progressoAtual);
        urlObj.searchParams.set("filters[limit]", limiteDesejado);
        urlObj.searchParams.set("filters[offset]", this.estado.progressoAtual);
        apiUrl = urlObj.toString();
    } else {
        this.estado.rodando = false; this.atualizarInterfaceBotoes(); this.pararAnimacaoStatus();
        return alert("LUMA: Não consegui capturar os filtros! Por favor, clique no botão 'Filtrar' da Clinicorp e tente novamente.");
    }

    // 2. BUSCA NA API FANTASMA
    try {
        this.atualizarBarraDeProgresso(this.estado.progressoAtual, config.quantidade, this.estado.relevantesEncontrados, "Acessando API Fantasma...");

        const resposta = await fetch(apiUrl, {
            method: "GET",
            headers: { "accept": "application/json", "authorization": token }
        });

        if (!resposta.ok) throw new Error("Erro na API: " + resposta.status);

        const json = await resposta.json();
        const atendimentos = json.rows || [];

        if (atendimentos.length === 0) {
            this.estado.rodando = false; this.atualizarInterfaceBotoes(); this.pararAnimacaoStatus();
            document.querySelector('#luma-panel-container .luma-info-box').innerHTML = `<b>Fim da lista atingido!</b>`;
            if (config.baixarAoConcluir) setTimeout(() => this.acaoExportar(), 500);
            return;
        }

        const loteParaIA = [];
        atendimentos.forEach(item => {
            const idStr = String(item.id); 
            if (!this.estado.protocolosJaLidos.has(idStr)) {
                loteParaIA.push({
                    protocolo: idStr,
                    idClinica: item.SubscriberUuId || '', 
                    dataInicio: item.StartDate ? new Date(item.StartDate).toLocaleString('pt-BR') : '' 
                });
                this.estado.protocolosJaLidos.add(idStr);
            }
        });

        config.protocolosCapturados = loteParaIA;
        config.globalTotal = this.estado.metaTotal === 999999 ? "∞" : this.estado.metaTotal;
        config.isNovaVarredura = this.estado.primeiraRodada;
        this.estado.primeiraRodada = false;

        this.atualizarBarraDeProgresso(this.estado.progressoAtual, config.globalTotal, this.estado.relevantesEncontrados, `Enviando ${loteParaIA.length} itens para auditoria...`);

        chrome.runtime.sendMessage({ acao: "INICIAR_VARREDURA_FANTASMA", config: config, token: token });

    } catch (erro) {
        console.error("LUMA Erro Crítico:", erro);
        this.estado.rodando = false; this.atualizarInterfaceBotoes(); this.pararAnimacaoStatus();
        alert("Erro ao ler API. Veja o console.");
    }
  },

  tentarPularPagina() {
      if (this.estado.cancelado) return false;
      if (this.estado.metaTotal !== 999999 && this.estado.progressoAtual >= this.estado.metaTotal) {
          return false;
      }

      this.atualizarBarraDeProgresso(
          this.estado.progressoAtual,
          this.estado.metaTotal === 999999 ? "∞" : this.estado.metaTotal,
          this.estado.relevantesEncontrados,
          "Carregando mais itens invisíveis..."
      );

      console.log("LUMA: Continuando pela API com offset", this.estado.progressoAtual);
      setTimeout(() => { if (!this.estado.cancelado) this.processarPaginaAtual(); }, 1000);
      return true;
  },

  acaoPausar() {
    if (!this.estado.rodando) return;
    this.estado.pausado = !this.estado.pausado;
    const btnPausar = document.getElementById('luma-btn-pausar');
    const btnIniciar = document.getElementById('luma-btn-iniciar');
    
    if (this.estado.pausado) {
      btnPausar.innerText = "Continuar"; btnPausar.style.backgroundColor = "#E2A03F"; 
      btnIniciar.innerText = "Pausado"; btnIniciar.style.opacity = "0.5";
    } else {
      btnPausar.innerText = "Pausar"; btnPausar.style.backgroundColor = ""; 
      btnIniciar.innerText = "Varrendo"; btnIniciar.style.opacity = "0.85";
    }
  },

  acaoCancelar() {
    if (!this.estado.rodando) return;
    this.estado.cancelado = true; this.estado.rodando = false; this.estado.pausado = false;
    this.atualizarInterfaceBotoes(); this.pararAnimacaoStatus();
    document.getElementById('luma-btn-pausar').innerText = "Pausar";
    document.getElementById('luma-btn-pausar').style.backgroundColor = "";
    document.querySelector('.luma-info-box').innerText = "Varredura cancelada pelo usuário.";
  },

  acaoExportar() {
    if (!this.estado.resultados || this.estado.resultados.length === 0) {
      return alert("LUMA: Não há dados para exportar. Faça uma varredura primeiro!");
    }

    if (typeof ExcelJS === 'undefined') {
      return alert("LUMA Erro: A biblioteca do Excel não foi carregada corretamente.");
    }

    const config = this.capturarConfiguracoes();
    console.log("LUMA 2.0: Gerando Excel premium...", this.estado.resultados);

    let dadosParaExportar = this.estado.resultados;
    if (config.tipoExportacao === "relevantes") {
      dadosParaExportar = dadosParaExportar.filter(item => item.assertivo === "Sim");
    }

    if (dadosParaExportar.length === 0) {
      return alert("LUMA: A varredura não encontrou nenhum item relevante para exportar.");
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Varredura IA');

    worksheet.columns = [
      { header: 'Data Início', key: 'dataInicio', width: 22 },
      { header: 'Protocolo', key: 'protocolo', width: 15 },
      { header: 'ID (Clínica)', key: 'idClinica', width: 15 },
      { header: 'Relevante?', key: 'assertivo', width: 15 },
      { header: 'Resumo da Conversa (IA)', key: 'resumo', width: 90 }
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF6B00' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 25;

    dadosParaExportar.forEach((item, index) => {
      const row = worksheet.addRow(item);
      
      if (index % 2 === 0) {
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F7F7' } };
      }

      row.getCell('dataInicio').alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell('protocolo').alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell('idClinica').alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell('resumo').alignment = { vertical: 'middle', wrapText: true };

      const celulaAssertivo = row.getCell('assertivo');
      celulaAssertivo.alignment = { vertical: 'middle', horizontal: 'center' };
      celulaAssertivo.font = { bold: true };
      
      if (item.assertivo === 'Sim') {
        celulaAssertivo.font = { color: { argb: 'FF008000' }, bold: true }; 
      } else if (item.assertivo === 'Não') {
        celulaAssertivo.font = { color: { argb: 'FFD32F2F' }, bold: true }; 
      } else {
        celulaAssertivo.font = { color: { argb: 'FFF57C00' }, bold: true }; 
      }
    });

    workbook.xlsx.writeBuffer().then(buffer => {
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const dataHoje = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      a.download = `LUMA_Varredura_${dataHoje}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);
    }).catch(err => {
      console.error("Erro ao gerar Excel:", err);
      alert("Erro ao gerar o arquivo Excel. Veja o console.");
    });
  },

  atualizarInterfaceBotoes() {
    const btnIniciar = document.getElementById('luma-btn-iniciar');
    const btnPausar = document.getElementById('luma-btn-pausar');
    const btnCancelar = document.getElementById('luma-btn-cancelar');

    if (this.estado.rodando) {
      btnIniciar.disabled = true; btnIniciar.classList.add('luma-estado-varrendo'); btnIniciar.innerText = 'Varrendo';
      btnPausar.disabled = false; btnPausar.style.opacity = '1';
      btnCancelar.disabled = false; btnCancelar.style.opacity = '1';
    } else {
      btnIniciar.disabled = false; btnIniciar.classList.remove('luma-estado-varrendo'); btnIniciar.style.opacity = ''; btnIniciar.innerText = 'Iniciar';
      btnPausar.disabled = true; btnPausar.style.opacity = '0.5';
      btnCancelar.disabled = true; btnCancelar.style.opacity = '0.5';
    }
  },

  atualizarBarraDeProgresso(atualExibicao, totalExibicao, relevantesExibicao, statusTexto) {
    document.getElementById('luma-val-progresso').innerText = `${atualExibicao}/${totalExibicao}`;
    document.getElementById('luma-val-relevantes').innerText = relevantesExibicao;
    
    const pct = totalExibicao === "∞" || totalExibicao === 0 ? 0 : Math.min(100, Math.round((atualExibicao / totalExibicao) * 100));
    document.getElementById('luma-bar-fill').style.width = `${pct}%`;

    if(statusTexto) {
        this.estado.statusAtual = statusTexto;
        const infoBox = document.querySelector('#luma-panel-container .luma-info-box');
        if (infoBox) {
            if (this.estado.rodando && !this.estado.pausado) {
                infoBox.innerHTML = `<span class="luma-spinner"></span> <b>Status:</b> ${statusTexto}`;
                infoBox.classList.add('luma-box-loading');
            } else {
                infoBox.innerHTML = `<b>Status:</b> ${statusTexto}`;
                infoBox.classList.remove('luma-box-loading');
            }
        }
    }
  },

  iniciarAnimacaoStatus() {
    this.atualizarBarraDeProgresso(this.estado.progressoAtual, this.estado.metaTotal, this.estado.relevantesEncontrados, "Iniciando os motores...");
  },

  pararAnimacaoStatus() {
    const infoBox = document.querySelector('#luma-panel-container .luma-info-box');
    if(infoBox) infoBox.classList.remove('luma-box-loading');
  }
};

// =========================================================
// MOTOR 2: TAGSENSE (Modo Fantasma 3.0)
// =========================================================
const MotorTagSense = {
  estado: {
    rodando: false, pausado: false, cancelado: false,
    progressoAtual: 0, metaTotal: 0, relevantesEncontrados: 0,
    resultadosGlobais: [], protocolosJaLidos: new Set(), primeiraRodada: true
  },

  iniciarEventos() {
    const container = document.getElementById('luma-tagsense-container');
    if (!container) return;

    const btnIniciar = container.querySelector('#tag-btn-iniciar');
    const btnPausar = container.querySelector('#tag-btn-pausar');
    const btnCancelar = container.querySelector('#tag-btn-cancelar');
    const btnExportar = container.querySelector('#tag-btn-exportar');

    if (btnIniciar) btnIniciar.addEventListener('click', () => this.acaoIniciar());
    if (btnPausar) btnPausar.addEventListener('click', () => this.acaoPausar());
    if (btnCancelar) btnCancelar.addEventListener('click', () => this.acaoCancelar());
    if (btnExportar) btnExportar.addEventListener('click', () => this.acaoExportar());
  },

  capturarConfiguracoes() {
    const container = document.getElementById('luma-tagsense-container');
    const selectQtd = container.querySelector('#luma-qtd-itens').value;
    const inputQtd = parseInt(container.querySelector('#luma-qtd-input').value);
    return {
      quantidade: selectQtd === 'outro' ? (inputQtd > 0 ? inputQtd : 50) : selectQtd,
      tipoExportacao: container.querySelector('#luma-tipo-export').value,
      baixarAoConcluir: container.querySelector('#luma-check-baixar').checked
    };
  },

  async acaoIniciar() {
    if (this.estado.rodando) return;
    
    const config = this.capturarConfiguracoes();
    this.estado.metaTotal = config.quantidade === "todos" ? 999999 : parseInt(config.quantidade);
    this.estado.progressoAtual = 0; 
    this.estado.relevantesEncontrados = 0;
    this.estado.resultadosGlobais = []; 
    this.estado.protocolosJaLidos.clear();
    this.estado.primeiraRodada = true;

    this.estado.rodando = true; this.estado.pausado = false; this.estado.cancelado = false;
    
    this.atualizarInterfaceBotoes(); 
    this.processarPaginaAtual();
  },

  async processarPaginaAtual() {
    if (this.estado.cancelado) return;

    const token = getLumaTokenGlobal();
    if (!token) return alert("LUMA Erro: Não encontrei o token JWT. Recarregue a página.");

    const config = this.capturarConfiguracoes();

    // 1. O ESPIÃO DE FILTROS (Cofre Seguro)
    let urlSalva = sessionStorage.getItem('LUMA_LAST_FILTER');
    if (!urlSalva) {
        const resources = performance.getEntriesByType("resource");
        const lastRequest = resources.reverse().find(r => r.name.includes("/service_report/list"));
        if (lastRequest) urlSalva = lastRequest.name;
    }

    let apiUrl = "";
    if (urlSalva) {
        const urlObj = new URL(urlSalva.startsWith('http') ? urlSalva : window.location.origin + urlSalva);
        const limiteDesejado = this.estado.metaTotal === 999999 ? 50 : Math.min(50, this.estado.metaTotal - this.estado.progressoAtual);
        urlObj.searchParams.set("filters[limit]", limiteDesejado);
        urlObj.searchParams.set("filters[offset]", this.estado.progressoAtual);
        apiUrl = urlObj.toString();
    } else {
        this.estado.rodando = false; this.atualizarInterfaceBotoes();
        return alert("LUMA: Filtro não encontrado na memória! Clique em 'Filtrar' na Clinicorp.");
    }

    // 2. BUSCA NA API FANTASMA E EXTRAI AS TAGS
    try {
        this.atualizarBarraDeProgresso(this.estado.progressoAtual, config.quantidade, this.estado.relevantesEncontrados, "Acessando API Fantasma (TagSense)...");

        const resposta = await fetch(apiUrl, { method: "GET", headers: { "accept": "application/json", "authorization": token } });
        if (!resposta.ok) throw new Error("Erro na API: " + resposta.status);

        const json = await resposta.json();
        const atendimentos = json.rows || [];

        if (atendimentos.length === 0) {
            this.estado.rodando = false; this.atualizarInterfaceBotoes();
            document.querySelector('#luma-tagsense-container .luma-info-box').innerHTML = `<b>Fim da lista atingido!</b>`;
            if (config.baixarAoConcluir) setTimeout(() => this.acaoExportar(), 500);
            return;
        }

        const loteParaIA = [];
        atendimentos.forEach(item => {
            const idStr = String(item.id); 
            if (!this.estado.protocolosJaLidos.has(idStr)) {
                // MAPEAMENTO INTELIGENTE DA NOVA API (Tags com "T" maiúsculo)
                // ✅ Lê TODAS as tags do atendimento, não só a primeira
                let tagAplicada = "Sem Tag";
                if (item.Tags && item.Tags.length > 0) {
                    const todasAsTags = item.Tags
                        .map(tag => {
                            const area = tag.area || "";
                            const tipo = tag.type || "";
                            return (area || tipo) ? `${tipo} | ${area}` : null;
                        })
                        .filter(Boolean);
                    if (todasAsTags.length > 0) tagAplicada = todasAsTags.join(" // ");
                }

                loteParaIA.push({
                    protocolo: idStr,
                    idClinica: item.SubscriberUuId || '', 
                    dataInicio: item.StartDate ? new Date(item.StartDate).toLocaleString('pt-BR') : '',
                    agente: item.AgentName || 'Sistema',
                    tagAplicada: tagAplicada
                });
                this.estado.protocolosJaLidos.add(idStr);
            }
        });

        config.protocolosCapturados = loteParaIA;
        config.globalTotal = this.estado.metaTotal === 999999 ? "∞" : this.estado.metaTotal;
        config.isNovaVarredura = this.estado.primeiraRodada;
        this.estado.primeiraRodada = false;

        this.atualizarBarraDeProgresso(this.estado.progressoAtual, config.globalTotal, this.estado.relevantesEncontrados, `Enviando ${loteParaIA.length} itens para Auditoria de Tags...`);

        // Despacha para o Cérebro com a ordem específica do TagSense
        chrome.runtime.sendMessage({ acao: "INICIAR_TAGSENSE_FANTASMA", config: config, token: token });

    } catch (erro) {
        console.error("LUMA Erro Crítico TagSense:", erro);
        this.estado.rodando = false; this.atualizarInterfaceBotoes();
        alert("Erro ao ler API. Veja o console.");
    }
  },

  tentarPularPagina() {
      // Como o GraphQL Fantasma pede 50 por vez, se o progresso não atingiu a meta, ele continua pedindo!
      if (this.estado.progressoAtual < this.estado.metaTotal) {
          this.processarPaginaAtual();
          return true;
      }
      return false;
  },

  acaoPausar() {
    if (!this.estado.rodando) return;
    this.estado.pausado = !this.estado.pausado;
    const container = document.getElementById('luma-tagsense-container');
    const btnPausar = container.querySelector('#tag-btn-pausar');
    const btnIniciar = container.querySelector('#tag-btn-iniciar');
    
    if (this.estado.pausado) {
      btnPausar.innerText = "Continuar"; btnPausar.style.backgroundColor = "#8B5CF6"; 
      btnIniciar.innerText = "Pausado"; btnIniciar.style.opacity = "0.5";
    } else {
      btnPausar.innerText = "Pausar"; btnPausar.style.backgroundColor = ""; 
      btnIniciar.innerText = "Auditando"; btnIniciar.style.opacity = "0.85";
    }
  },

  acaoCancelar() {
    if (!this.estado.rodando) return;
    this.estado.cancelado = true; this.estado.rodando = false; this.estado.pausado = false;
    this.atualizarInterfaceBotoes(); 
    
    const container = document.getElementById('luma-tagsense-container');
    container.querySelector('#tag-btn-pausar').innerText = "Pausar";
    container.querySelector('#tag-btn-pausar').style.backgroundColor = "";
    container.querySelector('.luma-info-box').innerHTML = "<b>Auditoria cancelada.</b>";
  },

  acaoExportar() {
    if (!this.estado.resultadosGlobais || this.estado.resultadosGlobais.length === 0) {
      return alert("LUMA: Não há dados TagSense para exportar.");
    }
    if (typeof ExcelJS === 'undefined') return alert("LUMA Erro: A biblioteca do Excel não foi carregada.");

    const config = this.capturarConfiguracoes();
    let dadosParaExportar = this.estado.resultadosGlobais;
    
    if (config.tipoExportacao === "relevantes") {
      dadosParaExportar = dadosParaExportar.filter(item => item.assertivo === "Não"); // TagSense "relevantes" = as que o humano errou
    }

    if (dadosParaExportar.length === 0) return alert("LUMA: Nenhum item relevante para exportar.");

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('TagSense');

    worksheet.columns = [
      { header: 'Data', key: 'dataInicio', width: 20 },
      { header: 'Protocolo', key: 'protocolo', width: 15 },
      { header: 'ID (Clínica)', key: 'idClinica', width: 15 },
      { header: 'Tag Aplicada', key: 'tagAplicada', width: 45 },
      { header: 'Agente', key: 'agente', width: 25 },
      { header: 'Aprovado?', key: 'assertivo', width: 15 },
      { header: 'Tag Sugerida (IA)', key: 'tagSugerida', width: 45 },
      { header: 'Análise (IA)', key: 'resumo', width: 90 }
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8B5CF6' } }; 
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 25;

    dadosParaExportar.forEach((item, index) => {
      const row = worksheet.addRow(item);
      if (index % 2 === 0) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F7F7' } };
      
      row.getCell('dataInicio').alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell('protocolo').alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell('idClinica').alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell('resumo').alignment = { vertical: 'middle', wrapText: true };
      
      const celulaAssertivo = row.getCell('assertivo');
      celulaAssertivo.alignment = { vertical: 'middle', horizontal: 'center' };
      celulaAssertivo.font = { bold: true };
      
      if (item.assertivo === 'Sim') celulaAssertivo.font.color = { argb: 'FF008000' }; 
      else if (item.assertivo === 'Não') celulaAssertivo.font.color = { argb: 'FFD32F2F' }; 
      else celulaAssertivo.font.color = { argb: 'FFF57C00' }; 
    });

    workbook.xlsx.writeBuffer().then(buffer => {
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = `LUMA_TagSense_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`;
      a.click(); window.URL.revokeObjectURL(url);
    });
  },

  atualizarInterfaceBotoes() {
    const container = document.getElementById('luma-tagsense-container');
    if (!container) return;

    const btnIniciar = container.querySelector('#tag-btn-iniciar');
    const btnPausar = container.querySelector('#tag-btn-pausar');
    const btnCancelar = container.querySelector('#tag-btn-cancelar');

    if (this.estado.rodando) {
      btnIniciar.disabled = true; btnIniciar.classList.add('luma-estado-varrendo'); btnIniciar.innerText = 'Auditando';
      btnPausar.disabled = false; btnPausar.style.opacity = '1';
      btnCancelar.disabled = false; btnCancelar.style.opacity = '1';
    } else {
      btnIniciar.disabled = false; btnIniciar.classList.remove('luma-estado-varrendo'); btnIniciar.style.opacity = ''; btnIniciar.innerText = 'Iniciar';
      btnPausar.disabled = true; btnPausar.style.opacity = '0.5';
      btnCancelar.disabled = true; btnCancelar.style.opacity = '0.5';
    }
  },

  atualizarBarraDeProgresso(atualExibicao, totalExibicao, relevantesExibicao, statusTexto) {
    const container = document.getElementById('luma-tagsense-container');
    if (!container) return;
    
    const progressLabel = container.querySelector('.luma-progress-labels span:nth-child(1) b');
    const relLabel = container.querySelector('.luma-progress-labels span:nth-child(2) b');
    const barFill = container.querySelector('.luma-progress-fill');
    
    if (progressLabel) progressLabel.innerText = `${atualExibicao}/${totalExibicao}`;
    if (relLabel) relLabel.innerText = relevantesExibicao;
    
    const pct = totalExibicao === 0 || totalExibicao === "∞" ? 0 : Math.min(100, Math.round((atualExibicao / totalExibicao) * 100));
    if (barFill) barFill.style.width = `${pct}%`;

    const infoBox = container.querySelector('.luma-info-box');
    if (infoBox && statusTexto) {
        if (this.estado.rodando && !this.estado.pausado) {
            infoBox.innerHTML = `<span class="luma-spinner"></span> <b>Status:</b> ${statusTexto}`;
            infoBox.classList.add('luma-box-loading');
        } else {
            infoBox.innerHTML = `<b>Status:</b> ${statusTexto}`;
            infoBox.classList.remove('luma-box-loading');
        }
    }
  }
};

// =========================================================
// O OUVINTE CENTRAL DE MENSAGENS DO BACKGROUND
// =========================================================
chrome.runtime.onMessage.addListener((mensagem) => {
  if (mensagem.acao === "ATUALIZAR_PROGRESSO") {
    
    // Descobre quem está rodando agora (Laranja ou Roxo?)
    let MotorAtivo = null;
    if (MotorVarredura.estado.rodando) MotorAtivo = MotorVarredura;
    else if (MotorTagSense.estado.rodando) MotorAtivo = MotorTagSense;
    
    if (!MotorAtivo) return; 

    MotorAtivo.atualizarBarraDeProgresso(
      MotorAtivo.estado.progressoAtual + (mensagem.atual || 0), 
      mensagem.config?.globalTotal || MotorAtivo.estado.metaTotal, 
      MotorAtivo.estado.relevantesEncontrados + (mensagem.relevantes || 0), 
      mensagem.status
    );

    if (mensagem.finalizado) {
      MotorAtivo.estado.progressoAtual += mensagem.atual;
      MotorAtivo.estado.relevantesEncontrados += mensagem.relevantes;
      MotorAtivo.estado.resultadosGlobais = MotorAtivo.estado.resultadosGlobais.concat(mensagem.dadosPlanilha);
      MotorAtivo.estado.resultados = MotorAtivo.estado.resultadosGlobais; 
      
      if (MotorAtivo.estado.progressoAtual >= MotorAtivo.estado.metaTotal) {
          MotorAtivo.estado.rodando = false; 
          MotorAtivo.atualizarInterfaceBotoes();
          if(MotorAtivo.pararAnimacaoStatus) MotorAtivo.pararAnimacaoStatus();
          
          const seletorInfo = MotorAtivo === MotorVarredura ? '#luma-panel-container .luma-info-box' : '#luma-tagsense-container .luma-info-box';
          document.querySelector(seletorInfo).innerHTML = `<b>Auditoria Concluída com Sucesso!</b> Clique em Exportar.`;

          // ✅ FIX: Disparar download automático ao atingir o limite de itens
          const configConcluido = MotorAtivo.capturarConfiguracoes();
          if (configConcluido.baixarAoConcluir) setTimeout(() => MotorAtivo.acaoExportar(), 500);
      } else {
          // Continua baixando a próxima página de 50 invisível
          const temMais = MotorAtivo.tentarPularPagina();
          if (!temMais) {
             MotorAtivo.estado.rodando = false; 
             MotorAtivo.atualizarInterfaceBotoes();
             if(MotorAtivo.pararAnimacaoStatus) MotorAtivo.pararAnimacaoStatus();
             
             const seletorInfo = MotorAtivo === MotorVarredura ? '#luma-panel-container .luma-info-box' : '#luma-tagsense-container .luma-info-box';
             document.querySelector(seletorInfo).innerHTML = `<b>Concluído! Fim da lista atingido.</b>`;

             // ✅ FIX: Disparar download automático ao esgotar as páginas disponíveis
             const configEsgotado = MotorAtivo.capturarConfiguracoes();
             if (configEsgotado.baixarAoConcluir) setTimeout(() => MotorAtivo.acaoExportar(), 500);
          }
      }
    }
  }
});

// =========================================================
// 1. CONSTRUÇÃO DO PAINEL HTML (UI-Driven)
// =========================================================
function injetarPainelLuma() {
  if (document.getElementById('luma-panel-container')) return;

  const html = `
    <div id="luma-panel-container">
      <div class="luma-panel-header" id="luma-panel-drag">
        <span>LUMA 2.0 Varredura</span>
        <div class="luma-header-actions">
          <button class="luma-icon-btn" id="luma-minimizar-painel" title="Minimizar">─</button>
          <button class="luma-icon-btn" id="luma-fechar-painel" title="Fechar">✕</button>
        </div>
      </div>

      <div class="luma-panel-content">
        <div class="luma-group">
          <label class="luma-label">Prompt para a IA</label>
          <textarea class="luma-textarea" id="luma-varredura-prompt" placeholder="Ex: atendimentos com reclamação de cobrança duplicada"></textarea>
        </div>

        <div class="luma-row-filtro">
          <button class="luma-btn-outline" id="luma-btn-mini-modal">Filtro (sem IA)</button>
          <div class="luma-switch-wrapper">
            <span id="luma-status-filtro">Desligado</span>
            <label class="luma-switch">
              <input type="checkbox" id="luma-toggle-filtro">
              <span class="luma-slider"></span>
            </label>
          </div>
        </div>

        <div class="luma-group">
          <label class="luma-label">Mensagens a considerar</label>
          <div class="luma-segmented">
            <label><input type="radio" name="luma-msg-scope" value="ambos" checked><span>Ambos</span></label>
            <label><input type="radio" name="luma-msg-scope" value="cliente"><span>Cliente</span></label>
            <label><input type="radio" name="luma-msg-scope" value="agente"><span>Agente</span></label>
          </div>
        </div>

        <div class="luma-grid-2" style="margin-bottom: 12px; align-items: flex-start;">
          
          <div id="luma-qtd-wrapper" style="position: relative; width: 100%;">
            
            <select id="luma-qtd-itens" class="luma-select" style="width: 100%;">
              <option value="20">20 itens</option>
              <option value="50" selected>50 itens</option>
              <option value="100">100 itens</option>
              <option value="200">200 itens</option>
              <option value="outro">Outro...</option>
            </select>
            
            <div id="luma-qtd-custom" style="display: none; position: absolute; top: 0; left: 0; right: 0; bottom: 0; z-index: 2; background: #2A2C2F; border-radius: 8px;">
              <style>
                #luma-qtd-input::-webkit-outer-spin-button, #luma-qtd-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
                #luma-qtd-input[type=number] { -moz-appearance: textfield; }
              </style>
              <input type="number" id="luma-qtd-input" placeholder="Digite..." style="width: 100%; height: 100%; border-radius: 8px; padding: 0 30px 0 12px; border: 1px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.2); color: white; outline: none; box-sizing: border-box; font-size: 13px; margin: 0;">
              <div id="luma-btn-abrir-select" title="Trocar quantidade" style="position: absolute; right: 12px; top: 50%; transform: translateY(-50%); width: 12px; height: 12px; cursor: pointer; background-image: url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%239BA1A6%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E'); background-repeat: no-repeat; background-position: center; background-size: contain;"></div>
            </div>
          </div>
          
          <select id="luma-tipo-export" class="luma-select">
            <option value="relevantes">Apenas relevantes</option>
            <option value="todos">Todos</option>
          </select>
        </div>

        <div class="luma-group" style="margin-bottom: 16px;">
          <label class="luma-checkbox-label">
            <input type="checkbox" id="luma-check-baixar"> <div class="luma-checkmark"></div> Baixar ao concluir
          </label>
        </div>

        <button class="luma-btn-primary" id="luma-btn-iniciar">Iniciar</button>
        <div class="luma-grid-2">
          <button class="luma-btn-primary luma-btn-secondary" id="luma-btn-pausar" disabled style="opacity: 0.5; cursor: not-allowed;">Pausar</button>
          <button class="luma-btn-primary luma-btn-danger" id="luma-btn-cancelar" disabled style="opacity: 0.5; cursor: not-allowed;">Cancelar</button>
        </div>
        <button class="luma-btn-primary luma-btn-secondary luma-btn-exportar" id="luma-btn-exportar">Exportar</button>
        
        <div class="luma-progress-group">
          <div class="luma-progress-labels">
            <span>Progresso: <b id="luma-val-progresso">0/0</b></span>
            <span>Relevantes: <b id="luma-val-relevantes">0</b></span>
          </div>
          <div class="luma-progress-bg">
            <div class="luma-progress-fill" id="luma-bar-fill"></div>
          </div>
        </div>
        
        <div class="luma-info-box">
          A Varredura usa o prompt da IA para encontrar/avaliar atendimentos e gerar um XLSX com relevância e resumo.
        </div>

        <div id="luma-mini-modal">
          <label class="luma-label">Palavras do Pré-Filtro</label>
          <textarea class="luma-textarea" id="luma-varredura-prefiltro" placeholder="Ex: orçamento, implante, -dúvida"></textarea>
          <div class="luma-modal-footer">
            <button class="luma-btn-primary luma-btn-secondary" id="luma-fechar-mini-modal">Fechar</button>
            <button class="luma-btn-primary" id="luma-salvar-modal">Salvar</button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', html);
  configurarEventosPainel();
  MotorVarredura.iniciarEventos();
}

// =========================================================
// 2. LÓGICA DE ARRASTAR (COM PREVENÇÃO DE CLIQUE)
// =========================================================
let foiArrastadoGlobal = false;

function tornarArrastavel(elementoAlça, elementoAlvo) {
  let pX = 0, pY = 0, mX = 0, mY = 0;
  let startX = 0, startY = 0;

  elementoAlça.onmousedown = function(e) {
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
    
    foiArrastadoGlobal = false;
    startX = e.clientX;
    startY = e.clientY;

    e.preventDefault();
    mX = e.clientX;
    mY = e.clientY;

    document.onmouseup = () => { document.onmouseup = null; document.onmousemove = null; };
    document.onmousemove = function(e) {
      if (Math.abs(e.clientX - startX) > 5 || Math.abs(e.clientY - startY) > 5) {
        foiArrastadoGlobal = true;
      }
      pX = mX - e.clientX;
      pY = mY - e.clientY;
      mX = e.clientX;
      mY = e.clientY;
      elementoAlvo.style.top = (elementoAlvo.offsetTop - pY) + "px";
      elementoAlvo.style.left = (elementoAlvo.offsetLeft - pX) + "px";
      elementoAlvo.style.bottom = "auto"; elementoAlvo.style.right = "auto";
    };
  };
}

// =========================================================
// EVENTOS E FEEDBACK
// =========================================================
function configurarEventosPainel() {
  const container = document.getElementById('luma-panel-container');
  const fabContainer = document.getElementById('luma-fab-container');
  const headerDrag = document.getElementById('luma-panel-drag');
  
  const btnFechar = document.getElementById('luma-fechar-painel');
  const btnMinimizar = document.getElementById('luma-minimizar-painel');
  const btnAbrirModal = document.getElementById('luma-btn-mini-modal');
  const btnFecharModal = document.getElementById('luma-fechar-mini-modal');
  const btnSalvarModal = document.getElementById('luma-salvar-modal');
  const miniModal = document.getElementById('luma-mini-modal');
  const toggleFiltro = document.getElementById('luma-toggle-filtro');
  const statusFiltro = document.getElementById('luma-status-filtro');

  let miniBar = document.getElementById('luma-minimized-bar');
  if (!miniBar) {
    miniBar = document.createElement('div');
    miniBar.id = 'luma-minimized-bar';
    miniBar.innerHTML = '<span>LUMA 2.0 Varredura</span> <span style="font-size:14px">+</span>';
    document.body.appendChild(miniBar);
    tornarArrastavel(miniBar, miniBar);

    miniBar.addEventListener('click', (e) => {
    if (foiArrastadoGlobal) return; 
    container.style.top = miniBar.style.top;
    container.style.left = miniBar.style.left;
    
    miniBar.style.display = 'none';
    container.style.display = 'flex';
    });
  }

  tornarArrastavel(headerDrag, container);

  btnFechar.addEventListener('click', () => {
    container.style.display = 'none';
    miniBar.style.display = 'none';
    const bolinhaViva = document.getElementById('luma-fab-container');
    if (bolinhaViva) { bolinhaViva.style.opacity = '1'; bolinhaViva.style.pointerEvents = 'auto'; }
  });

  btnMinimizar.addEventListener('click', () => {
    const rect = container.getBoundingClientRect();
    miniBar.style.top = rect.top + 'px';
    miniBar.style.left = rect.left + 'px';
    container.style.display = 'none';
    miniBar.style.display = 'flex';
  });

  btnAbrirModal.onclick = () => miniModal.classList.add('luma-show');
  btnFecharModal.onclick = () => miniModal.classList.remove('luma-show');
  
btnSalvarModal.onclick = () => {
    btnSalvarModal.innerText = '✔ Salvo!';
    btnSalvarModal.style.setProperty('background-color', '#4CAF50', 'important'); 
    setTimeout(() => { 
        miniModal.classList.remove('luma-show');
        setTimeout(() => {
          btnSalvarModal.innerText = 'Salvar';
          btnSalvarModal.style.setProperty('background-color', '', '');
        }, 300);
    }, 800);
};

  toggleFiltro.onchange = (e) => {
    statusFiltro.innerText = e.target.checked ? 'Ligado' : 'Desligado';
    statusFiltro.style.color = e.target.checked ? '#FF6B00' : '#9BA1A6';
  };
}

// =========================================================
// INJEÇÃO DA INTERFACE DO TAGSENSE
// =========================================================
function injetarTagSenseLuma() {
  if (document.getElementById('luma-tagsense-container')) return;

  const html = `
    <div id="luma-tagsense-container">
      <div class="luma-panel-header" id="tag-panel-drag">
        <span>LUMA 2.0 TagSense</span>
        <div class="luma-header-actions">
          <button class="luma-icon-btn" id="tag-minimizar-painel" title="Minimizar">─</button>
          <button class="luma-icon-btn" id="tag-fechar-painel" title="Fechar">✕</button>
        </div>
      </div>

      <div class="luma-panel-content">
        
        <div class="luma-group">
          <label class="luma-label">Modo de Análise</label>
          <div class="luma-segmented">
            <label><input type="radio" name="tag-modo" id="tag-modo-todos" value="todos" checked><span>Todos</span></label>
            <label><input type="radio" name="tag-modo" id="tag-modo-proto" value="protocolo"><span>Protocolo</span></label>
          </div>
        </div>

        <div class="luma-group luma-hidden luma-fade-anim" id="tag-grupo-protocolo">
          <label class="luma-label">Núm. Protocolo(s)</label>
          <span class="luma-sublabel">Insira os protocolos separados por vírgula.</span>
          <textarea class="luma-textarea" id="tag-protocolos-input" placeholder="Ex: 123456, 789012" style="height: 60px;"></textarea>
        </div>

        <div class="luma-grid-2" style="margin-bottom: 12px; align-items: flex-start;">
          
          <div id="tag-qtd-wrapper" style="position: relative; width: 100%;">
            <select id="luma-qtd-itens" class="luma-select" style="width: 100%;">
              <option value="20">20 itens</option>
              <option value="50" selected>50 itens</option>
              <option value="100">100 itens</option>
              <option value="200">200 itens</option>
              <option value="outro">Outro...</option>
            </select>
            <div id="tag-qtd-custom" style="display: none; position: absolute; top: 0; left: 0; right: 0; bottom: 0; z-index: 2; background: #2A2C2F; border-radius: 8px;">
              <input type="number" id="luma-qtd-input" placeholder="Digite..." style="width: 100%; height: 100%; border-radius: 8px; padding: 0 30px 0 12px; border: 1px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.2); color: white; outline: none; box-sizing: border-box; font-size: 13px; margin: 0;">
              <div id="tag-btn-abrir-select" title="Trocar quantidade" style="position: absolute; right: 12px; top: 50%; transform: translateY(-50%); width: 12px; height: 12px; cursor: pointer; background-image: url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%239BA1A6%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E'); background-repeat: no-repeat; background-position: center; background-size: contain;"></div>
            </div>
          </div>
          
          <select id="luma-tipo-export" class="luma-select">
            <option value="relevantes">Apenas relevantes</option>
            <option value="todos">Todos</option>
          </select>
        </div>

        <div class="luma-group" style="margin-bottom: 16px;">
          <label class="luma-checkbox-label">
            <input type="checkbox" id="luma-check-baixar"> <div class="luma-checkmark"></div> Baixar ao concluir
          </label>
        </div>

        <button class="luma-btn-primary" id="tag-btn-iniciar">Iniciar</button>
        <div class="luma-grid-2">
          <button class="luma-btn-primary luma-btn-secondary" id="tag-btn-pausar" disabled style="opacity: 0.5; cursor: not-allowed;">Pausar</button>
          <button class="luma-btn-primary luma-btn-danger" id="tag-btn-cancelar" disabled style="opacity: 0.5; cursor: not-allowed;">Cancelar</button>
        </div>
        <button class="luma-btn-primary luma-btn-secondary luma-btn-exportar" id="tag-btn-exportar">Exportar</button>

        <div class="luma-progress-group">
          <div class="luma-progress-labels">
            <span>Progresso: <b>0/0</b></span>
            <span>Validados: <b>0</b></span>
          </div>
          <div class="luma-progress-bg">
            <div class="luma-progress-fill"></div>
          </div>
        </div>

        <div class="luma-info-box">
          Aguardando início...
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', html);
  configurarEventosTagSense();
}

function configurarEventosTagSense() {
  const container = document.getElementById('luma-tagsense-container');
  const headerDragTag = document.getElementById('tag-panel-drag');
  tornarArrastavel(headerDragTag, container);

  let miniBar = document.getElementById('tag-minimized-bar');
  if (!miniBar) {
    miniBar = document.createElement('div');
    miniBar.id = 'tag-minimized-bar';
    miniBar.innerHTML = '<span>LUMA 2.0 TagSense</span> <span style="font-size:14px">+</span>';
    document.body.appendChild(miniBar);
    tornarArrastavel(miniBar, miniBar);

    miniBar.addEventListener('click', () => { 
      if(foiArrastadoGlobal) return; 
      container.style.top = miniBar.style.top; 
      container.style.left = miniBar.style.left; 
      miniBar.style.display = 'none'; 
      container.style.display = 'flex'; 
    });
  }

  document.getElementById('tag-fechar-painel').onclick = () => { 
    container.style.display = 'none'; 
    miniBar.style.display = 'none'; 
    const bolinhaViva = document.getElementById('luma-fab-container');
    if (bolinhaViva) { bolinhaViva.style.opacity='1'; bolinhaViva.style.pointerEvents='auto'; }
  };
  
  document.getElementById('tag-minimizar-painel').onclick = () => { 
    const rect = container.getBoundingClientRect(); 
    miniBar.style.top = rect.top + 'px'; 
    miniBar.style.left = rect.left + 'px'; 
    container.style.display = 'none'; 
    miniBar.style.display = 'flex'; 
  };

  const radioTodos = document.getElementById('tag-modo-todos');
  const radioProto = document.getElementById('tag-modo-proto');
  const grupoProtocolo = document.getElementById('tag-grupo-protocolo');

  radioTodos.onchange = () => { if (radioTodos.checked) grupoProtocolo.classList.add('luma-hidden'); };
  radioProto.onchange = () => { if (radioProto.checked) grupoProtocolo.classList.remove('luma-hidden'); };

  const elSelect = container.querySelector('#luma-qtd-itens');
  const elDiv = container.querySelector('#tag-qtd-custom');
  const elInput = container.querySelector('#luma-qtd-input');
  const btnAbrirSelect = container.querySelector('#tag-btn-abrir-select');

  elSelect.addEventListener('change', (e) => {
    if (e.target.value === 'outro') {
      elSelect.style.opacity = '0';
      elSelect.style.pointerEvents = 'none';
      elDiv.style.display = 'block';
      elInput.focus();
    } else {
      elSelect.style.opacity = '1';
      elSelect.style.pointerEvents = 'auto';
      elDiv.style.display = 'none';
    }
  });

  btnAbrirSelect.addEventListener('click', (e) => {
    e.preventDefault();
    elDiv.style.display = 'none';
    elSelect.style.opacity = '1';
    elSelect.style.pointerEvents = 'auto';
    elSelect.value = '50';
    void elSelect.offsetHeight;
    try { elSelect.showPicker(); } catch(err) { elSelect.focus(); }
  });

  MotorTagSense.iniciarEventos();
}
injetarTagSenseLuma();

// =========================================================
// PONTE DE COMUNICAÇÃO
// =========================================================
window.abrirPainelLuma = function(aba) {
  const varredura = document.getElementById('luma-panel-container');
  const tagsense = document.getElementById('luma-tagsense-container');
  const fabContainer = document.getElementById('luma-fab-container');

  if (fabContainer) { fabContainer.style.opacity = '0'; fabContainer.style.pointerEvents = 'none'; }
  if (varredura) varredura.style.display = 'none';
  if (tagsense) tagsense.style.display = 'none';

  let painelAtivo = (aba === 'tagsense') ? tagsense : varredura;

  if (painelAtivo) {
    painelAtivo.style.display = 'flex';
    if (!painelAtivo.style.top) {
      painelAtivo.style.top = '100px';
      painelAtivo.style.left = (window.innerWidth - 400) + 'px';
    }
  }
};

window.fecharPainelLuma = function() {
  const varredura = document.getElementById('luma-panel-container');
  const tagsense = document.getElementById('luma-tagsense-container');
  const fabContainer = document.getElementById('luma-fab-container');

  if (varredura) varredura.style.display = 'none';
  if (tagsense) tagsense.style.display = 'none';
  if (fabContainer) { 
    fabContainer.style.opacity = '1'; 
    fabContainer.style.pointerEvents = 'auto'; 
  }
};
injetarPainelLuma();
if (typeof iniciarFisicaDoLuma === 'function') {
  iniciarFisicaDoLuma();
}
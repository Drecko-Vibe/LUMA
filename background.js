import { LUMA_KEYS } from './config.js';
import { getRegrasGeraisPrompt, getDicionarioParaIA } from './js/tags.js'; 

// =========================================================
// LUMA 2.0
// =========================================================

const LUMA_CONFIG = {
  CHAVES_API: LUMA_KEYS,
  URL_LISTA: "URL_LISTA",
  URL_MENSAGENS: "URL_MENSAGENS",
  TAMANHO_LOTE: 5, 
  
  MODELOS_IA: [
    "gemini-3-flash-preview",         
    "gemini-2.5-flash",               
    "gemini-2.5-pro",                 
    "gemini-2.0-flash",               
    "gemini-3.1-flash-lite-preview",  
    "gemini-2.5-flash-lite",
    "gemma-3-1b-it",
    "gemma-3-4b-it",
    "gemma-3-12b-it",
    "gemma-3-27b-it",
    "gemma-3n-e4b-it"          
  ]
};

let indiceModeloAtual = 0;
let indiceChaveAtual = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Lista-mãe de modelos — nunca é modificada, usada para restaurar após troca de chave
const MODELOS_IA_ORIGINAIS = [
  "gemini-3-flash-preview",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.0-flash",
  "gemini-3.1-flash-lite-preview",
  "gemini-2.5-flash-lite",
  "gemma-3-1b-it",
  "gemma-3-4b-it",
  "gemma-3-12b-it",
  "gemma-3-27b-it",
  "gemma-3n-e4b-it"
];

let lumaEstado = { pausado: false, cancelado: false };

chrome.runtime.onMessage.addListener((mensagem, sender, sendResponse) => {
  if (mensagem.acao === "INICIAR_VARREDURA_FANTASMA") {
    console.log("BACKGROUND: Motor Iniciado com", LUMA_CONFIG.CHAVES_API.length, "chaves disponíveis.");
    sendResponse({ status: "Processamento em Lote Iniciado" });
    iniciarMotorVarredura(mensagem.config, mensagem.token, sender.tab.id);
    return true; 
  }

  if (mensagem.acao === "INICIAR_TAGSENSE_FANTASMA") {
    lumaEstado.pausado = false; lumaEstado.cancelado = false;
    sendResponse({ status: "Tagsense Iniciado" });
    iniciarMotorTagSense(mensagem.config, mensagem.token, sender.tab.id); // ✅ nome e ordem corretos
    return true;
  }
});

async function iniciarMotorVarredura(config, token, tabId) {
  try {
    chrome.tabs.sendMessage(tabId, { acao: "ATUALIZAR_PROGRESSO", status: "Buscando protocolos..." });
    
    const protocolosParaProcessar = config.protocolosCapturados;

    let resultados = [];
    let relevantes = 0;
    
    if (config.isNovaVarredura) {
        console.log("BACKGROUND: Nova varredura iniciada. Zerando memória de modelos.");
        indiceModeloAtual = 0;
        indiceChaveAtual = 0;
        LUMA_CONFIG.MODELOS_IA = [...MODELOS_IA_ORIGINAIS]; // ✅ cópia limpa da lista-mãe
    } else {
        console.log(`BACKGROUND: Continuando varredura... Mantendo IA atual: ${LUMA_CONFIG.MODELOS_IA[indiceModeloAtual]} (Chave ${indiceChaveAtual + 1})`);
    }

    for (let i = 0; i < protocolosParaProcessar.length; i += LUMA_CONFIG.TAMANHO_LOTE) {
      const lote = protocolosParaProcessar.slice(i, i + LUMA_CONFIG.TAMANHO_LOTE);
      
      chrome.tabs.sendMessage(tabId, { 
          acao: "ATUALIZAR_PROGRESSO", atual: i, total: protocolosParaProcessar.length, relevantes: relevantes, status: `Baixando lote de ${lote.length} atendimentos...` 
      });
      let conversasDoLote = [];
      for (const item of lote) {
        const texto = await buscarConversaDaAPI(item.protocolo, token);
        if (texto) {
          
          if (config.preFiltroLigado && config.preFiltroTexto) {
            const passouFiltro = verificarPreFiltro(texto, config.preFiltroTexto);
            if (!passouFiltro) {
               resultados.push({ dataInicio: item.dataInicio, protocolo: item.protocolo, idClinica: item.idClinica, assertivo: "Não", resumo: "Ignorado pelo pré-filtro rápido (Palavras não encontradas)." });
               continue; 
            }
          }

          conversasDoLote.push({ id: item.protocolo, texto: texto });
        } else {
          resultados.push({ dataInicio: item.dataInicio, protocolo: item.protocolo, idClinica: item.idClinica, assertivo: "Analisar", resumo: "Não foi possível extrair a conversa." });
        }
      }

      if (conversasDoLote.length === 0) continue; 

      let sucessoIA = false;
      let arrayAnalise = [];
      let tentativasNoModelo = 0;
      // ✅ Limite fixo calculado antes do loop — imune ao splice que encolhe o array
      const maxTentativas = MODELOS_IA_ORIGINAIS.length * LUMA_CONFIG.CHAVES_API.length;

      while (!sucessoIA && tentativasNoModelo < maxTentativas) {
        if (LUMA_CONFIG.MODELOS_IA.length === 0) break;
        if (indiceModeloAtual >= LUMA_CONFIG.MODELOS_IA.length) indiceModeloAtual = 0;

        const modeloAtual = LUMA_CONFIG.MODELOS_IA[indiceModeloAtual];
        const chaveAtual = LUMA_CONFIG.CHAVES_API[indiceChaveAtual];
        
        chrome.tabs.sendMessage(tabId, { 
            acao: "ATUALIZAR_PROGRESSO", atual: i, total: protocolosParaProcessar.length, relevantes: relevantes, 
            status: `IA (${modeloAtual}) auditando lote. Pode levar uns 20s...` 
        });

        const respostaLote = await perguntarParaGeminiEmLote(conversasDoLote, config.prompt, modeloAtual, chaveAtual);
        
        if (respostaLote.falhaModelo) {
          const status = respostaLote.statusHttp;
          
          if (status === 400 || status === 403 || status === 404) {
            console.warn(`Modelo ${modeloAtual} inválido/sem acesso. Arrancando da lista!`);
            LUMA_CONFIG.MODELOS_IA.splice(indiceModeloAtual, 1);
          } else {
            console.warn(`Modelo ${modeloAtual} cansou. Trocando de marcha...`);
            indiceModeloAtual++; 
          }
          
          tentativasNoModelo++;
          
          if (LUMA_CONFIG.MODELOS_IA.length > 0 && indiceModeloAtual >= LUMA_CONFIG.MODELOS_IA.length) {
            indiceChaveAtual++; 
            
            if (indiceChaveAtual >= LUMA_CONFIG.CHAVES_API.length) {
                console.warn("⏳ Todas as chaves esgotadas. Esfriando os motores por 10s...");
                indiceChaveAtual = 0; 
                indiceModeloAtual = 0;
                LUMA_CONFIG.MODELOS_IA = [...MODELOS_IA_ORIGINAIS]; // ✅ restaura lista completa ao reiniciar ciclo
                chrome.tabs.sendMessage(tabId, { acao: "ATUALIZAR_PROGRESSO", atual: i, total: protocolosParaProcessar.length, relevantes: relevantes, status: `Chaves esgotadas. Esfriando (10s)...` });
                await sleep(10000);
            } else {
                indiceModeloAtual = 0;
                LUMA_CONFIG.MODELOS_IA = [...MODELOS_IA_ORIGINAIS]; // ✅ restaura lista ao trocar de chave
                console.warn(`🔄 Trocando para a Chave de API ${indiceChaveAtual + 1}...`);
                await sleep(1000); 
            }
          } else if (LUMA_CONFIG.MODELOS_IA.length > 0) {
            await sleep(2000);
          }
        } else {
          sucessoIA = true;
          arrayAnalise = respostaLote.dados;
        }
      }
      
      if (!sucessoIA || arrayAnalise.length === 0) {
        conversasDoLote.forEach(c => {
           const originalItem = lote.find(x => String(x.protocolo) === String(c.id));
           resultados.push({ dataInicio: originalItem ? originalItem.dataInicio : "", protocolo: c.id, idClinica: originalItem ? originalItem.idClinica : "", assertivo: "Analisar", resumo: "Falha na IA ao processar este lote." });
        });
      } else {
        arrayAnalise.forEach((analise, index) => {
          if (analise.assertivo === "Sim") relevantes++;
          
          // 1. Tenta achar pelo ID exato que a IA retornou
          let originalItem = lote.find(x => String(x.protocolo) === String(analise.protocolo));
          
          // 2. PLANO B (Fallback): Se a IA esqueceu o protocolo, mas devolveu a quantidade certa de itens, cruza pela ordem (Index)
          if (!originalItem && arrayAnalise.length === lote.length) {
              originalItem = lote[index];
              analise.protocolo = originalItem.protocolo; // Restaura a memória da IA
          }

          resultados.push({ 
              dataInicio: originalItem ? originalItem.dataInicio : "", 
              protocolo: analise.protocolo || (originalItem ? originalItem.protocolo : "ERRO-IA"), 
              idClinica: originalItem ? originalItem.idClinica : "", 
              assertivo: analise.assertivo || "Analisar", 
              resumo: analise.resumo || "Resumo não gerado." 
          });
        });
      }

      await sleep(3500); 
    }

    chrome.tabs.sendMessage(tabId, { 
        acao: "ATUALIZAR_PROGRESSO", atual: protocolosParaProcessar.length, total: protocolosParaProcessar.length, relevantes: relevantes, status: "Concluído!", finalizado: true, dadosPlanilha: resultados
    });

  } catch (erro) {
    console.error("BACKGROUND: Erro crítico:", erro);
    chrome.tabs.sendMessage(tabId, { acao: "ATUALIZAR_PROGRESSO", status: "Erro na varredura. Veja o console." });
  }
}

// =========================================================
// O CÉREBRO DO TAGSENSE (ROXO)
// =========================================================
async function iniciarMotorTagSense(config, token, tabId) {
  try {
    const protocolosParaProcessar = config.protocolosCapturados;
    let resultados = [];
    let relevantes = 0; // Para o TagSense, 'relevantes' = Tags Erradas encontradas
    
    // Mesma lógica de reinício de IA da Varredura
    if (config.isNovaVarredura) {
        indiceModeloAtual = 0; indiceChaveAtual = 0;
        LUMA_CONFIG.MODELOS_IA = [...MODELOS_IA_ORIGINAIS]; // ✅ cópia limpa da lista-mãe
    }

    for (let i = 0; i < protocolosParaProcessar.length; i += LUMA_CONFIG.TAMANHO_LOTE) {
      const lote = protocolosParaProcessar.slice(i, i + LUMA_CONFIG.TAMANHO_LOTE);
      
      chrome.tabs.sendMessage(tabId, { acao: "ATUALIZAR_PROGRESSO", atual: i, total: protocolosParaProcessar.length, relevantes: relevantes, status: `Baixando conversas do lote...` });
      
      let conversasDoLote = [];
      for (const item of lote) {
        const texto = await buscarConversaDaAPI(item.protocolo, token);
        if (texto) conversasDoLote.push({ id: item.protocolo, tagAplicada: item.tagAplicada, texto: texto });
        else resultados.push({ dataInicio: item.dataInicio, protocolo: item.protocolo, idClinica: item.idClinica, agente: item.agente, tagAplicada: item.tagAplicada, assertivo: "Analisar", tagSugerida: "-", resumo: "Não foi possível baixar a conversa." });
      }

      if (conversasDoLote.length === 0) continue; 

      let sucessoIA = false;
      let arrayAnalise = [];
      let tentativasNoModelo = 0;
      // ✅ Limite fixo calculado antes do loop — imune ao splice que encolhe o array
      const maxTentativas = MODELOS_IA_ORIGINAIS.length * LUMA_CONFIG.CHAVES_API.length;

      while (!sucessoIA && tentativasNoModelo < maxTentativas) {
        if (LUMA_CONFIG.MODELOS_IA.length === 0) break;
        if (indiceModeloAtual >= LUMA_CONFIG.MODELOS_IA.length) indiceModeloAtual = 0;

        const modeloAtual = LUMA_CONFIG.MODELOS_IA[indiceModeloAtual];
        const chaveAtual = LUMA_CONFIG.CHAVES_API[indiceChaveAtual];
        
        chrome.tabs.sendMessage(tabId, { acao: "ATUALIZAR_PROGRESSO", atual: i, total: protocolosParaProcessar.length, relevantes: relevantes, status: `Avaliando Tags com ${modeloAtual}...` });

        const respostaLote = await perguntarParaGeminiTagSenseEmLote(conversasDoLote, modeloAtual, chaveAtual);
        
        if (respostaLote.falhaModelo) {
            if ([400, 403, 404].includes(respostaLote.statusHttp)) LUMA_CONFIG.MODELOS_IA.splice(indiceModeloAtual, 1);
            else indiceModeloAtual++; 
            tentativasNoModelo++;
            if (LUMA_CONFIG.MODELOS_IA.length > 0 && indiceModeloAtual >= LUMA_CONFIG.MODELOS_IA.length) {
                indiceChaveAtual++; 
                if (indiceChaveAtual >= LUMA_CONFIG.CHAVES_API.length) {
                    indiceChaveAtual = 0; indiceModeloAtual = 0;
                    LUMA_CONFIG.MODELOS_IA = [...MODELOS_IA_ORIGINAIS]; // ✅ restaura lista ao reiniciar ciclo
                    await sleep(10000);
                } else {
                    indiceModeloAtual = 0;
                    LUMA_CONFIG.MODELOS_IA = [...MODELOS_IA_ORIGINAIS]; // ✅ restaura lista ao trocar de chave
                    await sleep(1000);
                }
            } else if (LUMA_CONFIG.MODELOS_IA.length > 0) await sleep(2000);
        } else {
          sucessoIA = true;
          arrayAnalise = respostaLote.dados;
        }
      }
      
      // Processamento da resposta e Plano B do Índice (Igual Varredura)
      if (!sucessoIA || arrayAnalise.length === 0) {
        conversasDoLote.forEach(c => {
           const ori = lote.find(x => String(x.protocolo) === String(c.id));
           resultados.push({ dataInicio: ori?.dataInicio || "", protocolo: c.id, idClinica: ori?.idClinica || "", agente: ori?.agente || "", tagAplicada: ori?.tagAplicada || "", assertivo: "Analisar", tagSugerida: "-", resumo: "Falha na IA." });
        });
      } else {
        arrayAnalise.forEach((analise, index) => {
          if (analise.assertivo === "Não") relevantes++; 
          let ori = lote.find(x => String(x.protocolo) === String(analise.protocolo));
          if (!ori && arrayAnalise.length === lote.length) { ori = lote[index]; analise.protocolo = ori.protocolo; }

          resultados.push({ 
              dataInicio: ori?.dataInicio || "", protocolo: analise.protocolo || (ori?.protocolo || "ERRO"), 
              idClinica: ori?.idClinica || "", agente: ori?.agente || "", tagAplicada: ori?.tagAplicada || "", 
              assertivo: analise.assertivo || "Analisar", tagSugerida: analise.tag_sugerida || "-", resumo: analise.resumo || "Sem resumo." 
          });
        });
      }
      await sleep(3500); 
    }

    chrome.tabs.sendMessage(tabId, { acao: "ATUALIZAR_PROGRESSO", atual: protocolosParaProcessar.length, total: protocolosParaProcessar.length, relevantes: relevantes, status: "Concluído!", finalizado: true, dadosPlanilha: resultados });

  } catch (erro) {
    console.error("Erro TagSense:", erro);
    chrome.tabs.sendMessage(tabId, { acao: "ATUALIZAR_PROGRESSO", status: "Erro na varredura. Veja o console." });
  }
}

// =========================================================
// O NOVO EXTRATOR FANTASMA DE CHAT (REST)
// =========================================================
async function buscarConversaDaAPI(sessionId, token) {
  try {
    const url = `URL_SESSIONID`;

    const resposta = await fetch(url, {
      method: "GET",
      headers: { "accept": "application/json", "authorization": token }
    });

    if (!resposta.ok) return null;

    const eventos = await resposta.json();
    if (!Array.isArray(eventos)) return null;

    let transcricaoCompleta = "";
    eventos.forEach(msg => {
      // Proteção contra linha vazia para não quebrar o código
      if (!msg) return; 

      // Puxa do formato novo (Payload) ou do formato antigo como plano B
      const corpo = (msg.Payload && msg.Payload.Body) ? msg.Payload.Body : (msg.body || "");
      const quem = (msg.Payload && msg.Payload.Sender) ? msg.Payload.Sender : (msg.senderName || "Sistema");
      
      if (corpo && typeof corpo === 'string') {
        const textoLimpo = corpo.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();
        if (textoLimpo) transcricaoCompleta += `[${quem}]: ${textoLimpo}\n`;
      }
    });

    return transcricaoCompleta.trim() !== "" ? transcricaoCompleta : null;
  } catch (e) {
    console.error(`LUMA Erro ao buscar conversa ${sessionId}:`, e);
    return null;
  }
}

// =========================================================
// INTEGRAÇÃO COM GEMINI BATCH + TIMEOUT
// =========================================================
// =========================================================
// INTEGRAÇÃO COM GEMINI BATCH + TIMEOUT
// =========================================================
async function perguntarParaGeminiEmLote(conversasDoLote, promptUsuario, modelo, chaveAtual) {
  const url = `LINK_API_MODELO`;
  
  let blocoConversas = "";
  conversasDoLote.forEach(conv => {
    blocoConversas += `\n\n--- INÍCIO DO ATENDIMENTO [PROTOCOLO: ${conv.id}] ---\n`;
    blocoConversas += conv.texto.substring(0, 8000);
    blocoConversas += `\n--- FIM DO ATENDIMENTO [PROTOCOLO: ${conv.id}] ---`;
  });

  // Extrai os IDs para encurralar a IA
  const listaIds = conversasDoLote.map(c => c.id).join(', ');

  const promptEstruturado = `
    Você é um Auditor Sênior de Qualidade analisando transcrições em lote.
    
    CRITÉRIO DE BUSCA DO USUÁRIO: "${promptUsuario}"
    
    REGRAS LÓGICAS DE ANÁLISE:
    1. A REGRA DO "OU": Se o critério do usuário pedir "A ou B", basta que APENAS UMA das condições seja verdadeira para que o atendimento seja "Sim".
    2. PROVA DE RECEBIMENTO PIX: A presença de um código longo de "Pix Copia e Cola" na transcrição é a prova absoluta de que o cliente "RECEBEU" o Pix.
    3. Não confunda intenção com ação: Se o cliente só pediu, mas o agente/robô não enviou, a resposta é "Não".
    4. REGRA DO CONTEXTO REAL (CRÍTICA): Uma palavra-chave mencionada de passagem — como nome de aba, menu do sistema ou tema secundário — NÃO qualifica o atendimento. O assunto PRINCIPAL da conversa deve ser diretamente sobre o critério buscado. Se o cliente veio falar de pagamento, cancelamento ou outro tema e a palavra-chave apareceu só incidentalmente, a resposta é "Não".
    5. REGRA DO PROTAGONISTA: Pergunte-se "o CLIENTE veio especificamente para resolver ISSO?". Se a resposta for não, marque "Não".
    
    ATENDIMENTOS PARA ANALISAR:
    ${blocoConversas}
    
    INSTRUÇÃO DE RESPOSTA:
    Você deve OBRIGATORIAMENTE devolver um array JSON contendo exatamente ${conversasDoLote.length} objetos, correspondentes aos protocolos: ${listaIds}.
    NUNCA esqueça a chave "protocolo" em nenhum objeto. Use este modelo exato:
    [
      { "protocolo": "ID_AQUI", "assertivo": "Sim", "resumo": "..." },
      { "protocolo": "ID_AQUI", "assertivo": "Não", "resumo": "..." }
    ]
  `;

  const payload = {
    contents: [{ parts: [{ text: promptEstruturado }] }],
    generationConfig: { response_mime_type: "application/json" } 
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000);

  try {
    const resposta = await fetch(url, { 
        method: "POST", 
        headers: { "Content-Type": "application/json" }, 
        body: JSON.stringify(payload),
        signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    const dados = await resposta.json();
    
    if (!resposta.ok) return { falhaModelo: true, statusHttp: resposta.status };
    if (!dados.candidates || !dados.candidates[0].content) return { falhaModelo: true, statusHttp: 'SafetyBlock' };
    
    let textoResposta = dados.candidates[0].content.parts[0].text;
    const match = textoResposta.match(/\[[\s\S]*\]/);
    if (match) return { falhaModelo: false, dados: JSON.parse(match[0]) };
    
    throw new Error("Array JSON não encontrado.");
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') {
        console.warn(`TIMEOUT! O modelo ${modelo} demorou mais de 25 segundos e foi abortado.`);
        return { falhaModelo: true, statusHttp: 'Timeout' };
    }
    return { falhaModelo: true, statusHttp: 'ParseError' };
  }
}

// =========================================================
// LUPA DO PRÉ-FILTRO
// =========================================================
function verificarPreFiltro(textoConversa, termosFiltro) {
  const palavras = termosFiltro.split(',').map(p => p.trim().toLowerCase()).filter(p => p.length > 0);
  if (palavras.length === 0) return true;

  const textoMin = textoConversa.toLowerCase();
  let temPalavraInclusao = false;
  let temRegraInclusao = false;

  for (let palavra of palavras) {
    if (palavra.startsWith('-')) {
      const palavraProibida = palavra.substring(1).trim();
      if (palavraProibida && textoMin.includes(palavraProibida)) {
        return false;
      }
    } else {
      temRegraInclusao = true;
      if (textoMin.includes(palavra)) {
        temPalavraInclusao = true;
      }
    }
  }

  if (temRegraInclusao && !temPalavraInclusao) {
    return false;
  }

  return true;
}

// =========================================================
// INTEGRAÇÃO COM GEMINI
// =========================================================
async function perguntarParaGeminiTagSenseEmLote(conversasDoLote, modelo, chaveAtual) {
  const url = `URL_API_MODELO`;
  
  let blocoConversas = "";
  conversasDoLote.forEach(conv => {
    blocoConversas += `\n\n--- INÍCIO DO ATENDIMENTO [PROTOCOLO: ${conv.id}] ---\n`;
    blocoConversas += `* TAG APLICADA PELO AGENTE: ${conv.tagAplicada}\n\n`;
    blocoConversas += conv.texto.substring(0, 8000);
    blocoConversas += `\n--- FIM DO ATENDIMENTO [PROTOCOLO: ${conv.id}] ---`;
  });

  const listaIds = conversasDoLote.map(c => c.id).join(', ');

  const promptEstruturado = `
    Você é um Auditor Sênior de Qualidade focado em categorização.
    
    ${getRegrasGeraisPrompt()}
    ${getDicionarioParaIA()}
    
    Sua missão é ler as transcrições abaixo, identificar o assunto tratado, cruzar com a "TAG APLICADA PELO AGENTE" e julgar se a tag (Área e Tipo) está perfeitamente alinhada com as definições do nosso dicionário.
    
    ATENDIMENTOS PARA ANALISAR:
    ${blocoConversas}
    
    REGRAS DA TAG SUGERIDA (MUITO IMPORTANTE):
    1. Se Assertivo="Não", sugira a Tag Correta baseada no dicionário.
    2. Se Assertivo="Sim", sugira UMA OUTRA TAG secundária do dicionário que também faria sentido para a conversa. 
    3. A tag sugerida NUNCA pode ser idêntica à tag aplicada pelo agente. Se for Assertivo="Sim" e não existir nenhuma outra tag que faça sentido, escreva apenas "Nenhuma outra".
    4. Formato: "NOME_DA_AREA - NOME_DO_TIPO".
    
    INSTRUÇÃO DE RESPOSTA (OBRIGATÓRIO ARRAY JSON COM ${conversasDoLote.length} OBJETOS EXATOS: ${listaIds}):
    [
      { 
        "protocolo": "ID_AQUI", 
        "assertivo": "Sim", 
        "tag_sugerida": "Area - Tipo", 
        "resumo": "Explique brevemente por que a tag está certa/errada." 
      }
    ]
  `;

  const payload = { contents: [{ parts: [{ text: promptEstruturado }] }], generationConfig: { response_mime_type: "application/json" } };
  const controller = new AbortController(); const timeoutId = setTimeout(() => controller.abort(), 25000);

  try {
    const resposta = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: controller.signal });
    clearTimeout(timeoutId);
    const dados = await resposta.json();
    
    if (!resposta.ok) return { falhaModelo: true, statusHttp: resposta.status };
    if (!dados.candidates) return { falhaModelo: true, statusHttp: 'SafetyBlock' };
    
    const match = dados.candidates[0].content.parts[0].text.match(/\[[\s\S]*\]/);
    if (match) return { falhaModelo: false, dados: JSON.parse(match[0]) };
    throw new Error("JSON Inválido");
  } catch (e) {
    clearTimeout(timeoutId);
    return { falhaModelo: true, statusHttp: e.name === 'AbortError' ? 'Timeout' : 'ParseError' };
  }
}
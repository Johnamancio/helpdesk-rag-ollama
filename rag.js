import fs from 'fs';
import fetch from 'node-fetch';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://host.docker.internal:11434';
const EMBEDDING_MODEL = process.env.OLLAMA_EMBED_MODEL || 'embeddinggemma';
const GENERATION_MODEL = process.env.OLLAMA_GENERATE_MODEL || 'gemma3';
const MODEL_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || '30m';
const RESPONSE_MAX_TOKENS = Number(process.env.OLLAMA_NUM_PREDICT || 160);
const RESPONSE_TEMPERATURE = Number(process.env.OLLAMA_TEMPERATURE || 0.1);
const RESPONSE_TOP_K = Number(process.env.RAG_TOP_K || 2);
const MIN_TEMPLATE_SCORE = Number(process.env.RAG_MIN_SCORE || 0.35);
const USE_LLM_FOR_RESPONSE = process.env.RAG_USE_LLM === 'true';

const templatesCache = {
  path: 'templates.json',
  mtimeMs: 0,
  data: []
};

const indexCache = {
  path: 'templates-index.json',
  mtimeMs: 0,
  data: []
};

function readJsonCached(cache) {
  const stats = fs.statSync(cache.path);

  if (cache.mtimeMs !== stats.mtimeMs) {
    cache.data = JSON.parse(fs.readFileSync(cache.path, 'utf-8'));
    cache.mtimeMs = stats.mtimeMs;
  }

  return cache.data;
}

function invalidateCache(cache) {
  cache.mtimeMs = 0;
}

async function postOllama(path, body) {
  const res = await fetch(`${OLLAMA_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Erro ao chamar Ollama em ${path}: ${errorText}`);
  }

  return res.json();
}

export async function generateEmbedding(text) {
  const data = await postOllama('/api/embed', {
    model: EMBEDDING_MODEL,
    input: text,
    keep_alive: MODEL_KEEP_ALIVE
  });

  return data.embeddings?.[0];
}

export function cosineSimilarity(a, b) {
  const dot = a.reduce((sum, val, i) => sum + val * (b[i] || 0), 0);
  const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));

  if (!magA || !magB) return 0;

  return dot / (magA * magB);
}

function readTemplates() {
  return readJsonCached(templatesCache);
}

function readIndex() {
  return readJsonCached(indexCache);
}

export function invalidateRagCaches() {
  invalidateCache(templatesCache);
  invalidateCache(indexCache);
}

export async function updateIndex() {
  const templates = readTemplates();
  const baseTexts = templates.map(template => {
    return [
      template.title || '',
      template.category || '',
      ...(template.keywords || []),
      template.content || ''
    ].join('\n');
  });

  const data = await postOllama('/api/embed', {
    model: EMBEDDING_MODEL,
    input: baseTexts,
    keep_alive: MODEL_KEEP_ALIVE
  });

  const index = templates.map((template, i) => {
    return { id: template.id, embedding: data.embeddings?.[i] };
  }).filter(item => Array.isArray(item.embedding));

  fs.writeFileSync('templates-index.json', JSON.stringify(index, null, 2));
  invalidateCache(indexCache);
}

export async function warmupModels() {
  const requests = [
    postOllama('/api/embed', {
      model: EMBEDDING_MODEL,
      input: 'warmup',
      keep_alive: '1h'
    })
  ];

  if (USE_LLM_FOR_RESPONSE) {
    requests.push(postOllama('/api/generate', {
      model: GENERATION_MODEL,
      prompt: '',
      stream: false,
      keep_alive: '1h'
    }));
  }

  await Promise.all(requests);
}

function normalizeText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function keywordSimilarity(ticketText, template) {
  const ticket = normalizeText(ticketText);
  const terms = [
    template.title,
    template.category,
    ...(template.keywords || [])
  ]
    .flatMap(value => normalizeText(value).split(/[^a-z0-9]+/))
    .filter(term => term.length >= 3);

  const uniqueTerms = [...new Set(terms)];
  if (!uniqueTerms.length) return 0;

  const matches = uniqueTerms.filter(term => ticket.includes(term)).length;
  return matches / uniqueTerms.length;
}

export async function findBestTemplates(ticketText) {
  const templates = readTemplates();
  const index = readIndex();
  const templatesById = new Map(templates.map(template => [template.id, template]));
  const ticketEmbedding = await generateEmbedding(ticketText);

  const scores = index.map(item => {
    const template = templatesById.get(item.id);
    const vectorScore = cosineSimilarity(ticketEmbedding, item.embedding);
    const keywordScore = template ? keywordSimilarity(ticketText, template) : 0;
    const score = (vectorScore * 0.85) + (keywordScore * 0.15);

    return { ...item, score, vectorScore, keywordScore };
  });

  scores.sort((a, b) => b.score - a.score);

  return scores
    .slice(0, RESPONSE_TOP_K)
    .map((score, index) => {
      const template = templatesById.get(score.id);
      if (!template) return null;

      return {
        ...template,
        _rank: index + 1,
        _score: Number(score.score.toFixed(4)),
        _vectorScore: Number(score.vectorScore.toFixed(4)),
        _keywordScore: Number(score.keywordScore.toFixed(4))
      };
    })
    .filter(Boolean);
}

function getSaudacao() {
  const hora = Number(
    new Date().toLocaleTimeString('pt-BR', {
      hour: 'numeric',
      hour12: false,
      timeZone: 'America/Sao_Paulo'
    })
  );

  if (hora < 12) return 'Bom dia, prezado!';
  if (hora < 18) return 'Boa tarde, prezado!';
  return 'Boa noite, prezado!';
}

function extrairDadosTicket(text) {
  const cnpjRegex = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
  const idRegex = /\b\d{5,}\b/g;
  const placaRegex = /\b[A-Z]{3}[0-9][A-Z0-9][0-9]{2}\b/gi;
  const emailRegex = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

  const cnpjs = text.match(cnpjRegex) || [];
  const ids = (text.match(idRegex) || []).filter(value => !cnpjs.some(cnpj => cnpj.includes(value)));
  const placas = text.match(placaRegex) || [];
  const emails = text.match(emailRegex) || [];

  return {
    cnpjs: [...new Set(cnpjs)],
    ids: [...new Set(ids)],
    placas: [...new Set(placas.map(placa => placa.toUpperCase()))],
    emails: [...new Set(emails)],
    temCNPJ: cnpjs.length > 0,
    temID: ids.length > 0
  };
}

function templateNeedsClientData(template) {
  const content = normalizeText(template?.content || '');
  return /\b(id|cnpj)\b/.test(content) && /(informe|informar|necessaria|necessario|continuidade)/.test(content);
}

function replaceGreeting(content, saudacao) {
  const lines = String(content || '').trim().split('\n');

  if (/^(bom dia|boa tarde|boa noite|prezados?)/i.test(lines[0] || '')) {
    lines[0] = saudacao;
  } else {
    lines.unshift(saudacao, '');
  }

  return lines.join('\n').replace(/\bBom dia\/Boa tarde,?\s*/gi, saudacao);
}

function buildExtractedInfoLine(info) {
  const parts = [];

  if (info.ids.length) parts.push(`ID: ${info.ids.join(', ')}`);
  if (info.cnpjs.length) parts.push(`CNPJ: ${info.cnpjs.join(', ')}`);
  if (info.placas.length) parts.push(`placa: ${info.placas.join(', ')}`);
  if (info.emails.length) parts.push(`e-mail: ${info.emails.join(', ')}`);

  return parts.length ? `\n\nDados identificados no ticket: ${parts.join(' | ')}.` : '';
}

function buildLowConfidenceResponse(saudacao, templates) {
  const candidates = templates
    .map(template => `${template._rank}. ${template.title} (${Math.round(template._score * 100)}%)`)
    .join('\n');

  return `${saudacao}\n\nNao encontrei um template com confianca suficiente para responder automaticamente sem risco de informar algo incorreto.\n\nTemplates mais proximos:\n${candidates}\n\nRecomendo revisar o ticket e escolher o template adequado antes de responder.\n\nAtenciosamente,\nEquipe Gestor`;
}

function ensureAssinatura(text) {
  const assinatura = 'Atenciosamente,\nEquipe Gestor';
  const normalized = text.trim();
  if (/Atenciosamente[,.]?\s*\n?\s*Equipe Gestor\s*$/i.test(normalized)) {
    return normalized;
  }
  return `${normalized}\n\n${assinatura}`;
}

function buildTemplateResponse(ticketText, templates, saudacao) {
  const [bestTemplate] = templates;
  const infoExtraida = extrairDadosTicket(ticketText);

  if (!bestTemplate || bestTemplate._score < MIN_TEMPLATE_SCORE) {
    return {
      response: buildLowConfidenceResponse(saudacao, templates),
      infoExtraida,
      usedLlm: false,
      confidence: bestTemplate?._score || 0
    };
  }

  let response = replaceGreeting(bestTemplate.content, saudacao);

  if (templateNeedsClientData(bestTemplate) && (infoExtraida.temCNPJ || infoExtraida.temID)) {
    response = response.replace(
      /(?:Caso a demanda tenha sido solicitada por cliente, pedimos que informe o ID e o CNPJ,[^\n]*|Para darmos continuidade ao atendimento, poderia informar o ID do cliente ou o CNPJ\?)/i,
      'Agradecemos pelo envio das informacoes. Com os dados informados, daremos continuidade ao atendimento.'
    );
  }

  const finalResponse = ensureAssinatura(response.trim());

  return {
    response: finalResponse,
    infoExtraida,
    usedLlm: false,
    confidence: bestTemplate._score
  };
}

function buildPrompt(ticketText, templates, saudacao) {
  const infoExtraida = extrairDadosTicket(ticketText);

  const context = templates.map((template, index) => {
    return `[TEMPLATE ${index + 1} | score ${template._score ?? 'n/a'} | titulo: ${template.title}]: ${template.content}`;
  }).join('\n\n');

  let regraDados = '';
  if (infoExtraida.temCNPJ || infoExtraida.temID) {
    regraDados = '- O cliente JA FORNECEU ID ou CNPJ. Nao peca essas informacoes novamente.';
  } else {
    regraDados = '- O cliente NAO forneceu ID ou CNPJ. Se o template exigir esses dados para prosseguir, peca-os educadamente.';
  }

  return `
Voce e um analista de helpdesk profissional.
Responda o ticket usando APENAS os templates fornecidos abaixo.

Regras:
- Comece com: "${saudacao}"
${regraDados}
- Nao invente diagnostico, prazo, ID, CNPJ, placa, responsavel, status de deploy ou acao realizada.
- Se a informacao nao estiver no ticket ou no template, nao mencione.
- Use preferencialmente o TEMPLATE 1. Use outros templates apenas para pequenos ajustes de tom.
- Mantenha passos tecnicos exatamente quando existirem no template.
- Seja direto e humano.
- Nao explique suas regras. Escreva somente a resposta final.

Ticket:
${ticketText}

Templates:
${context}

Resposta Final:`.trim();
}

export async function generateResponse(ticketText, templates) {
  const saudacao = getSaudacao();

  if (!USE_LLM_FOR_RESPONSE) {
    return buildTemplateResponse(ticketText, templates, saudacao);
  }

  const prompt = buildPrompt(ticketText, templates, saudacao);
  const infoExtraida = extrairDadosTicket(ticketText);

  const data = await postOllama('/api/generate', {
    model: GENERATION_MODEL,
    prompt,
    stream: false,
    keep_alive: MODEL_KEEP_ALIVE,
    options: {
      temperature: RESPONSE_TEMPERATURE,
      top_k: 20,
      top_p: 0.8,
      repeat_penalty: 1.08,
      num_predict: RESPONSE_MAX_TOKENS
    }
  });

  const llmResponse = data.response?.trim() || 'Nao foi possivel gerar uma resposta.';

  return {
    response: ensureAssinatura(llmResponse),
    infoExtraida,
    usedLlm: true,
    confidence: templates[0]?._score || 0
  };
}

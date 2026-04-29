import fs from 'fs';
import fetch from 'node-fetch';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://host.docker.internal:11434';
const EMBEDDING_MODEL = process.env.OLLAMA_EMBED_MODEL || 'embeddinggemma';
const GENERATION_MODEL = process.env.OLLAMA_GENERATE_MODEL || 'gemma3';
const MODEL_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || '30m';
const RESPONSE_MAX_TOKENS = Number(process.env.OLLAMA_NUM_PREDICT || 220);
const RESPONSE_TEMPERATURE = Number(process.env.OLLAMA_TEMPERATURE || 0.2);
const RESPONSE_TOP_K = Number(process.env.RAG_TOP_K || 3);

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
  const baseTexts = templates.map(t => {
    return [
      t.title || '',
      t.category || '',
      ...(t.keywords || []),
      t.content || ''
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
  await Promise.all([
    postOllama('/api/embed', {
      model: EMBEDDING_MODEL,
      input: 'warmup',
      keep_alive: MODEL_KEEP_ALIVE
    }),
    postOllama('/api/generate', {
      model: GENERATION_MODEL,
      prompt: '',
      stream: false,
      keep_alive: MODEL_KEEP_ALIVE
    })
  ]);
}

export async function findBestTemplates(ticketText) {
  const templates = readTemplates();
  const index = readIndex();
  const templatesById = new Map(templates.map(template => [template.id, template]));
  const ticketEmbedding = await generateEmbedding(ticketText);

  const scores = index.map(item => {
    const score = cosineSimilarity(ticketEmbedding, item.embedding);
    return { ...item, score };
  });

  scores.sort((a, b) => b.score - a.score);

  return scores
    .slice(0, RESPONSE_TOP_K)
    .map(score => templatesById.get(score.id))
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

function buildPrompt(ticketText, templates, saudacao) {
  const context = templates.map((template, index) => {
    return [
      `Template ${index + 1}`,
      `Titulo: ${template.title || ''}`,
      `Categoria: ${template.category || ''}`,
      `Palavras-chave: ${(template.keywords || []).join(', ')}`,
      `Conteudo: ${template.content || ''}`
    ].join('\n');
  }).join('\n\n');

  return `
Voce e um analista de helpdesk em portugues do Brasil.

Responda o ticket com base apenas nos templates abaixo.

Regras:
- Seja claro, direto e natural.
- Nao invente informacoes.
- Reescreva o template de forma humana, sem copiar literalmente.
- Se houver operador interno no ticket, escreva mesmo assim para o cliente final.

Formato:
- Comece exatamente com: "${saudacao}"
- Termine com:

Atenciosamente,
Equipe Gestor

Ticket:
${ticketText}

Templates:
${context}

Retorne apenas a resposta final.
`.trim();
}

export async function generateResponse(ticketText, templates) {
  const saudacao = getSaudacao();
  const prompt = buildPrompt(ticketText, templates, saudacao);

  const data = await postOllama('/api/generate', {
    model: GENERATION_MODEL,
    prompt,
    stream: false,
    keep_alive: MODEL_KEEP_ALIVE,
    options: {
      temperature: RESPONSE_TEMPERATURE,
      num_predict: RESPONSE_MAX_TOKENS
    }
  });

  return data.response?.trim() || 'Nao foi possivel gerar uma resposta.';
}

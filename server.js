import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { updateIndex, findBestTemplates, generateResponse, invalidateRagCaches, warmupModels } from './rag.js';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

function readTemplates() {
  return JSON.parse(fs.readFileSync('templates.json', 'utf-8'));
}

function writeTemplates(data) {
  fs.writeFileSync('templates.json', JSON.stringify(data, null, 2));
  invalidateRagCaches();
}

app.get('/api/templates', (_req, res) => {
  res.json(readTemplates());
});

app.post('/api/templates', async (req, res) => {
  try {
    const templates = readTemplates();

    const newTemplate = {
      id: crypto.randomUUID(),
      title: req.body.title || '',
      category: req.body.category || '',
      keywords: Array.isArray(req.body.keywords) ? req.body.keywords : [],
      content: req.body.content || ''
    };

    templates.push(newTemplate);
    writeTemplates(templates);
    await updateIndex();

    res.json(newTemplate);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar template.' });
  }
});

app.put('/api/templates/:id', async (req, res) => {
  try {
    const templates = readTemplates();
    const index = templates.findIndex(t => t.id === req.params.id);

    if (index === -1) {
      return res.status(404).json({ error: 'Template não encontrado.' });
    }

    templates[index] = {
      ...templates[index],
      title: req.body.title || '',
      category: req.body.category || '',
      keywords: Array.isArray(req.body.keywords) ? req.body.keywords : [],
      content: req.body.content || ''
    };

    writeTemplates(templates);
    await updateIndex();

    res.json(templates[index]);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar template.' });
  }
});

app.delete('/api/templates/:id', async (req, res) => {
  try {
    const templates = readTemplates();
    const filtered = templates.filter(t => t.id !== req.params.id);

    if (filtered.length === templates.length) {
      return res.status(404).json({ error: 'Template não encontrado.' });
    }

    writeTemplates(filtered);
    await updateIndex();

    res.sendStatus(204);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao excluir template.' });
  }
});

app.post('/api/respond', async (req, res) => {
  const startedAt = Date.now();

  try {
    const { ticket } = req.body;

    if (!ticket || typeof ticket !== 'string' || !ticket.trim()) {
      return res.status(400).json({ error: 'Ticket é obrigatório.' });
    }

    const templates = await findBestTemplates(ticket);
    const result = await generateResponse(ticket, templates);

    res.json({
      response: result.response,
      templates,
      confidence: result.confidence,
      usedLlm: result.usedLlm,
      extractedInfo: result.infoExtraida,
      elapsedMs: Date.now() - startedAt
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao gerar resposta.' });
  }
});

app.get('/api/reindex', async (_req, res) => {
  try {
    await updateIndex();
    res.json({ ok: true, message: 'Reindexado com sucesso' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao reindexar' });
  }
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'painel.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

warmupModels()
  .then(() => {
    console.log('Modelos Ollama aquecidos para reduzir latencia inicial.');
  })
  .catch(error => {
    console.warn('Nao foi possivel aquecer os modelos do Ollama:', error.message);
  });

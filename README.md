# helpdesk-rag-ollama

Aplicacao de helpdesk com RAG local usando Node.js, Express e Ollama.

O projeto permite:
- cadastrar, editar e excluir templates de atendimento
- indexar os templates com embeddings
- buscar os templates mais relevantes para um ticket
- gerar uma resposta automatizada com base no contexto encontrado
- responder em modo agente por template, sem LLM gerador, para reduzir latencia e alucinacao

## Como funciona

O fluxo da aplicacao e este:

1. O painel web envia o texto do ticket para a API.
2. A API gera o embedding do ticket no Ollama.
3. O sistema compara esse embedding com os embeddings dos templates salvos.
4. O agente monta a resposta com base no template mais confiavel e nos dados extraidos do ticket.
5. Se `RAG_USE_LLM=true`, os templates mais relevantes sao enviados ao modelo gerador para reescrita controlada.

## Stack

- Node.js
- Express
- Ollama
- Docker e Docker Compose
- JSON local para persistencia simples

## Estrutura do projeto

```text
.
├─ app.js
├─ docker-compose.yml
├─ Dockerfile
├─ package.json
├─ painel.html
├─ rag.js
├─ server.js
├─ style.css
├─ templates.json
└─ templates-index.json
```

## Requisitos

- Docker Desktop
- Git

Se quiser rodar sem Docker:
- Node.js 18+ recomendado
- Ollama instalado localmente

## Rodando com Docker

Suba os containers:

```bash
docker compose up -d --build
```

Baixe os modelos usados pelo projeto:

```bash
docker exec -it ollama ollama pull embeddinggemma
docker exec -it ollama ollama pull gemma3
```

Acesse:

- Painel: `http://localhost:3000`
- API do Ollama: `http://localhost:11434`

## Rodando sem Docker

Instale as dependencias:

```bash
npm install
```

Inicie o Ollama localmente e baixe os modelos:

```bash
ollama serve
ollama pull embeddinggemma
ollama pull gemma3
```

Depois rode a aplicacao:

```bash
npm start
```

## Variaveis de ambiente

Exemplo em [.env.example](/C:/Users/johna/OneDrive/Documentos/development/helpdesk_rag_ollama/.env.example:1):

```env
PORT=3000
OLLAMA_URL=http://ollama:11434
OLLAMA_KEEP_ALIVE=30m
OLLAMA_NUM_PREDICT=220
OLLAMA_TEMPERATURE=0.2
RAG_TOP_K=3
RAG_MIN_SCORE=0.35
RAG_USE_LLM=false
```

`RAG_USE_LLM=false` e o modo recomendado para respostas mais rapidas e menos inventivas. Nesse modo, o Ollama ainda e usado para embeddings, mas a resposta final e montada a partir do template escolhido.

## Containers e volumes

O `docker-compose.yml` sobe dois servicos:

- `app`: executa o `node server.js`
- `ollama`: executa o `ollama serve`

Persistencia:

- `ollama-data`: guarda os modelos baixados do Ollama
- `templates.json`: templates cadastrados
- `templates-index.json`: indice vetorial local

## Endpoints principais

- `GET /api/templates`
- `POST /api/templates`
- `PUT /api/templates/:id`
- `DELETE /api/templates/:id`
- `POST /api/respond`
- `GET /api/reindex`

## Observacoes de performance

Alguns ajustes ja aplicados no projeto:

- cache em memoria para leitura dos arquivos JSON
- warmup dos modelos no startup
- `keep_alive` para reduzir latencia entre chamadas
- reindexacao com embeddings em lote
- modo agente por template, que evita chamar o modelo gerador por padrao
- limite minimo de confianca (`RAG_MIN_SCORE`) antes de responder automaticamente

Se ainda estiver lento:

- use um modelo gerador menor que `gemma3`
- reduza `RAG_TOP_K`
- rode o Ollama com GPU, se disponivel

## Comandos uteis

Subir:

```bash
docker compose up -d --build
```

Parar:

```bash
docker compose down
```

Ver logs da aplicacao:

```bash
docker compose logs app
```

Ver logs do Ollama:

```bash
docker compose logs ollama
```

Listar modelos no Ollama:

```bash
docker exec -it ollama ollama list
```

## Melhorias futuras

- mover a persistencia para banco de dados
- separar `public`, `src` e `data` em pastas
- adicionar healthchecks no Compose
- automatizar o pull dos modelos no primeiro boot
- adicionar metricas de tempo por etapa do RAG

## Licenca

Uso livre para estudo e adaptacao.

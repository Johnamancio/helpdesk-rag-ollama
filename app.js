let templates = [];
let selected = null;
const API_BASE_URL = window.location.origin;

async function load() {
  const res = await fetch(`${API_BASE_URL}/api/templates`);
  templates = await res.json();

  document.getElementById('lista').innerHTML = templates.map((t) => `
    <button class="template-item ${selected && selected.id === t.id ? 'active' : ''}" onclick="selectTemplate('${t.id}')">
      <strong>${escapeHtml(t.title)}</strong>
      <span>${escapeHtml(t.category || 'Sem categoria')}</span>
    </button>
  `).join('');
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function selectTemplate(id) {
  selected = templates.find((t) => t.id === id);

  document.getElementById('title').value = selected.title || '';
  document.getElementById('category').value = selected.category || '';
  document.getElementById('keywords').value = (selected.keywords || []).join(', ');
  document.getElementById('content').value = selected.content || '';

  load();
}

function novo() {
  selected = null;
  document.getElementById('title').value = '';
  document.getElementById('category').value = '';
  document.getElementById('keywords').value = '';
  document.getElementById('content').value = '';
}

async function salvar() {
  const data = {
    title: document.getElementById('title').value.trim(),
    category: document.getElementById('category').value.trim(),
    keywords: document.getElementById('keywords').value
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean),
    content: document.getElementById('content').value.trim()
  };

  if (!data.title || !data.content) {
    alert('Título e conteúdo são obrigatórios.');
    return;
  }

  if (selected) {
    await fetch(`${API_BASE_URL}/api/templates/${selected.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  } else {
    await fetch(`${API_BASE_URL}/api/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  }

  novo();
  load();
}

async function excluir() {
  if (!selected) {
    alert('Selecione um template para excluir.');
    return;
  }

  const confirmar = confirm(`Deseja excluir o template "${selected.title}"?`);
  if (!confirmar) return;

  await fetch(`${API_BASE_URL}/api/templates/${selected.id}`, {
    method: 'DELETE'
  });

  novo();
  load();
}

async function gerar() {
  const ticket = document.getElementById('ticket').value.trim();

  if (!ticket) {
    alert('Digite o ticket.');
    return;
  }

  document.getElementById('resposta').textContent = 'Gerando resposta...';

  const res = await fetch(`${API_BASE_URL}/api/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket })
  });

  const data = await res.json();

  document.getElementById('resposta').textContent = data.response || 'Não foi possível gerar a resposta.';
}
async function copiarConteudo() {
  const texto = document.getElementById('content').value.trim();

  if (!texto) {
    alert('Não há conteúdo para copiar.');
    return;
  }

  try {
    await navigator.clipboard.writeText(texto);
    alert('Conteúdo copiado.');
  } catch {
    alert('Não foi possível copiar o conteúdo.');
  }
}

async function copiarResposta() {
  const texto = document.getElementById('resposta').textContent.trim();

  if (!texto || texto === 'A resposta vai aparecer aqui.') {
    alert('Não há resposta gerada para copiar.');
    return;
  }

  try {
    await navigator.clipboard.writeText(texto);
    alert('Resposta copiada.');
  } catch {
    alert('Não foi possível copiar a resposta.');
  }
}
async function limparResposta() {
  document.getElementById('ticket').value = '';
  document.getElementById('resposta').textContent = 'A resposta vai aparecer aqui.';
  document.getElementById('title').focus();
}

load();

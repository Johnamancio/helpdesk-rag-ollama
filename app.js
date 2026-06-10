let templates = [];
let selected = null;
const API_BASE_URL = window.location.origin;
let chatHistory = [];

// ===================== TEMPLATES =====================

async function loadTemplates() {
  const res = await fetch(`${API_BASE_URL}/api/templates`);
  templates = await res.json();
  renderTemplateList();
}

function renderTemplateList() {
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
  document.getElementById('editorTitle').textContent = 'Editar template';
  document.getElementById('editor').classList.remove('hidden');
  renderTemplateList();
}

function novoTemplate() {
  selected = null;
  document.getElementById('title').value = '';
  document.getElementById('category').value = '';
  document.getElementById('keywords').value = '';
  document.getElementById('content').value = '';
  document.getElementById('editorTitle').textContent = 'Novo template';
  document.getElementById('editor').classList.remove('hidden');
}

function fecharEditor() {
  document.getElementById('editor').classList.add('hidden');
  selected = null;
  renderTemplateList();
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

  fecharEditor();
  loadTemplates();
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

  fecharEditor();
  loadTemplates();
}

// ===================== SIDEBAR =====================

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('overlay').classList.toggle('show');
}

// ===================== CHAT =====================

function inserirExemplo(texto) {
  document.getElementById('ticketInput').value = texto;
  autoResize(document.getElementById('ticketInput'));
  document.getElementById('ticketInput').focus();
}

function handleKeyDown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    enviarMensagem();
  }
}

function autoResize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 160) + 'px';
}

function scrollToBottom() {
  const container = document.getElementById('chatMessages');
  container.scrollTop = container.scrollHeight;
}

function removeWelcomeScreen() {
  const welcome = document.querySelector('.welcome-screen');
  if (welcome) welcome.remove();
}

function addMessage(role, text, meta = null) {
  removeWelcomeScreen();

  const container = document.getElementById('chatMessages');
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}`;

  const avatarContent = role === 'user' ? 'U' : '⚡';

  let metaHtml = '';
  if (meta) {
    const parts = [];
    if (meta.mode) parts.push(meta.mode);
    if (meta.confidence) parts.push(`Confiança: ${meta.confidence}`);
    if (meta.elapsed) parts.push(meta.elapsed);
    if (meta.template) parts.push(`Template: ${meta.template}`);

    metaHtml = `
      <div class="message-meta">
        ${parts.map(p => `<span class="meta-tag">${escapeHtml(p)}</span>`).join('')}
        <button class="btn-copy-msg" onclick="copiarTexto(this)" data-text="${escapeHtml(text)}">Copiar</button>
      </div>
    `;
  } else if (role === 'user') {
    metaHtml = `
      <div class="message-meta">
        <button class="btn-copy-msg" onclick="copiarTexto(this)" data-text="${escapeHtml(text)}">Copiar</button>
      </div>
    `;
  }

  messageDiv.innerHTML = `
    <div class="message-avatar">${avatarContent}</div>
    <div class="message-content">
      <div class="message-bubble">${escapeHtml(text)}</div>
      ${metaHtml}
    </div>
  `;

  container.appendChild(messageDiv);
  scrollToBottom();
}

function addTypingIndicator() {
  removeWelcomeScreen();

  const container = document.getElementById('chatMessages');
  const typingDiv = document.createElement('div');
  typingDiv.className = 'message agent';
  typingDiv.id = 'typingIndicator';
  typingDiv.innerHTML = `
    <div class="message-avatar">⚡</div>
    <div class="message-content">
      <div class="message-bubble">
        <div class="typing-indicator">
          <span></span><span></span><span></span>
        </div>
      </div>
    </div>
  `;
  container.appendChild(typingDiv);
  scrollToBottom();
}

function removeTypingIndicator() {
  const typing = document.getElementById('typingIndicator');
  if (typing) typing.remove();
}

async function enviarMensagem() {
  const input = document.getElementById('ticketInput');
  const ticket = input.value.trim();

  if (!ticket) return;

  // Adiciona mensagem do usuário
  addMessage('user', ticket);
  chatHistory.push({ role: 'user', content: ticket });

  // Limpa input
  input.value = '';
  input.style.height = 'auto';

  // Mostra indicador de digitação
  addTypingIndicator();
  document.getElementById('sendBtn').disabled = true;

  try {
    const res = await fetch(`${API_BASE_URL}/api/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket })
    });

    const data = await res.json();

    removeTypingIndicator();

    const response = data.response || 'Não foi possível gerar a resposta.';
    const bestTemplate = Array.isArray(data.templates) ? data.templates[0] : null;
    const confidence = typeof data.confidence === 'number' ? `${Math.round(data.confidence * 100)}%` : '-';
    const mode = data.usedLlm ? 'LLM' : 'Template RAG';
    const elapsed = typeof data.elapsedMs === 'number' ? `${data.elapsedMs}ms` : '-';

    const meta = {
      mode,
      confidence,
      elapsed,
      template: bestTemplate?.title || '-'
    };

    addMessage('agent', response, meta);
    chatHistory.push({ role: 'agent', content: response });

  } catch (error) {
    removeTypingIndicator();
    addMessage('agent', 'Erro ao gerar resposta. Verifique se o servidor está ativo.');
  }

  document.getElementById('sendBtn').disabled = false;
  input.focus();
}

function limparChat() {
  chatHistory = [];
  const container = document.getElementById('chatMessages');
  container.innerHTML = `
    <div class="welcome-screen">
      <div class="welcome-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
          <path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z"/>
          <path d="M10 21h4"/>
          <path d="M12 18v3"/>
        </svg>
      </div>
      <h2>Olá! Sou o Agente Helpdesk</h2>
      <p>Cole o texto do ticket abaixo e eu vou gerar a melhor resposta com base nos templates cadastrados.</p>
      <div class="welcome-chips">
        <button class="chip" onclick="inserirExemplo('Cliente relata que o sistema não atualiza as informações após login.')">Sistema não atualiza</button>
        <button class="chip" onclick="inserirExemplo('Solicitação de melhoria no módulo de relatórios. CNPJ: 12.345.678/0001-90')">Solicitação de melhoria</button>
        <button class="chip" onclick="inserirExemplo('Ticket sem resposta há 5 dias, cliente não enviou dados solicitados.')">Ticket sem resposta</button>
      </div>
    </div>
  `;
}

async function copiarTexto(btn) {
  const text = btn.getAttribute('data-text')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#039;', "'");

  try {
    await navigator.clipboard.writeText(text);
    const original = btn.textContent;
    btn.textContent = 'Copiado!';
    setTimeout(() => { btn.textContent = original; }, 1500);
  } catch {
    // Fallback
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    const original = btn.textContent;
    btn.textContent = 'Copiado!';
    setTimeout(() => { btn.textContent = original; }, 1500);
  }
}

// ===================== INIT =====================

loadTemplates();

// DTD Store Chat Page
document.addEventListener('DOMContentLoaded', () => {
  initChat();
});

function initChat() {
  // Check for existing chat session
  const session = localStorage.getItem('dtd_chat_session');
  if (session) {
    showChatSession(JSON.parse(session));
  }
  
  // Initialize Telegram WebApp if available
  if (window.Telegram && window.Telegram.WebApp) {
    const tg = window.Telegram.WebApp;
    tg.expand();
    tg.setHeaderColor('#1a1a2e');
    tg.setBackgroundColor('#1a1a2e');
    tg.showCloseButton();
  }
}

function showChatSession(session) {
  const chatEl = document.getElementById('chatMessages');
  if (!chatEl) return;
  
  chatEl.innerHTML = `
    <div style="background:var(--cyber-bg);border:1px solid var(--cyber-border);border-radius:8px;padding:1rem;margin-bottom:1rem;">
      <div style="color:var(--cyber-neon);font-weight:600;margin-bottom:0.5rem;">Chat Session: ${session.sessionId || 'N/A'}</div>
      <div style="color:var(--cyber-text);font-size:0.875rem;">Connected to ${session.botUsername || 'Bot'}</div>
    </div>
  `;
}

function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const msg = input.value.trim();
  if (!msg) return;
  
  // Send to backend API
  fetch('/api/telegram/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: msg,
      name: 'Chat User'
    })
  }).then(res => res.json()).then(data => {
    input.value = '';
    showMessage('Your message sent', 'success');
  }).catch(err => {
    showMessage('Failed to send message', 'error');
  });
}

function showMessage(msg, type) {
  const container = document.getElementById('chatMessages');
  if (!container) return;
  
  const el = document.createElement('div');
  el.style.cssText = `
    background:${type === 'success' ? 'rgba(0,255,136,0.1)' : 'rgba(255,0,85,0.1)'};
    border:1px solid:${type === 'success' ? 'rgba(0,255,136,0.3)' : 'rgba(255,0,85,0.3)'};
    padding:0.75rem 1rem;
    border-radius:6px;
    margin:0.5rem 0;
    color:${type === 'success' ? 'var(--cyber-neon-green)' : 'var(--cyber-neon-red)'};
  `;
  el.textContent = msg;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}
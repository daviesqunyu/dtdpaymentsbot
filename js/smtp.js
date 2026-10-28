// DTD Store SMTP Vault Page
document.addEventListener('DOMContentLoaded', () => {
  initSmtp();
});

function initSmtp() {
  const adminJwt = localStorage.getItem('dtd_smtp_jwt');
  if (adminJwt) {
    showAdminPanel(adminJwt);
  } else {
    showLoginForm();
  }
}

function showLoginForm() {
  const smtpEl = document.getElementById('smtpContent');
  if (!smtpEl) return;
  
  smtpEl.innerHTML = `
    <div style="background:var(--cyber-bg);border:1px solid var(--cyber-border);border-radius:8px;padding:2rem;">
      <div style="color:var(--cyber-neon);font-weight:600;margin-bottom1rem;">SMTP Vault Admin Login</div>
      <form id="smtpLoginForm">
        <div style="margin-bottom:1rem;">
          <label class="form-label" style="display:block;margin-bottom:0.25rem;color:var(--cyber-text);">Admin JWT Token</label>
          <input type="password" id="adminJwtInput" required style="width:100%;padding:0.5rem;background:var(--cyber-bg);border:1px solid var(--cyber-border);color:var(--cyber-text);border-radius:4px;">
        </div>
        <button type="submit" class="btn btn-primary btn-block" style="width:100%;padding:0.75rem;background:var(--cyber-neon);color:var(--cyber-bg);border:none;border-radius:6px;font-weight:600;">Login</button>
      </form>
    </div>
  `;
  
  document.getElementById('smtpLoginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const jwt = document.getElementById('adminJwtInput').value.trim();
    if (!jwt) return;
    
    try {
      const res = await fetch('/api/smtp/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminJwt: jwt })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invalid JWT');
      
      localStorage.setItem('dtd_smtp_jwt', jwt);
      showAdminPanel(jwt);
    } catch (err) {
      showMessage(err.message || 'Login failed', 'error');
    }
  });
}

function showAdminPanel(jwt) {
  const smtpEl = document.getElementById('smtpContent');
  if (!smtpEl) return;
  
  smtpEl.innerHTML = `
    <div style="background:var(--cyber-bg);border:1px solid var(--cyber-border);border-radius:8px;padding:1rem;margin-bottom:1rem;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span style="color:var(--cyber-neon);font-weight:600;">SMTP Controls</span>
        <button onclick="logoutSmtp()" style="color:var(--cyber-muted);font-size:0.875rem;">Logout</button>
      </div>
    </div>
    
    <div class="card" style="margin-bottom:1rem;">
      <div style="color:var(--cyber-neon);font-weight:600;margin-bottom:0.75rem;">Send Email</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem;">
        <div>
          <label class="form-label" style="display:block;margin-bottom:0.25rem;color:var(--cyber-text);">From</label>
          <input type="email" id="smtpFrom" required style="width:100%;padding:0.5rem;background:var(--cyber-bg);border:1px solid var(--cyber-border);color:var(--cyber-text);border-radius:4px;">
        </div>
        <div>
          <label class="form-label" style="display:block;margin-bottom:0.25rem;color:var(--cyber-text);">To</label>
          <input type="email" id="smtpTo" required style="width:100%;padding:0.5rem;background:var(--cyber-bg);border:1px solid var(--cyber-border);color:var(--cyber-text);border-radius:4px;">
        </div>
      </div>
      <div style="margin-bottom:1rem;">
        <label class="form-label" style="display:block;margin-bottom:0.25rem;color:var(--cyber-text);">Subject</label>
        <input type="text" id="smtpSubject" required style="width:100%;padding:0.5rem;background:var(--cyber-bg);border:1px solid var(--cyber-border);color:var(--cyber-text);border-radius:4px;">
      </div>
      <div style="margin-bottom:1rem;">
        <label class="form-label" style="display:block;margin-bottom:0.25rem;color:var(--cyber-text);">Message</label>
        <textarea id="smtpMessage" rows="3" required style="width:100%;padding:0.5rem;background:var(--cyber-bg);border:1px solid var(--cyber-border);color:var(--cyber-text);border-radius:4px;resize:vertical;"></textarea>
      </div>
      <button onclick="sendSmtpEmail('${jwt}')" class="btn btn-primary btn-block" style="width:100%;padding:0.75rem;background:var(--cyber-neon);color:var(--cyber-bg);border:none;border-radius:6px;font-weight:600;">Send Email</button>
    </div>
    
    <div class="card">
      <div style="color:var(--cyber-neon);font-weight:600;margin-bottom:0.75rem;">Send SMS</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem;">
        <div>
          <label class="form-label" style="display:block;margin-bottom:0.25rem;color:var(--cyber-text);">Phone</label>
          <input type="text" id="smsPhone" required style="width:100%;padding:0.5rem;background:var(--cyber-bg);border:1px solid var(--cyber-border);color:var(--cyber-text);border-radius:4px;">
        </div>
        <div>
          <label class="form-label" style="display:block;margin-bottom:0.25rem;color:var(--cyber-text);">Message</label>
          <input type="text" id="smsText" required style="width:100%;padding:0.5rem;background:var(--cyber-bg);border:1px solid var(--cyber-border);color:var(--cyber-text);border-radius:4px;">
        </div>
      </div>
      <button onclick="sendSmsSms('${jwt}')" class="btn btn-primary btn-block" style="width:100%;padding:0.75rem;background:var(--cyber-neon);color:var(--cyber-bg);border:none;border-radius:6px;font-weight:600;">Send SMS</button>
    </div>
    
    <div class="card">
      <div style="color:var(--cyber-neon);font-weight:600;margin-bottom:0.75rem;">SMTP Jobs Status</div>
      <div id="smtpJobsStatus" style="height:150px;overflow:auto;font-size:0.75rem;color:var(--cyber-text);background:var(--cyber-bg);padding:1rem;border-radius:4px;border:1px solid var(--cyber-border);">
        Loading jobs...
      </div>
    </div>
  `;
  
  loadSmtpJobs(jwt);
}

function logoutSmtp() {
  localStorage.removeItem('dtd_smtp_jwt');
  window.location.reload();
}

async function sendSmtpEmail(jwt) {
  const from = document.getElementById('smtpFrom').value.trim();
  const to = document.getElementById('smtpTo').value.trim();
  const subject = document.getElementById('smtpSubject').value.trim();
  const message = document.getElementById('smtpMessage').value.trim();
  
  if (!from || !to || !subject || !message) {
    showMessage('Please fill in all fields', 'error');
    return;
  }
  
  try {
    await fetch('/api/smtp/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, message })
    });
    showMessage('Email sent successfully', 'success');
  } catch (err) {
    showMessage(err.message || 'Failed to send email', 'error');
  }
}

async function sendSmsSms(jwt) {
  const phone = document.getElementById('smsPhone').value.trim();
  const text = document.getElementById('smsText').value.trim();
  
  if (!phone || !text) {
    showMessage('Please fill in all fields', 'error');
    return;
  }
  
  try {
    await fetch('/api/smtp/send-sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, text })
    });
    showMessage('SMS sent successfully', 'success');
  } catch (err) {
    showMessage(err.message || 'Failed to send SMS', 'error');
  }
}

async function loadSmtpJobs(jwt) {
  try {
    const res = await fetch('/api/smtp/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jwt })
    });
    const data = await res.json();
    const jobsEl = document.getElementById('smtpJobsStatus');
    if (!jobsEl) return;
    
    if (data.length === 0) {
      jobsEl.innerHTML = '<div style="color:var(--cyber-muted);">No jobs</div>';
      return;
    }
    
    jobsEl.innerHTML = data.map(job => `
      <div style="padding:0.5rem 0;border-bottom:1px solid var(--cyber-border);">
        <div style="color:var(--cyber-text);">${escapeHtml(job.type || 'unknown')}</div>
        <div style="color:var(--cyber-muted);font-size:0.75rem;">${escapeHtml(job.status || 'pending')} — ${new Date(job.created_at * 1000).toLocaleString()}</div>
      </div>
    `).join('');
  } catch (err) {
    console.error(err);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
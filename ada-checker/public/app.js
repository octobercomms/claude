const form = document.getElementById('checkForm');
const urlInput = document.getElementById('urlInput');
const submitBtn = document.getElementById('submitBtn');
const errorBox = document.getElementById('errorBox');
const results = document.getElementById('results');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (!url) return;

  setLoading(true);
  hideError();
  results.hidden = true;

  try {
    const res = await fetch('/api/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();

    if (!res.ok || data.error) {
      showError(data.error || 'An unexpected error occurred.');
      return;
    }

    renderResults(data);
  } catch {
    showError('Could not reach the server. Please try again.');
  } finally {
    setLoading(false);
  }
});

function renderResults(data) {
  const { score, issues, passes, summary } = data;

  // Score ring
  const ringFill = document.getElementById('ringFill');
  const circumference = 327;
  const offset = circumference - (score / 100) * circumference;
  ringFill.style.strokeDashoffset = offset;

  if (score >= 80) {
    ringFill.style.stroke = 'var(--pass)';
  } else if (score >= 50) {
    ringFill.style.stroke = 'var(--moderate)';
  } else {
    ringFill.style.stroke = 'var(--critical)';
  }

  document.getElementById('scoreNumber').textContent = score;

  const verdict = document.querySelector('.score-verdict');
  if (score >= 80) {
    verdict.textContent = 'Good Accessibility';
    verdict.style.color = 'var(--pass)';
  } else if (score >= 50) {
    verdict.textContent = 'Needs Improvement';
    verdict.style.color = 'var(--moderate)';
  } else {
    verdict.textContent = 'Significant Barriers';
    verdict.style.color = 'var(--critical)';
  }

  document.getElementById('criticalCount').textContent = summary.criticalCount;
  document.getElementById('seriousCount').textContent = summary.seriousCount;
  document.getElementById('moderateCount').textContent = summary.moderateCount;
  document.getElementById('passCount').textContent = summary.totalPasses;

  // Issues
  const issuesList = document.getElementById('issuesList');
  document.getElementById('issuesBadge').textContent = issues.length;
  issuesList.innerHTML = issues.length === 0
    ? '<p style="color:var(--muted);font-size:.9rem">No issues found!</p>'
    : issues.map(renderIssueItem).join('');

  // Passes
  const passesList = document.getElementById('passesList');
  document.getElementById('passesBadge').textContent = passes.length;
  passesList.innerHTML = passes.length === 0
    ? '<p style="color:var(--muted);font-size:.9rem">No checks passed.</p>'
    : passes.map(renderPassItem).join('');

  results.hidden = false;
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderIssueItem(issue) {
  return `
    <div class="check-item" role="listitem">
      <div class="chip-col">
        <span class="chip ${issue.severity}">${capitalize(issue.severity)}</span>
      </div>
      <div class="check-category">${escHtml(issue.category)}</div>
      <div class="check-message">${escHtml(issue.message)}</div>
      ${issue.detail ? `<div class="check-detail">${escHtml(issue.detail)}</div>` : ''}
    </div>`;
}

function renderPassItem(p) {
  return `
    <div class="check-item pass-item" role="listitem">
      <div class="chip-col">
        <span class="chip pass">Pass</span>
      </div>
      <div class="check-category">${escHtml(p.category)}</div>
      <div class="check-message">${escHtml(p.message)}</div>
    </div>`;
}

function setLoading(on) {
  submitBtn.classList.toggle('loading', on);
  submitBtn.disabled = on;
  document.querySelector('.btn-spinner').style.display = on ? 'inline-block' : 'none';
  document.querySelector('.btn-text').textContent = on ? 'Analyzing...' : 'Analyze';
}

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.hidden = false;
}

function hideError() {
  errorBox.hidden = true;
  errorBox.textContent = '';
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

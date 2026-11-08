// OMI Xero Brain extension popup: configure server URL and token.

const $ = (sel) => document.querySelector(sel);

async function loadConfig() {
  try {
    const { omiServerUrl, omiToken } = await chrome.storage.local.get(['omiServerUrl', 'omiToken']);
    if (omiServerUrl && omiToken) {
      showConnected(omiServerUrl);
    }
  } catch {
    // storage empty, show setup
  }
}

function showConnected(url) {
  $('#setupView').style.display = 'none';
  $('#connectedView').style.display = 'block';
  $('#statusDot').className = 'dot connected';
  const host = new URL(url).hostname;
  $('#connectedStatus').textContent = `Connected to ${host}. The brain will advise on the Xero reconciliation page.`;
}

function showSetup() {
  $('#setupView').style.display = 'block';
  $('#connectedView').style.display = 'none';
  $('#statusDot').className = 'dot';
}

function showStatus(msg, ok) {
  const el = $('#statusMsg');
  el.className = ok ? 'status status-ok' : 'status status-err';
  el.textContent = msg;
  el.style.display = 'block';
}

$('#saveBtn').addEventListener('click', async () => {
  const serverUrl = $('#serverUrl').value.trim().replace(/\/+$/, '');
  const token = $('#token').value.trim();

  if (!serverUrl) return showStatus('Server URL is required.', false);
  if (!token) return showStatus('Extension token is required.', false);

  try {
    new URL(serverUrl);
  } catch {
    return showStatus('Invalid URL format.', false);
  }

  showStatus('Testing connection...', true);

  try {
    const res = await fetch(`${serverUrl}/api/accounts/brain/lookup?payee=test`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 401) {
      $('#statusDot').className = 'dot error';
      return showStatus('Token rejected. Check it is correct and not revoked.', false);
    }
    if (!res.ok) {
      $('#statusDot').className = 'dot error';
      return showStatus(`Server returned ${res.status}. Check the URL.`, false);
    }

    await chrome.storage.local.set({ omiServerUrl: serverUrl, omiToken: token });
    showConnected(serverUrl);
  } catch (err) {
    $('#statusDot').className = 'dot error';
    showStatus(`Connection failed: ${err.message}`, false);
  }
});

$('#disconnectBtn').addEventListener('click', async () => {
  await chrome.storage.local.remove(['omiServerUrl', 'omiToken']);
  $('#serverUrl').value = '';
  $('#token').value = '';
  $('#statusMsg').style.display = 'none';
  showSetup();
});

loadConfig();

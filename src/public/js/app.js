const SLACK_USER_ID = 'U0BDUJLFFMW';
const SLACK_TEAM_ID = 'T0BD3V5CFGU';

const HEADERS = {
  'Content-Type': 'application/json',
  'x-slack-user-id': SLACK_USER_ID,
  'x-slack-team-id': SLACK_TEAM_ID,
};

let selectedChannelId   = null;
let selectedChannelName = null;
let cursorHistory       = [];
let currentCursor       = null;

function showToast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.className = 'toast', 3000);
}

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: HEADERS, ...opts });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

async function loadDashboard() {
  try {
    const data = await api('/channels');
    const channels = data.channels || [];

    document.getElementById('statChannels').textContent =
      channels.filter(c => c.is_active).length;

    document.getElementById('navTeam').textContent = SLACK_TEAM_ID;

    let totalMessages = 0;
    const grid = document.getElementById('channelsGrid');

    if (!channels.length) {
      grid.innerHTML = `<div class="channels-empty">
        <div class="empty-icon">📭</div>
        No channels yet — click <strong>+ Add Channel</strong> to start archiving.
      </div>`;
      document.getElementById('statMessages').textContent = '0';
      return;
    }

    const messageCountPromises = channels.map(ch =>
      api(`/api/channels/${ch.slack_channel_id}/messages?limit=1`)
        .then(d => ({ id: ch.slack_channel_id, count: d.messages.length }))
        .catch(() => ({ id: ch.slack_channel_id, count: 0 }))
    );

    renderChannelCards(channels, {});

    const counts = await Promise.all(messageCountPromises);
    const countMap = {};
    counts.forEach(c => { countMap[c.id] = c.count; });

    api('/api/channels/' + channels[0].slack_channel_id + '/messages?limit=500')
      .then(d => {
        document.getElementById('statMessages').textContent =
          d.messages.length.toLocaleString();
      }).catch(() => {});

    renderChannelCards(channels, countMap);
  } catch (e) {
    document.getElementById('channelsGrid').innerHTML =
      `<div class="channels-empty">Failed to load — is the server running?</div>`;
  }
}

function renderChannelCards(channels, countMap) {
  const grid = document.getElementById('channelsGrid');
  if (!channels.length) {
    grid.innerHTML = `<div class="channels-empty">
      <div class="empty-icon">📭</div>
      No channels yet. Click <strong>+ Add Channel</strong> to start.
    </div>`;
    return;
  }

  grid.innerHTML = channels.map(ch => `
    <div class="channel-card ${ch.slack_channel_id === selectedChannelId ? 'selected' : ''}"
          data-id="${ch.slack_channel_id}" data-name="${ch.channel_name}">
      <div class="channel-card-header">
        <div class="channel-card-name">
          <span class="channel-hash">#</span>${ch.channel_name}
        </div>
        <span class="channel-status ${ch.is_active ? 'status-active' : 'status-paused'}">
          ${ch.is_active ? 'active' : 'paused'}
        </span>
      </div>
      <div class="channel-card-stats">
        <div>
          <div class="mini-stat-label">Messages</div>
          <div class="mini-stat-value">${(countMap[ch.slack_channel_id] ?? '—').toString()}</div>
        </div>
        <div>
          <div class="mini-stat-label">Added</div>
          <div class="mini-stat-value" style="font-size:13px;letter-spacing:0">
            ${new Date(ch.created_at).toLocaleDateString()}
          </div>
        </div>
      </div>
      <div class="channel-card-footer">
        <span class="channel-card-id">${ch.slack_channel_id}</span>
        <button class="btn-remove-card" data-id="${ch.slack_channel_id}">Remove</button>
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('.channel-card').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.classList.contains('btn-remove-card')) return;
      selectChannel(el.dataset.id, el.dataset.name);
    });
  });

  grid.querySelectorAll('.btn-remove-card').forEach(btn => {
    btn.addEventListener('click', () => removeChannel(btn.dataset.id));
  });
}

async function removeChannel(id) {
  if (!confirm('Remove this channel?\n\nArchived messages will be preserved.')) return;
  try {
    await api(`/channels/${id}`, { method: 'DELETE' });
    showToast('Channel removed');
    if (selectedChannelId === id) {
      selectedChannelId = null;
      document.getElementById('messagesSection').style.display = 'none';
    }
    loadDashboard();
  } catch (e) { showToast(e.message, true); }
}

function selectChannel(id, name) {
  selectedChannelId   = id;
  selectedChannelName = name;
  cursorHistory       = [];
  currentCursor       = null;

  document.querySelectorAll('.channel-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.id === id);
  });

  const section = document.getElementById('messagesSection');
  section.style.display = 'block';
  document.getElementById('messagesSectionTitle').textContent = '#' + name + ' — Messages';
  document.getElementById('panelChannelName').textContent = '#' + name;
  document.getElementById('panelChannelId').textContent = id;
  document.getElementById('btnExport').onclick = () =>
    showToast('Run: npm run export -- --channel ' + id + ' --team ' + SLACK_TEAM_ID);
  document.getElementById('btnClosePanel').onclick = () => {
    section.style.display = 'none';
    selectedChannelId = null;
    document.querySelectorAll('.channel-card').forEach(c => c.classList.remove('selected'));
  };

  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  loadMessages(id, null);
}

async function loadMessages(channelId, cursor) {
  const wrap = document.getElementById('msgTableWrap');
  const pag  = document.getElementById('pagination');
  wrap.innerHTML = '<div class="empty-state">Loading...</div>';
  pag.style.display = 'none';

  try {
    const params = new URLSearchParams({ limit: '25' });
    if (cursor) params.set('cursor', cursor);
    const data = await api(`/api/channels/${channelId}/messages?${params}`);
    const msgs = data.messages;

    if (!msgs.length) {
      wrap.innerHTML = `<div class="empty-state">
        <div class="empty-icon">💬</div>
        No messages archived yet.<br/>The worker will pick them up on the next cycle.
      </div>`;
      return;
    }

    wrap.innerHTML = `
      <table class="msg-table">
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>User</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          ${msgs.map(m => {
            const date = new Date(parseFloat(m.slack_ts) * 1000);
            const ts   = date.toLocaleDateString() + ' ' +
                          date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const isSystem = !m.slack_user_id || m.subtype;
            return `<tr>
              <td class="td-ts">${ts}</td>
              <td class="td-user">${m.slack_user_id || '—'}</td>
              <td class="td-text ${isSystem ? 'system' : ''}">${escHtml(m.text || '')}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    `;

    pag.style.display = 'flex';
    const prevBtn = document.getElementById('btnPrev');
    const nextBtn = document.getElementById('btnNext');
    const pageInfo = document.getElementById('pageInfo');

    pageInfo.textContent = `page ${cursorHistory.length + 1}`;
    prevBtn.disabled = cursorHistory.length === 0;

    prevBtn.onclick = () => {
      cursorHistory.pop();
      currentCursor = cursorHistory.length ? cursorHistory[cursorHistory.length - 1] : null;
      loadMessages(channelId, currentCursor);
    };

    if (data.pagination.nextCursor) {
      nextBtn.disabled = false;
      nextBtn.onclick = () => {
        cursorHistory.push(data.pagination.nextCursor);
        currentCursor = data.pagination.nextCursor;
        loadMessages(channelId, data.pagination.nextCursor);
      };
    } else {
      nextBtn.disabled = true;
    }

  } catch (e) {
    wrap.innerHTML = `<div class="empty-state">Failed: ${e.message}</div>`;
  }
}

function clearSearch() {
  document.getElementById('searchInput').value = '';
  document.getElementById('fromDate').value    = '';
  document.getElementById('toDate').value      = '';
  document.getElementById('searchResults').style.display = 'none';
  document.getElementById('msgTableWrap').style.display  = 'block';
  document.getElementById('pagination').style.display    = 'flex';
  document.getElementById('btnClearSearch').style.display = 'none';
}

document.addEventListener('click', e => {
  if (e.target.id === 'btnSearch') triggerSearch();
  if (e.target.id === 'btnClearSearch') clearSearch();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.activeElement.id === 'searchInput') triggerSearch();
});

function triggerSearch() {
  const q    = document.getElementById('searchInput').value.trim();
  const from = document.getElementById('fromDate').value;
  const to   = document.getElementById('toDate').value;
  if (!q && !from && !to) {
    showToast('Enter a search term or pick a date range', true);
    return;
  }
  runSearch(q, from, to);
}

async function runSearch(q, from, to) {
  if (!selectedChannelId) return;

  const resultsDiv = document.getElementById('searchResults');
  const tableWrap  = document.getElementById('msgTableWrap');
  const pagination = document.getElementById('pagination');
  const clearBtn   = document.getElementById('btnClearSearch');

  tableWrap.style.display  = 'none';
  pagination.style.display = 'none';
  resultsDiv.style.display = 'block';
  clearBtn.style.display   = 'inline-flex';
  resultsDiv.innerHTML     = '<div class="empty-state">Searching...</div>';

  try {
    const params = new URLSearchParams();
    if (q)    params.set('q', q);
    if (from) params.set('from', from);
    if (to)   params.set('to', to);

    const data = await api(
      `/api/channels/${selectedChannelId}/search?${params.toString()}`
    );

    // Build a human-readable description of what was searched
    const parts = [];
    if (q)    parts.push(`"<strong style="color:var(--text)">${escHtml(q)}</strong>"`);
    if (from) parts.push(`from <strong style="color:var(--text)">${from}</strong>`);
    if (to)   parts.push(`to <strong style="color:var(--text)">${to}</strong>`);
    const description = parts.join(' ');

    if (!data.results.length) {
      resultsDiv.innerHTML = `<div class="empty-state">
        <div class="empty-icon">🔍</div>
        No messages found for ${description}
      </div>`;
      return;
    }

    resultsDiv.innerHTML = `
      <div style="padding:10px 20px;background:var(--page);border-bottom:1px solid var(--border);font-size:12px;color:var(--muted);font-family:var(--mono)">
        ${data.count} result${data.count !== 1 ? 's' : ''} — ${description}
      </div>
      <table class="msg-table">
        <thead>
          <tr><th>Timestamp</th><th>User</th><th>Message</th></tr>
        </thead>
        <tbody>
          ${data.results.map(m => {
            const date = new Date(parseFloat(m.slack_ts) * 1000);
            const ts   = date.toLocaleDateString() + ' ' +
                         date.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
            const isSystem = !m.slack_user_id || m.subtype;
            const text = escHtml(m.text || '');
            const highlighted = q ? text.replace(
              new RegExp(escHtml(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
              match => `<mark style="background:#FEF08A;border-radius:2px;padding:0 2px">${match}</mark>`
            ) : text;
            return `<tr>
              <td class="td-ts">${ts}</td>
              <td class="td-user">${m.slack_user_id || '—'}</td>
              <td class="td-text ${isSystem ? 'system' : ''}">${highlighted}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {
    resultsDiv.innerHTML = `<div class="empty-state">Search failed: ${e.message}</div>`;
  }
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

document.getElementById('btnAddChannel').addEventListener('click', () => {
  document.getElementById('addModal').classList.add('open');
  document.getElementById('inputChannelId').focus();
});
document.getElementById('btnCancelAdd').addEventListener('click', () =>
  document.getElementById('addModal').classList.remove('open'));
document.getElementById('addModal').addEventListener('click', e => {
  if (e.target === e.currentTarget) e.currentTarget.classList.remove('open');
});
document.getElementById('btnConfirmAdd').addEventListener('click', async () => {
  const id   = document.getElementById('inputChannelId').value.trim();
  const name = document.getElementById('inputChannelName').value.trim();
  if (!id || !name) { showToast('Both fields are required', true); return; }
  try {
    await api('/channels', {
      method: 'POST',
      body: JSON.stringify({ slackChannelId: id, channelName: name }),
    });
    document.getElementById('addModal').classList.remove('open');
    document.getElementById('inputChannelId').value = '';
    document.getElementById('inputChannelName').value = '';
    showToast('Channel added');
    loadDashboard();
  } catch (e) { showToast(e.message, true); }
});

loadDashboard();

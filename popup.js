// popup.js v0.3.10
// Manages UI polling and communication with the background scanner

document.addEventListener('DOMContentLoaded', async () => {
  const scanBtn = document.getElementById('scan-btn');
  const batchToggleBtn = document.getElementById('batch-toggle-btn');
  const copyBtn = document.getElementById('copy-btn');
  const debugCopyBtn = document.getElementById('debug-copy-btn');
  const resetBtn = document.getElementById('reset-btn');
  const stopBtn = document.getElementById('stop-btn');
  const statusDiv = document.getElementById('status');
  const resultsContainer = document.getElementById('results-list');
  const reScanBtn = document.getElementById('re-scan-btn');
  const mismatchNotice = document.getElementById('mismatch-notice');
  
  const actionBtns = document.getElementById('action-btns');
  const scanningBtns = document.getElementById('scanning-btns');
  const scanMeta = document.getElementById('scan-meta');
  const lastUrlDiv = document.getElementById('last-url');
  const scanTimeDiv = document.getElementById('scan-time');

  const tabTitleDiv = document.getElementById('tab-title');
  const tabIdDiv = document.getElementById('tab-id');
  const sampleBox = document.getElementById('sample-comparison-box');
  const batchPanel = document.getElementById('batch-panel');
  const batchInput = document.getElementById('batch-input');
  const batchStartBtn = document.getElementById('batch-start-btn');
  const batchCopyEngineBtn = document.getElementById('batch-copy-engine-btn');
  const batchCopyMapBtn = document.getElementById('batch-copy-map-btn');
  const batchCopyRowsBtn = document.getElementById('batch-copy-rows-btn');
  const batchClearBtn = document.getElementById('batch-clear-btn');
  const batchStatus = document.getElementById('batch-status');
  const batchResults = document.getElementById('batch-results');
  const batchCount = document.getElementById('batch-count');

  let currentResults = [];
  let currentScanData = {};
  let currentBatchState = {};
  let samples = [];
  let pollInterval = null;

  // Load samples
  async function loadSamples() {
    try {
      const resp = await fetch(chrome.runtime.getURL('samples.json'));
      samples = await resp.json();
    } catch(e) {
      console.error('Failed to load samples.json:', e);
    }
  }

  await loadSamples();
  let activeTabId = null;
  let activeTabUrl = '';
  let activeTabTitle = '';

  // Get current active tab
  async function initTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        activeTabId = tab.id;
        activeTabUrl = tab.url;
        activeTabTitle = tab.title || '无标题';
        tabTitleDiv.textContent = activeTabTitle;
        tabIdDiv.textContent = `TAB: ${tab.id}`;
      }
    } catch (e) {
      console.error('Failed to get active tab:', e);
    }
  }

  await initTab();
  
  // Initial load
  loadStateFromStorage();
  startPolling();

  async function triggerScan() {
    if (!activeTabId) return;
    try {
      chrome.runtime.sendMessage({ action: 'START_SCAN', tabId: activeTabId });
    } catch (err) {
      alert(`启动失败: ${err.message}`);
    }
  }

  scanBtn.addEventListener('click', triggerScan);
  reScanBtn.addEventListener('click', triggerScan);
  batchToggleBtn.addEventListener('click', () => {
    batchPanel.classList.toggle('hidden');
    renderBatchState(currentBatchState);
  });

  resetBtn.addEventListener('click', () => {
    if (activeTabId) chrome.runtime.sendMessage({ action: 'RESET_SCAN', tabId: activeTabId });
  });

  stopBtn.addEventListener('click', () => {
    if (activeTabId) chrome.runtime.sendMessage({ action: 'RESET_SCAN', tabId: activeTabId });
  });

  batchInput.addEventListener('input', () => {
    const parsed = parseBatchInput(batchInput.value);
    batchCount.textContent = parsed.rows.length ? `${parsed.rows.length} 条待扫` : '未导入';
  });

  batchStartBtn.addEventListener('click', async () => {
    const parsed = parseBatchInput(batchInput.value);
    if (parsed.rows.length === 0) {
      alert('未识别到可扫描的试玩链接。请从飞书复制包含“试玩链接”的行，或一行粘贴一个 URL。');
      return;
    }

    batchPanel.classList.remove('hidden');
    batchStatus.textContent = `已导入 ${parsed.rows.length} 条，准备开始扫描...`;
    await chrome.runtime.sendMessage({
      action: 'START_BATCH_SCAN',
      rows: parsed.rows,
      headerCells: parsed.headerCells
    });
  });

  batchCopyEngineBtn.addEventListener('click', () => {
    const text = buildBatchEngineColumn(currentBatchState);
    copyBatchText(text, batchCopyEngineBtn);
  });

  batchCopyMapBtn.addEventListener('click', () => {
    const text = buildBatchMapText(currentBatchState);
    copyBatchText(text, batchCopyMapBtn);
  });

  batchCopyRowsBtn.addEventListener('click', () => {
    const text = buildBatchRowsText(currentBatchState);
    copyBatchText(text, batchCopyRowsBtn);
  });

  batchClearBtn.addEventListener('click', async () => {
    batchInput.value = '';
    currentBatchState = {};
    await chrome.runtime.sendMessage({ action: 'RESET_BATCH_SCAN' });
    renderBatchState({});
  });

  copyBtn.addEventListener('click', () => {
    if (currentResults.length === 0) return;
    
    const formattedText = currentResults.map(res => {
      const adPlatformStr = res.adPlatform === 'Unknown' ? '未知' : (res.adPlatform || '未知');
      const engineStr = res.engine === 'Unknown' ? '未知' : (res.engine || '未知');
      const renderLibStr = res.renderLibrary === 'Unknown' ? '未知' : (res.renderLibrary || '未知');
      const confidenceStr = res.confidence || '未知';

      return `【试玩广告识别结果】

最终审核结论：${res.finalReviewStatus || '未识别，交技术复核'}
广告平台：${adPlatformStr}
制作引擎：${engineStr}
引擎版本：${res.engineVersion || '未知'}
渲染库：${renderLibStr}
渲染库版本：${res.renderLibraryVersion || '未知'}
置信度：${confidenceStr}

平台强证据：
${res.confirmedPlatformEvidence && res.confirmedPlatformEvidence.length > 0 ? res.confirmedPlatformEvidence.map(e => '- ' + e).join('\n') : '- 无'}

平台弱特征(可疑)：
${res.suspiciousPlatformEvidence && res.suspiciousPlatformEvidence.length > 0 ? res.suspiciousPlatformEvidence.map(e => '- ' + e).join('\n') : '- 无'}

引擎证据：
${res.engineEvidence && res.engineEvidence.length > 0 ? res.engineEvidence.map(e => '- ' + e).join('\n') : '- 无'}${res.renderLibraryEvidence && res.renderLibraryEvidence.length > 0 ? '\n' + res.renderLibraryEvidence.map(e => '- ' + e).join('\n') : ''}${res.manualSearchHits && res.manualSearchHits.length > 0 ? '\n' + res.manualSearchHits.map(e => '- ' + e).join('\n') : ''}

风险提示：
${res.conflictWarnings && res.conflictWarnings.length > 0 ? res.conflictWarnings.map(e => '- ' + e).join('\n') : '- 无'}

处理建议：${res.recommendation}

URL：${res.url}
时间：${res.timestamp}`;
    }).join('\n\n---\n\n');

    navigator.clipboard.writeText(formattedText).then(() => {
      const originalText = copyBtn.textContent;
      copyBtn.textContent = '已复制!';
      setTimeout(() => { copyBtn.textContent = originalText; }, 2000);
    });
  });

  debugCopyBtn.addEventListener('click', () => {
    if (currentResults.length === 0) return;
    
    const formattedText = currentResults.map(res => {
      const adPlatformStr = res.adPlatform === 'Unknown' ? '未知' : (res.adPlatform || '未知');
      const engineStr = res.engine === 'Unknown' ? '未知' : (res.engine || '未知');
      const renderLibStr = res.renderLibrary === 'Unknown' ? '未知' : (res.renderLibrary || '未知');
      const confidenceStr = res.confidence || '未知';

      return [
        `URL：${res.url || '未知'}`,
        `最终审核结论：${res.finalReviewStatus || '未识别，交技术复核'}`,
        `广告平台：${adPlatformStr}${adPlatformStr === '未知' && res.platformSuspicion ? '\\n平台疑似：' + res.platformSuspicion : ''}`,
        `制作引擎：${engineStr}`,
        `引擎版本：${res.engineVersion || '未知'}`,
        `渲染库：${renderLibStr}`,
        `渲染库版本：${res.renderLibraryVersion || '未知'}`,
        `置信度：${confidenceStr}`,
        `平台强证据：${res.confirmedPlatformEvidence?.join(', ') || '无'}`,
        `平台弱证据：${res.suspiciousPlatformEvidence?.join(', ') || '无'}`,
        `已忽略平台证据：${res.ignoredPlatformEvidence?.join(', ') || '无'}`,
        `引擎证据：${res.engineEvidence?.join(', ') || '无'}`,
        `渲染库证据：${res.renderLibraryEvidence?.join(', ') || '无'}`,
        `源码命中：${res.manualSearchHits?.join(', ') || '无'}`,
        `风险提示：${res.conflictWarnings?.join(', ') || '无'}`,
        `处理建议：${res.recommendation}`,
        `[Debug] Raw Engine Evidence: ${JSON.stringify(res.engineEvidence)}`,
        `[Debug] Raw Render Library Evidence: ${JSON.stringify(res.renderLibraryEvidence)}`,
        `[Debug] Canvas Count: ${res.canvasCount}`,
        `[Debug] Frame Sources: ${JSON.stringify(res.frameSources, null, 2)}`,
        `标题：${currentScanData.lastScanTitle || activeTabTitle}`,
        `时间：${res.timestamp}`
      ].join('\n');
    }).join('\n\n--- DEBUG INFO ---\n\n');

    navigator.clipboard.writeText(formattedText).then(() => {
      const originalText = debugCopyBtn.textContent;
      debugCopyBtn.textContent = '已复制!';
      setTimeout(() => { debugCopyBtn.textContent = originalText; }, 2000);
    });
  });

  function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(loadStateFromStorage, 500);
  }

  async function loadStateFromStorage() {
    if (!activeTabId) return;
    const key = `scanState_${activeTabId}`;
    const data = await chrome.storage.local.get([key]);
    const scanState = data[key] || {};
    currentScanData = scanState;
    renderUI(scanState);
    checkSampleMatch(scanState);
    await loadBatchStateFromStorage();
  }

  async function loadBatchStateFromStorage() {
    const data = await chrome.storage.local.get(['batchScanState']);
    currentBatchState = data.batchScanState || {};
    renderBatchState(currentBatchState);
  }

  function checkSampleMatch(data) {
    if (!data.lastScanUrl || !samples.length) {
      sampleBox.classList.add('hidden');
      return;
    }

    const matchedSample = samples.find(s => data.lastScanUrl.includes(s.url) || s.url.includes(data.lastScanUrl));
    if (!matchedSample) {
      sampleBox.classList.add('hidden');
      return;
    }

    const currentResult = data.lastScanResults?.[0] || {};
    const platformMatch = currentResult.adPlatform === matchedSample.expectedPlatform;
    const engineMatch = currentResult.engine === matchedSample.expectedEngine || 
                       (matchedSample.expectedEngine === 'Luna' && currentResult.engine?.includes('Luna'));
    
    // Check Version Match
    let versionMatch = true;
    if (matchedSample.expectedEngineVersion && matchedSample.expectedEngineVersion !== '未知') {
      versionMatch = currentResult.engineVersion === matchedSample.expectedEngineVersion;
    }

    let renderLibMatch = true;
    if (matchedSample.expectedRenderLibrary) {
      renderLibMatch = currentResult.renderLibrary === matchedSample.expectedRenderLibrary;
    }

    const isCorrect = platformMatch && engineMatch && versionMatch && renderLibMatch;

    sampleBox.innerHTML = `
      <span class="sample-title">🎯 命中回归样本: ${matchedSample.name}</span>
      <div class="comparison-row">
        <span>预期平台: ${matchedSample.expectedPlatform}</span>
        <span class="${platformMatch ? 'match' : 'mismatch'}">${platformMatch ? '✅ 一致' : '❌ 不一致'}</span>
      </div>
      <div class="comparison-row">
        <span>预期引擎: ${matchedSample.expectedEngine} ${matchedSample.expectedEngineVersion && matchedSample.expectedEngineVersion !== '未知' ? `(${matchedSample.expectedEngineVersion})` : ''}</span>
        <span class="${engineMatch && versionMatch ? 'match' : 'mismatch'}">${engineMatch && versionMatch ? '✅ 一致' : '❌ 不一致'}</span>
      </div>
      ${matchedSample.expectedRenderLibrary ? `
        <div class="comparison-row">
          <span>预期渲染库: ${matchedSample.expectedRenderLibrary}</span>
          <span class="${renderLibMatch ? 'match' : 'mismatch'}">${renderLibMatch ? '✅ 一致' : '❌ 不一致'}</span>
        </div>
      ` : ''}
      ${!isCorrect ? '<div class="warning-box" style="margin-top:8px;">识别结果与人工样本不一致，建议修正规则。</div>' : ''}
    `;
    sampleBox.classList.remove('hidden');
  }

  function parseBatchInput(text) {
    const lines = text
      .split(/\r?\n/)
      .filter(line => line.trim());

    const result = {
      headerCells: [],
      rows: []
    };

    let headerCells = [];
    lines.forEach((line, lineIndex) => {
      const cells = line.includes('\t') ? line.split('\t').map(cell => cell.trim()) : [line.trim()];
      const urlInfo = findUrlInCells(cells);
      const looksLikeHeader = lineIndex === 0 && !urlInfo && cells.some(cell => {
        const normalized = cell.replace(/\s/g, '');
        return normalized === '试玩链接' || normalized === '引擎' || normalized === '试玩名称';
      });

      if (looksLikeHeader) {
        headerCells = cells;
        result.headerCells = cells;
        return;
      }

      if (!urlInfo) return;

      const engineColumnIndex = getEngineColumnIndex(cells, headerCells);
      const nameColumnIndex = getColumnIndex(headerCells, ['试玩名称', '名称']);
      const productColumnIndex = getColumnIndex(headerCells, ['产品']);
      const scheduleColumnIndex = getColumnIndex(headerCells, ['排期']);
      const inferredName = nameColumnIndex >= 0 ? (cells[nameColumnIndex] || '') : inferBatchRowName(cells, urlInfo.index);

      result.rows.push({
        rowIndex: result.rows.length + 1,
        cells,
        url: urlInfo.url,
        urlColumnIndex: urlInfo.index,
        engineColumnIndex,
        name: inferredName,
        product: productColumnIndex >= 0 ? (cells[productColumnIndex] || '') : '',
        schedule: scheduleColumnIndex >= 0 ? (cells[scheduleColumnIndex] || '') : ''
      });
    });

    return result;
  }

  function findUrlInCells(cells) {
    for (let i = 0; i < cells.length; i++) {
      const match = cells[i].match(/https?:\/\/[^\s\t]+/i);
      if (match) {
        return { index: i, url: match[0] };
      }
    }
    return null;
  }

  function getColumnIndex(headerCells, names) {
    if (!headerCells || headerCells.length === 0) return -1;
    return headerCells.findIndex(cell => names.includes(cell.replace(/\s/g, '')));
  }

  function getEngineColumnIndex(cells, headerCells) {
    const headerIndex = getColumnIndex(headerCells, ['引擎']);
    if (headerIndex >= 0) return headerIndex;
    if (cells.length >= 6) return 5;
    return cells.length;
  }

  function inferBatchRowName(cells, urlColumnIndex) {
    const firstCell = cells[0] || '';
    if (firstCell && !isUrlLike(firstCell) && !looksLikeExistingEngine(firstCell) && !looksLikeNonNameCell(firstCell)) {
      return firstCell;
    }

    const candidates = cells
      .map((cell, index) => ({ cell: cell.trim(), index }))
      .filter(item => item.cell && item.index !== urlColumnIndex)
      .filter(item => !isUrlLike(item.cell))
      .filter(item => !looksLikeExistingEngine(item.cell))
      .filter(item => !looksLikeNonNameCell(item.cell));

    const chineseCandidate = candidates.find(item => /[\u4e00-\u9fa5]/.test(item.cell));
    return (chineseCandidate || candidates[0])?.cell || '';
  }

  function isUrlLike(value) {
    return /^https?:\/\//i.test(String(value || '').trim());
  }

  function looksLikeExistingEngine(value) {
    return /(Cocos|Creator|Pixi|PixiJS|Phaser|Laya|Egret|Luna|Construct|PlayCanvas|Three\.js|未知|扫描失败)/i.test(String(value || ''));
  }

  function looksLikeNonNameCell(value) {
    const text = String(value || '').trim();
    return !text ||
      /^wx[a-z0-9]{8,}$/i.test(text) ||
      /^[a-z]{2,5}$/i.test(text) ||
      /^\d{3,8}$/.test(text) ||
      /^20\d{2}[-/年]?\d{1,2}/.test(text);
  }

  function renderBatchState(state = {}) {
    const rows = state.rows || [];
    const total = state.total || rows.length;
    const completed = state.completed || rows.filter(row => row.status === 'complete' || row.status === 'failed').length;
    const parsedRows = parseBatchInput(batchInput.value).rows.length;
    const hasFinishedRows = rows.some(row => row.status === 'complete' || row.status === 'failed');
    const isScanning = state.scanStatus === 'scanning';

    batchCount.textContent = total ? `${completed}/${total}` : (parsedRows ? `${parsedRows} 条待扫` : '未导入');
    batchStatus.textContent = state.scanProgressText || (parsedRows ? `已识别 ${parsedRows} 条待扫链接。` : '等待粘贴飞书行。');
    batchStartBtn.disabled = isScanning;
    batchCopyEngineBtn.disabled = !hasFinishedRows;
    batchCopyMapBtn.disabled = !hasFinishedRows;
    batchCopyRowsBtn.disabled = !hasFinishedRows;

    if (rows.length === 0) {
      batchResults.innerHTML = '';
      return;
    }

    batchResults.innerHTML = rows.map(row => {
      const status = row.status || 'pending';
      const statusText = getBatchStatusText(status);
      const engineCell = row.status === 'failed' ? '扫描失败' : (row.result ? formatEngineCell(row.result) : '等待中');
      const title = getBatchRowTitle(row);
      const meta = getBatchRowMeta(row, statusText);
      const rowNumber = row.rowIndex || '';
      const tooltip = getBatchRowTooltip(row);

      return `
        <div class="batch-row ${escapeHtml(status)}">
          <span class="batch-status-dot" title="${escapeHtml(statusText)}">${escapeHtml(rowNumber)}</span>
          <div class="batch-row-name">
            <div class="batch-row-title truncate" title="${escapeHtml(tooltip)}">${escapeHtml(title)}</div>
            <div class="batch-row-url truncate" title="${escapeHtml(tooltip)}">${escapeHtml(meta)}</div>
          </div>
          <div class="batch-engine-cell truncate" title="${escapeHtml(engineCell)}">${escapeHtml(engineCell)}</div>
        </div>
      `;
    }).join('');
  }

  function getBatchStatusText(status) {
    if (status === 'complete') return 'OK';
    if (status === 'failed') return '失败';
    if (status === 'scanning') return '扫描中';
    return '等待';
  }

  function getBatchRowTitle(row) {
    const number = row.rowIndex || '';
    const name = String(row.name || '').trim();
    const label = name && !isUrlLike(name) ? name : shortenPlayableUrl(row.url);
    return `#${number} ${label || '未命名试玩'}`;
  }

  function getBatchRowMeta(row, statusText) {
    const details = [statusText];
    if (row.product) details.push(row.product);
    if (row.schedule) details.push(row.schedule);
    details.push(formatBatchUrlPair(row));
    return details.filter(Boolean).join(' · ');
  }

  function getBatchRowTooltip(row) {
    const scanUrl = getBatchScanUrl(row);
    if (scanUrl && scanUrl !== row.url) {
      return `详情页：${row.url}\n实际试玩：${scanUrl}`;
    }
    return row.url || '';
  }

  function formatBatchUrlPair(row) {
    const input = shortenPlayableUrl(row.url);
    const scanUrl = getBatchScanUrl(row);
    if (scanUrl && scanUrl !== row.url) {
      return `${input} -> ${shortenPlayableUrl(scanUrl)}`;
    }
    return input;
  }

  function getBatchScanUrl(row) {
    return row.result?.resolvedUrl || row.result?.url || row.resolvedUrl || '';
  }

  function shortenPlayableUrl(url) {
    if (!url) return '';
    try {
      const parsed = new URL(url);
      const detailMatch = parsed.pathname.match(/\/detail\/([^/?#]+)/i);
      if (detailMatch) return `detail/${shortHash(detailMatch[1])}`;

      const htmlMatch = parsed.pathname.match(/\/([^/]*html[^/]*)$/i);
      if (htmlMatch) return htmlMatch[1].slice(0, 26);

      const lastPath = parsed.pathname.split('/').filter(Boolean).pop();
      return lastPath ? `${parsed.hostname}/${shortHash(lastPath)}` : parsed.hostname;
    } catch (e) {
      return String(url).slice(0, 32);
    }
  }

  function shortHash(value) {
    const text = String(value || '');
    if (text.length <= 18) return text;
    return `${text.slice(0, 8)}...${text.slice(-6)}`;
  }

  function buildBatchEngineColumn(state = {}) {
    const rows = state.rows || [];
    return rows.map(row => {
      if (row.status === 'failed') return '扫描失败';
      if (!row.result) return '';
      return formatEngineCell(row.result);
    }).join('\n');
  }

  function buildBatchMapText(state = {}) {
    const rows = state.rows || [];
    const lines = ['序号\t试玩名称/短ID\t详情页/原链接\t实际试玩链接\t识别引擎\t最终结论\t置信度'];
    rows.forEach(row => {
      const result = row.result || {};
      const engineCell = row.status === 'failed' ? '扫描失败' : (row.result ? formatEngineCell(result) : '');
      const name = row.name && !isUrlLike(row.name) ? row.name : shortenPlayableUrl(row.url);
      const scanUrl = getBatchScanUrl(row);
      lines.push([
        row.rowIndex || '',
        name || '',
        row.url || '',
        scanUrl && scanUrl !== row.url ? scanUrl : '',
        engineCell,
        result.finalReviewStatus || '',
        result.confidence || ''
      ].map(sanitizeTsvCell).join('\t'));
    });
    return lines.join('\n');
  }

  function buildBatchRowsText(state = {}) {
    const rows = state.rows || [];
    const lines = [];

    if (state.headerCells && state.headerCells.length > 0) {
      lines.push(state.headerCells.join('\t'));
    }

    rows.forEach(row => {
      const cells = [...(row.cells || [])];
      const engineColumnIndex = Number.isInteger(row.engineColumnIndex) ? row.engineColumnIndex : getEngineColumnIndex(cells, state.headerCells || []);
      while (cells.length <= engineColumnIndex) cells.push('');
      cells[engineColumnIndex] = row.status === 'failed' ? '扫描失败' : (row.result ? formatEngineCell(row.result) : '');
      lines.push(cells.join('\t'));
    });

    return lines.join('\n');
  }

  function sanitizeTsvCell(value) {
    return String(value ?? '').replace(/\r?\n/g, ' ').replace(/\t/g, ' ').trim();
  }

  function formatEngineCell(result = {}) {
    const engine = normalizeUnknown(result.engine);
    const version = normalizeVersion(result.engineVersion);

    if (engine === '未知') return '未知';
    if (engine === 'Cocos Creator') return version ? `Cocos Creator v${version}` : 'Cocos Creator';
    if (engine === 'Phaser') return version ? `Phaser v${version}` : 'Phaser';
    if (engine === 'PixiJS') return version ? `PixiJS ${version}` : 'PixiJS';
    if (engine === 'LayaAir') return version ? `LayaAir ${version}` : 'LayaAir';
    if (engine === 'Egret') return version ? `Egret ${version}` : 'Egret';
    if (engine === 'PlayCanvas') return version ? `PlayCanvas ${version}` : 'PlayCanvas';
    if (engine.startsWith('Construct')) return version ? `${engine} ${version}` : engine;
    return version ? `${engine} ${version}` : engine;
  }

  function normalizeUnknown(value) {
    if (!value || value === 'Unknown' || String(value).includes('未知')) return '未知';
    return String(value);
  }

  function normalizeVersion(value) {
    if (!value || value === 'Unknown' || String(value).includes('未知')) return '';
    return String(value).trim().replace(/^v/i, '');
  }

  async function copyBatchText(text, button) {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    const originalText = button.textContent;
    button.textContent = '已复制';
    setTimeout(() => { button.textContent = originalText; }, 1600);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderUI(data) {
    const status = data.scanStatus || 'idle';
    const results = data.lastScanResults || [];
    currentResults = results;

    // URL Mismatch Check
    if (data.lastScanUrl && data.lastScanUrl !== activeTabUrl && status !== 'scanning') {
      mismatchNotice.classList.remove('hidden');
    } else {
      mismatchNotice.classList.add('hidden');
    }

    // Update Status Bar
    statusDiv.textContent = data.scanProgressText || '准备就绪';
    statusDiv.className = `status-${status}`;

    // Update Meta Info
    if (data.lastScanUrl) {
      scanMeta.classList.remove('hidden');
      lastUrlDiv.textContent = `已扫描: ${data.lastScanUrl}`;
      
      const timeStr = data.scanFinishedAt 
        ? `完成: ${new Date(data.scanFinishedAt).toLocaleTimeString()}` 
        : (data.scanStartedAt ? `开始: ${new Date(data.scanStartedAt).toLocaleTimeString()}` : '');
      scanTimeDiv.textContent = timeStr;
    } else {
      scanMeta.classList.add('hidden');
    }

    // Toggle Buttons
    if (status === 'scanning') {
      actionBtns.classList.add('hidden');
      scanningBtns.classList.remove('hidden');
      copyBtn.disabled = true;
      debugCopyBtn.disabled = true;
    } else {
      actionBtns.classList.remove('hidden');
      scanningBtns.classList.add('hidden');
      copyBtn.disabled = results.length === 0;
      debugCopyBtn.disabled = results.length === 0;
    }

    // Render Results
    if (results.length === 0) {
      if (status === 'scanning') {
        resultsContainer.innerHTML = '<div class="empty-state">正在深度扫描页面源码和 iframe，请勿关闭页面...</div>';
      } else if (status === 'failed') {
        resultsContainer.innerHTML = `<div class="empty-state" style="color: #ef4444;">扫描失败: ${data.errorMessage || '未知错误'}</div>`;
      } else {
        resultsContainer.innerHTML = '<div class="empty-state">点击“开始扫描”开始探测当前页面试玩引擎。</div>';
      }
    } else {
      displayResults(results);
    }
  }

  function displayResults(results) {
    if (!results || results.length === 0) return;
    const currentHtml = resultsContainer.innerHTML;
    const tempContainer = document.createElement('div');
    
    // As of 0.2.3 we only have one aggregated result, but keeping loop just in case
    results.forEach(res => {
      const card = document.createElement('div');
      card.className = 'result-card';
      
      const confidenceColor = (res.confidence === '高' || res.confidence?.includes('高')) ? '#10b981' : (res.confidence?.includes('中') ? '#f59e0b' : '#6b7280');
      
      const adPlatformStr = res.adPlatform === 'Unknown' ? '未知' : (res.adPlatform || '未知');
      const engineStr = res.engine === 'Unknown' ? '未知' : (res.engine || '未知');
      const renderLibStr = res.renderLibrary === 'Unknown' ? '未知' : (res.renderLibrary || '未知');
      const confidenceStr = res.confidence || '未知';

      card.innerHTML = `
        <div class="result-header">
          <span class="engine-name">${engineStr}</span>
          <span class="confidence-badge" style="color: ${confidenceColor}">置信度：${confidenceStr}</span>
        </div>
        
        <div class="result-body">
          <p><strong>最终结论：</strong> <span style="font-weight: 600; color: #ef4444">${res.finalReviewStatus || '未识别，交技术复核'}</span></p>
          <p><strong>广告平台：</strong> ${adPlatformStr}</p>
          ${adPlatformStr === '未知' && res.platformSuspicion ? `<p><strong>平台疑似：</strong> ${res.platformSuspicion}</p>` : ''}
          <p><strong>制作引擎：</strong> ${engineStr}</p>
          <p><strong>引擎版本：</strong> ${res.engineVersion || '未知'}</p>
          <p><strong>渲染库：</strong> ${renderLibStr}</p>
          <p><strong>库版本：</strong> ${res.renderLibraryVersion || '未知'}</p>
          
          ${res.confirmedPlatformEvidence?.length > 0 ? `
            <div style="font-size: 11px; font-weight: 600; margin: 8px 0 4px; color: #475569;">平台强证据：</div>
            <ul class="evidence-list">
              ${res.confirmedPlatformEvidence.map(e => `<li>${e}</li>`).join('')}
            </ul>
          ` : ''}

          ${res.suspiciousPlatformEvidence?.length > 0 ? `
            <div style="font-size: 11px; font-weight: 600; margin: 8px 0 4px; color: #475569;">平台弱特征(可疑)：</div>
            <ul class="evidence-list" style="color: #64748b;">
              ${res.suspiciousPlatformEvidence.map(e => `<li>${e}</li>`).join('')}
            </ul>
          ` : ''}

          <div style="font-size: 11px; font-weight: 600; margin: 8px 0 4px; color: #475569;">引擎证据：</div>
          <ul class="evidence-list">
            ${res.engineEvidence.map(e => `<li>${e}</li>`).join('')}
          </ul>

          ${res.renderLibraryEvidence?.length > 0 ? `
            <div style="font-size: 11px; font-weight: 600; margin: 8px 0 4px; color: #475569;">渲染库证据：</div>
            <ul class="evidence-list">
              ${res.renderLibraryEvidence.map(e => `<li>${e}</li>`).join('')}
            </ul>
          ` : ''}

          ${res.manualSearchHits?.length > 0 ? `
            <div style="font-size: 11px; font-weight: 600; margin: 8px 0 4px; color: #475569;">源码命中：</div>
            <ul class="evidence-list" style="color: #0369a1;">
              ${res.manualSearchHits.map(h => `<li>${h}</li>`).join('')}
            </ul>
          ` : ''}

          ${res.conflictWarnings?.length > 0 ? `
            <div class="warning-box" style="background: #fff1f2; border-left-color: #e11d48; color: #9f1239;">
              <strong>风险提示：</strong>
              ${res.conflictWarnings.map(w => `<div>${w}</div>`).join('')}
            </div>
          ` : ''}
        </div>

        <div class="recommendation">
          <strong>处理建议:</strong> ${res.recommendation}
        </div>
        <div class="url-info">
          来源: ${res.url} <br/>
          时间: ${res.timestamp}
        </div>
      `;
      tempContainer.appendChild(card);
    });

    if (tempContainer.innerHTML !== currentHtml) {
      resultsContainer.innerHTML = tempContainer.innerHTML;
    }
  }
});

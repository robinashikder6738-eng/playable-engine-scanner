// popup.js v0.1.4
// Manages UI polling and communication with the background scanner

document.addEventListener('DOMContentLoaded', async () => {
  const scanBtn = document.getElementById('scan-btn');
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

  let currentResults = [];
  let currentScanData = {};
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

  resetBtn.addEventListener('click', () => {
    if (activeTabId) chrome.runtime.sendMessage({ action: 'RESET_SCAN', tabId: activeTabId });
  });

  stopBtn.addEventListener('click', () => {
    if (activeTabId) chrome.runtime.sendMessage({ action: 'RESET_SCAN', tabId: activeTabId });
  });

  copyBtn.addEventListener('click', () => {
    if (currentResults.length === 0) return;
    
    const formattedText = currentResults.map(res => {
      return `【试玩广告识别结果】

最终审核结论：${res.finalReviewStatus || '未识别，交技术复核'}
广告平台：${res.adPlatform}
制作引擎：${res.engine}
引擎版本：${res.engineVersion || '未知'}
渲染库：${res.renderLibrary || 'Unknown'}
渲染库版本：${res.renderLibraryVersion || '未知'}
置信度：${res.confidence}

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
      return [
        `URL：${res.url}`,
        `最终审核结论：${res.finalReviewStatus || '未识别，交技术复核'}`,
        `广告平台：${res.adPlatform}${res.adPlatform === 'Unknown' && res.platformSuspicion ? '\\n平台疑似：' + res.platformSuspicion : ''}`,
        `制作引擎：${res.engine}`,
        `引擎版本：${res.engineVersion || '未知'}`,
        `渲染库：${res.renderLibrary || 'Unknown'}`,
        `渲染库版本：${res.renderLibraryVersion || '未知'}`,
        `置信度：${res.confidence}`,
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
      
      card.innerHTML = `
        <div class="result-header">
          <span class="engine-name">${res.engine}</span>
          <span class="confidence-badge" style="color: ${confidenceColor}">置信度：${res.confidence}</span>
        </div>
        
        <div class="result-body">
          <p><strong>最终结论：</strong> <span style="font-weight: 600; color: #ef4444">${res.finalReviewStatus || '未识别，交技术复核'}</span></p>
          <p><strong>广告平台：</strong> ${res.adPlatform}</p>
          ${res.adPlatform === 'Unknown' && res.platformSuspicion ? `<p><strong>平台疑似：</strong> ${res.platformSuspicion}</p>` : ''}
          <p><strong>制作引擎：</strong> ${res.engine}</p>
          <p><strong>引擎版本：</strong> ${res.engineVersion || '未知'}</p>
          <p><strong>渲染库：</strong> ${res.renderLibrary || 'Unknown'}</p>
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

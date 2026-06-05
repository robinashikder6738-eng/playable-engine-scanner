// Background service worker for Playable Engine Scanner v0.3.10
// Modular Design: rules/ engineRules.js, platformRules.js, businessRules.js

import { engineRules } from './rules/engineRules.js';
import { detectPlatforms } from './rules/platformRules.js';
import { getRecommendations } from './rules/businessRules.js';

const GLOBAL_SCAN_TIMEOUT = 12000;
const FRAME_SCAN_TIMEOUT = 3000;
const FETCH_SOURCE_TIMEOUT = 1200;
const BATCH_SCAN_STORAGE_KEY = 'batchScanState';
const BATCH_PAGE_LOAD_TIMEOUT = 18000;
const BATCH_DETAIL_RESOLVE_TIMEOUT = 15000;
const BATCH_PLAYABLE_SETTLE_MS = 4200;
const BATCH_RESCAN_SETTLE_MS = 2600;
const BATCH_MAX_SCAN_ATTEMPTS = 4;
const BATCH_PRECISION_ACTIVE_TABS = true;
const BATCH_SCAN_TIMEOUT = 28000;
const BATCH_ENGINE_SIGNAL_TIMEOUT = 9500;
const MAX_FETCHED_SCRIPT_SOURCES = 16;

let activeBatchId = null;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'START_SCAN') {
    startGlobalScan(request.tabId);
    sendResponse({ started: true });
    return true;
  }
  
  if (request.action === 'RESET_SCAN') {
    resetScanState(request.tabId);
    sendResponse({ reset: true });
    return true;
  }

  if (request.action === 'START_BATCH_SCAN') {
    startBatchScan(request.rows || [], request.headerCells || []);
    sendResponse({ started: true });
    return true;
  }

  if (request.action === 'RESET_BATCH_SCAN') {
    resetBatchScanState();
    sendResponse({ reset: true });
    return true;
  }
});

async function resetScanState(tabId) {
  if (!tabId) return;
  const key = `scanState_${tabId}`;
  await chrome.storage.local.remove(key);
}

async function updateScanStatus(tabId, status, text, extra = {}) {
  const key = `scanState_${tabId}`;
  const data = await chrome.storage.local.get([key]);
  const current = data[key] || {};

  const updated = {
    ...current,
    scanStatus: status,
    scanProgressText: text,
    ...extra
  };
  
  await chrome.storage.local.set({ [key]: updated });
}

async function startGlobalScan(tabId) {
  const key = `scanState_${tabId}`;
  const stateData = await chrome.storage.local.get([key]);
  const state = stateData[key] || {};
  
  if (state.scanStatus === 'scanning') return;

  const scanId = Date.now() + "_" + tabId;
  const startTime = new Date().toISOString();
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch(e) {
    await updateScanStatus(tabId, 'failed', '无法获取标签页信息', { errorMessage: e.message });
    return;
  }

  await updateScanStatus(tabId, 'scanning', '正在开始扫描...', {
    scanId,
    tabId,
    scanStartedAt: startTime,
    lastScanUrl: tab.url,
    lastScanTitle: tab.title,
    lastScanResults: [],
    errorMessage: ''
  });

  try {
    const finalResult = await scanTabToFinalResult(tabId, scanId);

    // Check if this scan is still active (not replaced)
    const latestStateData = await chrome.storage.local.get([key]);
    if (latestStateData[key]?.scanId !== scanId) return;

    await updateScanStatus(tabId, 'complete', '扫描完成', {
      lastScanResults: [finalResult],
      scanFinishedAt: new Date().toISOString()
    });

    // Save to history
    await saveToHistory({
      url: tab.url,
      title: tab.title,
      engine: finalResult.engine || '未知',
      adPlatform: finalResult.adPlatform || '未知',
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error('Scan process error:', err);
    const latestStateData = await chrome.storage.local.get([key]);
    if (latestStateData[key]?.scanId !== scanId) return;

    if (err.message === 'SCAN_TIMEOUT') {
      await updateScanStatus(tabId, 'timeout', '扫描部分超时，已保留已有结果', {
        scanFinishedAt: new Date().toISOString()
      });
    } else {
      await updateScanStatus(tabId, 'failed', `扫描失败: ${err.message}`, {
        scanFinishedAt: new Date().toISOString(),
        errorMessage: err.message
      });
    }
  }
}

async function scanTabToFinalResult(tabId, scanId, timeoutMs = GLOBAL_SCAN_TIMEOUT) {
  const rawResults = await Promise.race([
    handleScan(tabId, scanId),
    new Promise((_, reject) => setTimeout(() => reject(new Error('SCAN_TIMEOUT')), timeoutMs))
  ]);

  const analyzedResults = rawResults.map(raw => analyzeProbeResult(raw));
  return aggregateScanResults(analyzedResults);
}

async function resetBatchScanState() {
  activeBatchId = null;
  await chrome.storage.local.remove(BATCH_SCAN_STORAGE_KEY);
}

async function updateBatchScanState(patch) {
  const data = await chrome.storage.local.get([BATCH_SCAN_STORAGE_KEY]);
  const current = data[BATCH_SCAN_STORAGE_KEY] || {};
  await chrome.storage.local.set({
    [BATCH_SCAN_STORAGE_KEY]: {
      ...current,
      ...patch
    }
  });
}

async function updateBatchRow(batchId, rowIndex, rowPatch, statePatch = {}) {
  const data = await chrome.storage.local.get([BATCH_SCAN_STORAGE_KEY]);
  const current = data[BATCH_SCAN_STORAGE_KEY] || {};
  if (current.batchId !== batchId) return false;

  const rows = [...(current.rows || [])];
  rows[rowIndex] = {
    ...(rows[rowIndex] || {}),
    ...rowPatch
  };

  await chrome.storage.local.set({
    [BATCH_SCAN_STORAGE_KEY]: {
      ...current,
      ...statePatch,
      rows
    }
  });

  return true;
}

async function startBatchScan(rows, headerCells = []) {
  if (!Array.isArray(rows) || rows.length === 0) {
    await updateBatchScanState({
      scanStatus: 'failed',
      scanProgressText: '未找到可扫描的 URL',
      rows: [],
      total: 0,
      completed: 0,
      headerCells,
      errorMessage: '未找到可扫描的 URL'
    });
    return;
  }

  const batchId = `${Date.now()}_batch`;
  activeBatchId = batchId;

  const normalizedRows = rows.map((row, index) => ({
    ...row,
    rowIndex: index + 1,
    status: 'pending',
    result: null,
    error: ''
  }));

  await chrome.storage.local.set({
    [BATCH_SCAN_STORAGE_KEY]: {
      batchId,
      scanStatus: 'scanning',
      scanProgressText: `批量扫描准备中: 0/${normalizedRows.length}`,
      scanStartedAt: new Date().toISOString(),
      scanFinishedAt: '',
      total: normalizedRows.length,
      completed: 0,
      currentIndex: -1,
      currentUrl: '',
      headerCells,
      rows: normalizedRows,
      errorMessage: ''
    }
  });

  let completed = 0;
  for (let i = 0; i < normalizedRows.length; i++) {
    if (activeBatchId !== batchId) return;

    const row = normalizedRows[i];
    await updateBatchRow(batchId, i, { status: 'scanning', error: '' }, {
      scanStatus: 'scanning',
      scanProgressText: `正在扫描 ${i + 1}/${normalizedRows.length}`,
      currentIndex: i,
      currentUrl: row.url
    });

    try {
      const result = await scanBatchRow(row, batchId, i);
      completed += 1;
      await updateBatchRow(batchId, i, { status: 'complete', result, error: '' }, {
        completed,
        scanProgressText: `已完成 ${completed}/${normalizedRows.length}`
      });
    } catch (err) {
      completed += 1;
      await updateBatchRow(batchId, i, {
        status: 'failed',
        result: createFailedBatchResult(row, err),
        error: err.message || '扫描失败'
      }, {
        completed,
        scanProgressText: `已完成 ${completed}/${normalizedRows.length}`
      });
    }
  }

  if (activeBatchId !== batchId) return;

  await updateBatchScanState({
    scanStatus: 'complete',
    scanProgressText: `批量扫描完成: ${completed}/${normalizedRows.length}`,
    currentIndex: -1,
    currentUrl: '',
    completed,
    scanFinishedAt: new Date().toISOString()
  });
  activeBatchId = null;
}

async function scanBatchRow(row, batchId, rowIndex) {
  if (!isScannableUrl(row.url)) {
    throw new Error('URL 格式不支持');
  }

  let tab = null;
  let resolvedTarget = { url: row.url, method: 'direct' };
  try {
    tab = await chrome.tabs.create({ url: row.url, active: BATCH_PRECISION_ACTIVE_TABS });
    await waitForTabReady(tab.id, BATCH_PAGE_LOAD_TIMEOUT);
    await delay(900);

    if (activeBatchId !== batchId) {
      throw new Error('批量扫描已停止');
    }

    if (isInsightrackrPreplayDetailUrl(row.url)) {
      await updateBatchRow(batchId, rowIndex, { resolveStatus: 'resolving' }, {
        scanProgressText: `正在解析详情页 ${rowIndex + 1}`
      });

      resolvedTarget = await resolvePlayableTarget(tab.id, row.url);
      if (!resolvedTarget.url || resolvedTarget.url === row.url) {
        throw new Error('未能从详情页解析真实试玩链接');
      }

      row.resolvedUrl = resolvedTarget.url;
      row.resolveMethod = resolvedTarget.method;

      await updateBatchRow(batchId, rowIndex, {
        resolvedUrl: resolvedTarget.url,
        resolveMethod: resolvedTarget.method
      }, {
        currentUrl: resolvedTarget.url,
        scanProgressText: `已解析试玩链接，正在扫描 ${rowIndex + 1}`
      });

      await chrome.tabs.update(tab.id, { url: resolvedTarget.url });
      if (BATCH_PRECISION_ACTIVE_TABS) {
        await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
      }
      await waitForTabReady(tab.id, BATCH_PAGE_LOAD_TIMEOUT);
      await delay(900);
    }

    await updateBatchRow(batchId, rowIndex, {}, {
      scanProgressText: `等待试玩加载 ${rowIndex + 1}`
    });

    await waitForBatchPlayableStable(tab.id, BATCH_PLAYABLE_SETTLE_MS);
    await waitForPreferredBatchEngineSignal(tab.id, BATCH_ENGINE_SIGNAL_TIMEOUT);
    const finalResult = await scanBatchTabWithRetries(tab.id, batchId, rowIndex, resolvedTarget.url);
    const latestTab = await chrome.tabs.get(tab.id).catch(() => tab);

    finalResult.inputUrl = row.url;
    finalResult.resolvedUrl = resolvedTarget.url;
    finalResult.resolveMethod = resolvedTarget.method;
    finalResult.url = finalResult.url === 'Unknown' ? resolvedTarget.url : finalResult.url;
    finalResult.title = latestTab?.title || finalResult.title || row.name || row.url;

    await saveToHistory({
      url: resolvedTarget.url || row.url,
      title: finalResult.title,
      engine: finalResult.engine || '未知',
      adPlatform: finalResult.adPlatform || '未知',
      timestamp: new Date().toISOString()
    });

    return finalResult;
  } finally {
    if (tab?.id) {
      await chrome.tabs.remove(tab.id).catch(() => {});
      await resetScanState(tab.id);
    }
  }
}

async function scanBatchTabWithRetries(tabId, batchId, rowIndex, scanUrl) {
  const attempts = [];

  if (scanUrl) {
    await updateBatchRow(batchId, rowIndex, { scanAttempt: 'static' }, {
      scanProgressText: `正在静态分析源码 ${rowIndex + 1}`
    });
    const staticResult = await scanUrlStaticFinalResult(scanUrl, `${batchId}_${rowIndex + 1}_static`).catch(err => {
      console.warn('Batch static scan failed:', err.message);
      return null;
    });
    if (staticResult) {
      attempts.push({
        attempt: 'static',
        result: staticResult,
        score: scoreBatchResultQuality(staticResult) + 4
      });
    }
  }

  for (let attempt = 1; attempt <= BATCH_MAX_SCAN_ATTEMPTS; attempt++) {
    if (activeBatchId !== batchId) {
      throw new Error('批量扫描已停止');
    }

    await updateBatchRow(batchId, rowIndex, { scanAttempt: attempt }, {
      scanProgressText: `正在探测试玩 ${rowIndex + 1} (${attempt}/${BATCH_MAX_SCAN_ATTEMPTS})`
    });

    if (attempt > 1) {
      await waitForBatchPlayableStable(tabId, BATCH_RESCAN_SETTLE_MS);
    }

    const scanId = `${batchId}_${rowIndex + 1}_${tabId}_${attempt}`;
    const result = await scanTabToFinalResult(tabId, scanId, BATCH_SCAN_TIMEOUT);
    attempts.push({
      attempt,
      result,
      score: scoreBatchResultQuality(result)
    });

    if (attempt >= 2 && !shouldRescanBatchResult(result)) {
      break;
    }
  }

  attempts.sort((a, b) => (b.score - a.score) || (getAttemptOrder(b.attempt) - getAttemptOrder(a.attempt)));
  const best = attempts[0]?.result || createFailedBatchResult({ url: '' }, new Error('未能获取扫描结果'));
  best.batchScanAttempts = attempts.map(item => ({
    attempt: item.attempt,
    engine: item.result?.engine || '未知',
    engineVersion: item.result?.engineVersion || '未知',
    confidence: item.result?.confidence || '未知',
    score: item.score
  }));

  if (attempts.length > 1) {
    best.conflictWarnings = [
      ...(best.conflictWarnings || []),
      `批量模式已等待并复扫 ${attempts.length} 次，最终采用证据质量最高的结果。`
    ];
    best.conflictWarnings = [...new Set(best.conflictWarnings)];
  }

  return best;
}

function getAttemptOrder(attempt) {
  if (typeof attempt === 'number') return attempt;
  if (attempt === 'static') return 0;
  return -1;
}

async function scanUrlStaticFinalResult(url, scanId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const resp = await fetch(url, { signal: controller.signal, credentials: 'include' });
  clearTimeout(timer);

  if (!resp.ok) {
    throw new Error(`STATIC_FETCH_${resp.status}`);
  }

  const html = await resp.text();
  const inlineScripts = extractInlineScripts(html);
  const externalScripts = extractExternalScripts(html, url);
  const links = extractLinks(html, url);
  const fetchedSources = await fetchScriptSources(externalScripts, MAX_FETCHED_SCRIPT_SOURCES, 3200);

  const raw = {
    scanId,
    tabId: 0,
    isFrame: false,
    frameUrl: url,
    meta: {
      url,
      html: html.substring(0, 80000),
      inlineScripts,
      externalScripts,
      links,
      resources: [url, ...externalScripts, ...links],
      canvasCount: (html.match(/<canvas\b/gi) || []).length,
      visibleText: []
    },
    globals: {},
    fetchedSources,
    warnings: ['批量静态源码分析结果']
  };

  const analyzed = analyzeProbeResult(raw);
  const finalResult = aggregateScanResults([analyzed]);
  finalResult.staticSourceScan = true;
  finalResult.conflictWarnings = [
    ...(finalResult.conflictWarnings || []),
    '批量模式已合并静态源码分析，用于降低 runtime 未初始化导致的误判。'
  ];
  finalResult.conflictWarnings = [...new Set(finalResult.conflictWarnings)];
  return finalResult;
}

function extractInlineScripts(html) {
  const scripts = [];
  const re = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html))) {
    if (match[1]) scripts.push(match[1].substring(0, 120000));
  }
  return scripts;
}

function extractExternalScripts(html, baseUrl) {
  const scripts = [];
  const re = /<script\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)["']?[^>]*>/gi;
  let match;
  while ((match = re.exec(html))) {
    const absolute = toAbsoluteUrl(match[1], baseUrl);
    if (absolute) scripts.push(absolute);
  }
  return [...new Set(scripts)];
}

function extractLinks(html, baseUrl) {
  const links = [];
  const re = /<(?:link|img|iframe|source|video|audio|embed|object)\b[^>]*\b(?:href|src|data)\s*=\s*["']?([^"'\s>]+)["']?[^>]*>/gi;
  let match;
  while ((match = re.exec(html))) {
    const absolute = toAbsoluteUrl(match[1], baseUrl);
    if (absolute) links.push(absolute);
  }
  return [...new Set(links)];
}

function toAbsoluteUrl(value, baseUrl) {
  if (!value || value.startsWith('data:') || value.startsWith('blob:') || value.startsWith('javascript:')) return '';
  try {
    return new URL(value, baseUrl).href;
  } catch (e) {
    return '';
  }
}

async function fetchScriptSources(scriptUrls, limit, timeoutMs) {
  const targets = scriptUrls
    .filter(url => /^https?:\/\//i.test(url))
    .slice(0, limit);

  const settled = await Promise.allSettled(targets.map(async src => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(src, { signal: controller.signal, credentials: 'include' });
      if (!resp.ok) return null;
      const text = await resp.text();
      return { src, text: text.substring(0, 180000) };
    } finally {
      clearTimeout(timer);
    }
  }));

  return settled
    .filter(item => item.status === 'fulfilled' && item.value)
    .map(item => item.value);
}

function shouldRescanBatchResult(result) {
  if (!result) return true;
  const engine = String(result.engine || '');
  const version = String(result.engineVersion || '');
  if (!engine || engine.includes('未知') || engine.includes('疑似')) return true;
  if (result.confidence === '低') return true;
  if (version.includes('未知') && ['Cocos Creator', 'PixiJS', 'Phaser', 'LayaAir', 'Egret', 'PlayCanvas'].includes(engine)) return true;
  if (engine === 'PlayCanvas' && hasLunaBatchHint(result)) return true;
  return false;
}

function scoreBatchResultQuality(result) {
  if (!result) return 0;
  let score = 0;
  const engine = String(result.engine || '');
  const version = String(result.engineVersion || '');

  if (engine && !engine.includes('未知')) score += 25;
  if (engine && !engine.includes('疑似')) score += 10;
  if (engine === 'Luna') score += 80;
  if (engine === 'PlayCanvas' && hasLunaBatchHint(result)) score -= 45;
  if (result.confidence === '高') score += 45;
  else if (result.confidence === '中') score += 28;
  else if (result.confidence === '低') score += 8;
  if (version && !version.includes('未知')) score += 25;
  if (result.adPlatform && result.adPlatform !== 'Unknown') score += 8;
  score += Math.min((result.engineEvidence || []).length * 3, 18);
  score += Math.min((result.confirmedPlatformEvidence || []).length * 2, 10);
  if (result.finalReviewStatus === '可进入复刻评估') score += 5;
  if (result.finalReviewStatus === '扫描失败，建议人工复核') score -= 30;
  return score;
}

function hasLunaBatchHint(result) {
  const text = [
    ...(result.engineEvidence || []),
    ...(result.manualSearchHits || []),
    ...(result.conflictWarnings || []),
    ...(result.frameSources || []).map(item => `${item.url || ''} ${item.engine || ''}`)
  ].join('\n');

  return /luna|LUNA_PLAYGROUND|Bundle chain loaded|Project Settings loaded/i.test(text);
}

async function waitForBatchPlayableStable(tabId, minWaitMs) {
  await delay(minWaitMs);

  const startedAt = Date.now();
  let lastSignature = '';
  let stableSince = Date.now();

  while (Date.now() - startedAt < 7000) {
    const state = await getBatchPageProbeState(tabId);
    const signature = `${state.readyState}|${state.canvasCount}|${state.scriptCount}|${state.resourceCount}|${state.bodyLength}`;

    if (signature === lastSignature) {
      if (state.readyState === 'complete' && Date.now() - stableSince >= 900) {
        return state;
      }
    } else {
      lastSignature = signature;
      stableSince = Date.now();
    }

    if (state.readyState === 'complete' && (state.canvasCount > 0 || Date.now() - startedAt > 3500) && Date.now() - stableSince >= 600) {
      return state;
    }

    await delay(500);
  }

  return getBatchPageProbeState(tabId);
}

async function waitForPreferredBatchEngineSignal(tabId, timeoutMs) {
  const startedAt = Date.now();
  let lastState = null;

  while (Date.now() - startedAt < timeoutMs) {
    const state = await getBatchEngineSignalState(tabId);
    lastState = state;

    if (state.luna || state.cocos || state.pixi || state.phaser || state.laya || state.egret) {
      return state;
    }

    await delay(700);
  }

  return lastState || {};
}

async function getBatchEngineSignalState(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const html = document.documentElement?.outerHTML?.slice(0, 120000) || '';
        const scriptSrc = Array.from(document.querySelectorAll('script[src]')).map(s => s.src).join('\n');
        const text = `${html}\n${scriptSrc}`;
        return {
          readyState: document.readyState,
          canvasCount: document.querySelectorAll('canvas').length,
          luna: !!(window.LUNA || window.LUNA_PLAYGROUND_BUND || window.LUNA_PLAYGROUND_BUNDLE) ||
            /\bLUNA_PLAYGROUND(?:_BUND|_BUNDLE)?\b|Project Settings loaded successfully|Bundle chain loaded successfully/i.test(text),
          cocos: !!(window.cc?.game || window.cc?.director || window.cc?.ENGINE_VERSION || window.CocosEngine || window._CCSettings) ||
            /cc\.ENGINE_VERSION|Cocos Creator|cocos2d-js/i.test(text),
          pixi: !!(window.PIXI?.VERSION || window.PIXI?.Application || window.__PIXI_APP__) ||
            /PIXI\.VERSION|PIXI\.Application|pixi\.js|@pixi/i.test(text),
          phaser: !!(window.Phaser?.Game || window.Phaser?.VERSION) ||
            /Phaser\.Game|Phaser\s+v?\d+\.\d+\.\d+|phaser(?:\.min)?\.js/i.test(text),
          laya: !!(window.Laya?.stage || window.Laya?.version || window.laya?.utils) ||
            /Laya\.stage|LayaAir|laya(?:\.core)?\.js/i.test(text),
          egret: !!(window.egret?.runEgret || window.egret?.MainContext) ||
            /egret\.runEgret|Egret Engine|egret(?:\.min|\.web)?\.js/i.test(text),
          playcanvas: !!(window.pc?.Application || window.pc?.Entity) ||
            /pc\.Application|PlayCanvas|playcanvas/i.test(text)
        };
      },
      world: 'MAIN'
    });

    return result?.[0]?.result || {};
  } catch (e) {
    return {};
  }
}

async function getBatchPageProbeState(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        readyState: document.readyState,
        canvasCount: document.querySelectorAll('canvas').length,
        scriptCount: document.querySelectorAll('script').length,
        bodyLength: document.body?.innerText?.length || 0,
        resourceCount: typeof performance !== 'undefined' ? performance.getEntriesByType('resource').length : 0
      }),
      world: 'MAIN'
    });

    return result?.[0]?.result || {};
  } catch (e) {
    return {
      readyState: 'unknown',
      canvasCount: 0,
      scriptCount: 0,
      bodyLength: 0,
      resourceCount: 0
    };
  }
}

function createFailedBatchResult(row, err) {
  return {
    adPlatform: 'Unknown',
    engine: '未知 / 高度混淆',
    engineVersion: '未知',
    renderLibrary: 'Unknown',
    renderLibraryVersion: '未知',
    confidence: '低',
    finalReviewStatus: '扫描失败，建议人工复核',
    confirmedPlatformEvidence: [],
    suspiciousPlatformEvidence: [],
    ignoredPlatformEvidence: [],
    engineEvidence: [],
    renderLibraryEvidence: [],
    manualSearchHits: [],
    conflictWarnings: [err.message || '扫描失败'],
    recommendation: '批量扫描该 URL 失败，建议手动打开页面后单页扫描。',
    url: row.url || 'Unknown',
    inputUrl: row.url || '',
    resolvedUrl: row.resolvedUrl || '',
    title: row.name || row.url || '',
    timestamp: new Date().toLocaleString(),
    frameSources: []
  };
}

function isInsightrackrPreplayDetailUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.includes('insightrackr.com') && parsed.pathname.includes('/creative/preplay/detail/');
  } catch (e) {
    return false;
  }
}

async function resolvePlayableTarget(tabId, sourceUrl) {
  if (!isInsightrackrPreplayDetailUrl(sourceUrl)) {
    return { url: sourceUrl, method: 'direct' };
  }

  const startedAt = Date.now();
  let lastResolved = null;

  while (Date.now() - startedAt < BATCH_DETAIL_RESOLVE_TIMEOUT) {
    try {
      const result = await Promise.race([
        chrome.scripting.executeScript({
          target: { tabId },
          func: resolvePlayableUrlInPage,
          world: 'MAIN',
          args: [sourceUrl]
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('DETAIL_RESOLVE_ATTEMPT_TIMEOUT')), 5000))
      ]);

      const resolved = result?.[0]?.result;
      if (resolved?.url) {
        lastResolved = resolved;
      }
      if (resolved?.url && isLikelyPlayableHtmlUrl(resolved.url, sourceUrl)) {
        return resolved;
      }
    } catch (e) {
      console.warn('Detail resolver attempt failed:', e.message);
    }

    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab?.url && isLikelyPlayableHtmlUrl(tab.url, sourceUrl)) {
      return { url: tab.url, method: 'detail-navigation' };
    }

    await delay(900);
  }

  if (lastResolved?.url && isLikelyPlayableHtmlUrl(lastResolved.url, sourceUrl)) return lastResolved;
  return { url: sourceUrl, method: 'detail-unresolved' };
}

function isLikelyPlayableHtmlUrl(url, sourceUrl = '') {
  try {
    const parsed = new URL(url);
    const source = sourceUrl ? new URL(sourceUrl) : null;
    if (source && parsed.href === source.href) return false;
    if (!/^https?:$/.test(parsed.protocol)) return false;
    if (parsed.hostname.includes('insightrackr.com') && parsed.pathname.includes('/creative/preplay/detail/')) return false;
    return /\.html?$/i.test(parsed.pathname) || /\/htmls\/\d{4}\//i.test(parsed.pathname) || /x_html_[a-f0-9]{8,}/i.test(parsed.href);
  } catch (e) {
    return false;
  }
}

function isScannableUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

async function resolvePlayableUrlInPage(sourceUrl) {
  const source = new URL(sourceUrl);
  const detailId = (source.pathname.match(/\/detail\/([^/?#]+)/i) || [])[1] || '';
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  const normalizeText = (value) => String(value || '')
    .replace(/\\u002F/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
    .replace(/&#x3D;/g, '=')
    .replace(/&#61;/g, '=');

  const cleanupUrl = (value) => {
    let url = normalizeText(value).trim();
    url = url.replace(/^[("'`]+|[)"'`,;]+$/g, '');
    try {
      url = decodeURIComponent(url);
    } catch (e) {}
    return url;
  };

  const isPlayable = (value) => {
    try {
      const url = cleanupUrl(value);
      const parsed = new URL(url);
      if (!/^https?:$/.test(parsed.protocol)) return false;
      if (parsed.href === source.href) return false;
      if (parsed.hostname.includes('insightrackr.com') && parsed.pathname.includes('/creative/preplay/detail/')) return false;
      return /\.html?$/i.test(parsed.pathname) ||
        /\/htmls\/\d{4}\//i.test(parsed.pathname) ||
        /x_html_[a-f0-9]{8,}/i.test(parsed.href) ||
        (detailId && parsed.href.includes(detailId) && !parsed.hostname.includes('insightrackr.com'));
    } catch (e) {
      return false;
    }
  };

  const scoreUrl = (value) => {
    const url = cleanupUrl(value);
    let score = 0;
    if (detailId && url.includes(detailId)) score += 100;
    if (/x_html_[a-f0-9]{8,}/i.test(url)) score += 80;
    if (/\/htmls\/\d{4}\//i.test(url)) score += 60;
    if (/adinsights/i.test(url)) score += 40;
    if (/oss-accelerate\.aliyuncs\.com/i.test(url)) score += 30;
    if (/Expires=|OSSAccessKeyId=|Signature=/i.test(url)) score += 20;
    return score;
  };

  const findUrlInText = (text) => {
    const normalized = normalizeText(text);
    const matches = normalized.match(/https?:\/\/[^\s"'<>\\]+/gi) || [];
    const candidates = matches
      .map(cleanupUrl)
      .filter(isPlayable)
      .sort((a, b) => scoreUrl(b) - scoreUrl(a));
    return candidates[0] || '';
  };

  const readDomCandidates = () => {
    const chunks = [];
    const attributes = ['href', 'src', 'data-url', 'data-href', 'data-src', 'data-clipboard-text', 'data-value', 'title', 'aria-label'];

    document.querySelectorAll('a, iframe, frame, embed, object, video, source, [href], [src], [data-url], [data-href], [data-clipboard-text]').forEach(el => {
      attributes.forEach(attr => {
        const value = el.getAttribute?.(attr);
        if (value) chunks.push(value);
      });
    });

    document.querySelectorAll('script:not([src])').forEach(script => {
      if (script.textContent) chunks.push(script.textContent);
    });

    chunks.push(document.documentElement?.outerHTML || '');

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        chunks.push(key, localStorage.getItem(key));
      }
    } catch (e) {}

    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        chunks.push(key, sessionStorage.getItem(key));
      }
    } catch (e) {}

    try {
      performance.getEntriesByType('resource').forEach(entry => chunks.push(entry.name));
    } catch (e) {}

    return findUrlInText(chunks.join('\n'));
  };

  const domUrl = readDomCandidates();
  if (domUrl) return { url: domUrl, method: 'detail-dom' };

  const resourceUrls = [];
  try {
    performance.getEntriesByType('resource').forEach(entry => {
      const name = entry.name || '';
      const isAsset = /\.(?:js|css|png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf)(?:[?#]|$)/i.test(name);
      if (!isAsset && (/preplay|creative|detail|material/i.test(name) || (detailId && name.includes(detailId)))) {
        resourceUrls.push(name);
      }
    });
  } catch (e) {}

  for (const apiUrl of [...new Set(resourceUrls)].slice(0, 20)) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1800);
      const resp = await fetch(apiUrl, { credentials: 'include', signal: controller.signal });
      clearTimeout(timer);
      if (!resp.ok) continue;
      const text = await resp.text();
      const apiMatch = findUrlInText(text);
      if (apiMatch) return { url: apiMatch, method: 'detail-api' };
    } catch (e) {}
  }

  const openedUrls = [];
  const originalOpen = window.open;

  try {
    window.open = (url) => {
      if (url) openedUrls.push(String(url));
      return null;
    };
  } catch (e) {}

  const clickTargets = Array.from(document.querySelectorAll('button, a, [role="button"], span, div'))
    .filter(el => {
      const text = (el.textContent || '').replace(/\s/g, '');
      if (!/(跳转|预览|打开试玩|查看试玩)/.test(text)) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    })
    .slice(0, 12);

  for (const el of clickTargets) {
    try {
      el.click();
      await sleep(450);
      const clickMatch = findUrlInText(openedUrls.concat(window.location.href).join('\n'));
      if (clickMatch) {
        return { url: clickMatch, method: 'detail-click' };
      }
    } catch (e) {}
  }

  try {
    window.open = originalOpen;
  } catch (e) {}

  const finalDomUrl = readDomCandidates();
  if (finalDomUrl) return { url: finalDomUrl, method: 'detail-final-dom' };

  return { url: '', method: 'detail-unresolved' };
}

function waitForTabReady(tabId, timeoutMs) {
  return new Promise(resolve => {
    let settled = false;
    let timer = null;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };

    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        cleanup();
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
    timer = setTimeout(cleanup, timeoutMs);
    chrome.tabs.get(tabId).then(tab => {
      if (tab.status === 'complete') cleanup();
    }).catch(cleanup);
  });
}

function aggregateScanResults(analyzedResults) {
  if (!analyzedResults || analyzedResults.length === 0) {
    return {
      adPlatform: 'Unknown',
      engine: '未知 / 高度混淆',
      engineVersion: '未知',
      renderLibrary: 'Unknown',
      renderLibraryVersion: '未知',
      confidence: '低',
      platformSuspicion: '',
      engineEvidence: [],
      renderLibraryEvidence: [],
      confirmedPlatformEvidence: [],
      suspiciousPlatformEvidence: [],
      ignoredPlatformEvidence: [],
      manualSearchHits: [],
      conflictWarnings: [],
      recommendation: '未能获取扫描结果。',
      url: 'Unknown',
      timestamp: new Date().toLocaleString(),
      frameSources: []
    };
  }

  const finalResult = {
    scanId: analyzedResults[0].scanId,
    tabId: analyzedResults[0].tabId,
    adPlatform: 'Unknown',
    engine: '未知 / 高度混淆',
    engineVersion: '未知',
    renderLibrary: 'Unknown',
    renderLibraryVersion: '未知',
    confidence: '低',
    finalReviewStatus: '未识别，交技术复核',
    platformSuspicion: '',
    engineEvidence: [],
    renderLibraryEvidence: [],
    confirmedPlatformEvidence: [],
    suspiciousPlatformEvidence: [],
    ignoredPlatformEvidence: [],
    manualSearchHits: [],
    conflictWarnings: [],
    recommendation: '',
    url: analyzedResults.find(r => !r.isFrame)?.url || analyzedResults[0].url,
    title: analyzedResults.find(r => !r.isFrame)?.title || 'Unknown',
    timestamp: analyzedResults[0].timestamp,
    frameSources: []
  };

  const platformsFound = new Set();
  const enginesFound = []; 
  const renderLibsFound = [];
  let hasPixiJSHighMed = false;
  let hasPhaserHighMed = false;
  let hasLayaWeak = false;
  let hasPixiWeak = false;

  analyzedResults.forEach(res => {
    finalResult.frameSources.push({
      type: res.isFrame ? 'child-frame' : 'main-frame',
      url: res.url,
      platform: res.adPlatform,
      engine: res.engine,
      renderLibrary: res.renderLibrary
    });

    if (res.platformsDetected && res.platformsDetected.length > 0) {
      res.platformsDetected.forEach(p => platformsFound.add(p));
    } else if (res.adPlatform !== 'Unknown' && res.adPlatform !== '多平台特征') {
      platformsFound.add(res.adPlatform);
    }
    if (res.adPlatform === '多平台特征') {
      platformsFound.add('Multiple');
    }
    
    if (res.confirmedPlatformEvidence && res.confirmedPlatformEvidence.length > 0) {
      finalResult.confirmedPlatformEvidence.push(...res.confirmedPlatformEvidence);
    }
    if (res.suspiciousPlatformEvidence && res.suspiciousPlatformEvidence.length > 0) {
      finalResult.suspiciousPlatformEvidence.push(...res.suspiciousPlatformEvidence);
    }
    if (res.ignoredPlatformEvidence && res.ignoredPlatformEvidence.length > 0) {
      finalResult.ignoredPlatformEvidence.push(...res.ignoredPlatformEvidence);
    }
    if (res.platformSuspicion) {
      finalResult.platformSuspicion = res.platformSuspicion;
    }

    if (res.engine === 'PixiJS' && (res.confidence === '高' || res.confidence === '中')) {
      hasPixiJSHighMed = true;
    }
    if (res.engine === 'Phaser' && (res.confidence === '高' || res.confidence === '中')) {
      hasPhaserHighMed = true;
    }
    
    if (res.manualSearchHits) {
      if (res.manualSearchHits.some(h => h.includes('laya'))) {
        hasLayaWeak = true;
      }
      if (res.manualSearchHits.some(h => h.includes('pixi'))) {
        hasPixiWeak = true;
      }
      finalResult.manualSearchHits.push(...res.manualSearchHits);
    }
    
    if (res.engine !== '未知 / 高度混淆') {
      let confidenceScore = 0;
      if (res.confidence === '高') confidenceScore = 3;
      else if (res.confidence === '中') confidenceScore = 2;
      else if (res.confidence === '低') confidenceScore = 1;
      
      enginesFound.push({
        engine: res.engine,
        version: res.engineVersion,
        confidence: res.confidence,
        confidenceScore: confidenceScore,
        evidence: res.engineEvidence,
        isFrame: res.isFrame
      });
    }

    if (res.renderLibrary !== 'Unknown') {
      renderLibsFound.push({
        renderLibrary: res.renderLibrary,
        version: res.renderLibraryVersion,
        evidence: res.renderLibraryEvidence,
        confidence: res.renderLibraryConfidence,
        isFrame: res.isFrame
      });
    }

    if (res.conflictWarnings && res.conflictWarnings.length > 0) {
      finalResult.conflictWarnings.push(...res.conflictWarnings);
    }
  });

  if (platformsFound.size > 1 || platformsFound.has('Multiple') || platformsFound.has('多平台特征')) {
    if (platformsFound.has('Mintegral / MTG')) {
      finalResult.adPlatform = 'Mintegral / MTG';
      finalResult.conflictWarnings.push('当前素材同时命中多平台特征，但包含 MTG 标识，按最高优先级判定为 MTG 平台。');
    } else {
      finalResult.adPlatform = '多平台特征';
      finalResult.conflictWarnings.push('当前素材同时命中多个广告平台特征，可能存在平台包装或转包，建议技术复核。');
    }
  } else if (platformsFound.size === 1) {
    finalResult.adPlatform = Array.from(platformsFound)[0];
  }

  finalResult.confirmedPlatformEvidence = [...new Set(finalResult.confirmedPlatformEvidence)];
  finalResult.suspiciousPlatformEvidence = [...new Set(finalResult.suspiciousPlatformEvidence)];
  finalResult.ignoredPlatformEvidence = [...new Set(finalResult.ignoredPlatformEvidence)];

  if (enginesFound.length > 0) {
    enginesFound.sort((a, b) => {
      // 优先级1：Luna 强特征优先
      if (a.engine === 'Luna' && b.engine !== 'Luna') return -1;
      if (b.engine === 'Luna' && a.engine !== 'Luna') return 1;
      // 优先级2：置信度最高优先
      return b.confidenceScore - a.confidenceScore;
    });
    const bestEngine = enginesFound[0];
    finalResult.engine = bestEngine.engine;
    finalResult.engineVersion = bestEngine.version;
    finalResult.confidence = bestEngine.confidence;

    const distinctEngines = new Set(enginesFound.map(e => e.engine));
    if (distinctEngines.has('Construct 2') && distinctEngines.has('Construct 3')) {
      finalResult.engine = 'Construct';
      finalResult.confidence = '中';
      finalResult.conflictWarnings.push('同时命中 Construct 2 与 Construct 3 特征，建议技术复核。');
    } else if (distinctEngines.size > 1 && !(distinctEngines.has('PixiJS') && distinctEngines.has('疑似 PixiJS'))) {
      if (finalResult.engine === 'Luna') {
        const otherEngines = Array.from(distinctEngines).filter(e => e !== 'Luna');
        finalResult.conflictWarnings.push(`探测到 Luna，覆盖了其他子特征 (${otherEngines.join(', ')})。`);
      } else {
        finalResult.conflictWarnings.push('多个 frame 命中不同引擎特征，最终结果按最高置信度输出，建议人工复核。');
      }
    }

    enginesFound.forEach(e => {
       const prefix = e.isFrame ? '子页面命中 ' : '';
       e.evidence.forEach(ev => {
         finalResult.engineEvidence.push(prefix + ev);
       });
    });

    if (bestEngine.isFrame && analyzedResults.some(r => !r.isFrame && r.engine === '未知 / 高度混淆')) {
      finalResult.conflictWarnings.push('引擎证据来自子页面 / raw playable 页面');
    }
  }

  if (renderLibsFound.length > 0) {
    const bestLib = renderLibsFound[0];
    finalResult.renderLibrary = bestLib.renderLibrary;
    finalResult.renderLibraryVersion = bestLib.version;
    if (enginesFound.length === 0) {
      finalResult.confidence = bestLib.confidence;
    }
    
    renderLibsFound.forEach(e => {
       const prefix = e.isFrame ? '子页面命中 ' : '';
       e.evidence.forEach(ev => {
         finalResult.renderLibraryEvidence.push(prefix + ev);
       });
    });
  }

  if (hasPixiJSHighMed && hasLayaWeak) {
     finalResult.conflictWarnings.push('源码中同时出现 laya 弱关键词，但 PixiJS 证据更明确，建议人工复核。');
  }
  if (hasPhaserHighMed && (hasPixiWeak || hasLayaWeak)) {
     finalResult.conflictWarnings.push('源码中存在其它引擎弱关键词，可能是残留或第三方库，建议人工复核。');
  }

  finalResult.engineEvidence = [...new Set(finalResult.engineEvidence)];
  finalResult.manualSearchHits = [...new Set(finalResult.manualSearchHits)];
  finalResult.conflictWarnings = [...new Set(finalResult.conflictWarnings)];

  const recData = getRecommendations(finalResult);
  finalResult.recommendation = recData.recommendation;
  finalResult.finalReviewStatus = recData.finalReviewStatus;
  finalResult.conflictWarnings.push(...recData.warnings);
  finalResult.conflictWarnings = [...new Set(finalResult.conflictWarnings)];

  return finalResult;
}

function analyzeProbeResult(raw) {
  const meta = raw.meta;
  const globals = raw.globals;
  const fetchedSources = raw.fetchedSources || [];

  const results = {
    scanId: raw.scanId,
    tabId: raw.tabId,
    isFrame: raw.isFrame,
    frameUrl: raw.frameUrl,
    adPlatform: 'Unknown',
    engine: '未知 / 高度混淆',
    engineVersion: '未知',
    renderLibrary: 'Unknown',
    renderLibraryVersion: '未知',
    confidence: '低',
    finalReviewStatus: '未识别，交技术复核',
    platformSuspicion: '',
    engineEvidence: [],
    renderLibraryEvidence: [],
    confirmedPlatformEvidence: [],
    suspiciousPlatformEvidence: [],
    ignoredPlatformEvidence: [],
    manualSearchHits: [],
    conflictWarnings: raw.warnings || [],
    recommendation: '',
    url: raw.frameUrl,
    timestamp: new Date().toLocaleString(),
    canvasCount: meta.canvasCount
  };

  // 1. Detect Platforms
  const platformResult = detectPlatforms(meta, globals, fetchedSources);
  results.adPlatform = platformResult.adPlatform;
  results.platformSuspicion = platformResult.platformSuspicion;
  results.confirmedPlatformEvidence = platformResult.confirmedPlatformEvidence;
  results.suspiciousPlatformEvidence = platformResult.suspiciousPlatformEvidence;
  results.ignoredPlatformEvidence = platformResult.ignoredPlatformEvidence;
  results.platformsDetected = platformResult.platformsDetected;
  if (platformResult.platformsDetected.length > 1) {
    results.conflictWarnings.push('当前素材同时命中多个广告平台特征，建议技术复核。');
  }

  // 2. Detect Engines and Render Libraries
  const engineScores = [];
  const renderLibScores = [];
  
  engineRules.forEach(engineDef => {
    const evalData = engineDef.evaluate(meta, globals, fetchedSources);
    if (evalData && evalData.score > 10) {
      if (evalData.type === 'renderLibrary') {
        if (evalData.score >= 40) {
          renderLibScores.push({
            name: evalData.name,
            score: evalData.score,
            evidence: evalData.evidence,
            version: evalData.version || '未知',
            confidence: evalData.confidence
          });
        }
      } else {
        engineScores.push({
          name: evalData.name,
          score: evalData.score,
          priority: engineDef.priority || 0,
          evidence: evalData.evidence,
          version: evalData.version || '未知',
          confidence: evalData.confidence
        });
      }
    }
  });

  if (engineScores.length > 0) {
    engineScores.sort((a, b) => (b.score - a.score) || (b.priority - a.priority));
    if (engineScores.length > 1 && (engineScores[0].score - engineScores[1].score < 25)) {
      results.conflictWarnings.push('探测到多个引擎强特征，建议技术复核。');
    }
    const bestMatch = engineScores[0];
    results.engine = bestMatch.name;
    results.engineVersion = bestMatch.version;
    results.engineEvidence = bestMatch.evidence;
    results.confidence = bestMatch.confidence || (bestMatch.score >= 80 ? '高' : (bestMatch.score >= 40 ? '中' : '低'));
  }

  if (renderLibScores.length > 0) {
    renderLibScores.sort((a, b) => b.score - a.score);
    const bestMatch = renderLibScores[0];
    results.renderLibrary = bestMatch.name;
    results.renderLibraryVersion = bestMatch.version;
    results.renderLibraryEvidence = bestMatch.evidence;
    results.renderLibraryConfidence = bestMatch.confidence || (bestMatch.score >= 80 ? '高' : (bestMatch.score >= 40 ? '中' : '低'));
    if (results.engine === '未知 / 高度混淆') {
      results.confidence = results.renderLibraryConfidence;
    }
  }

  // 3. Keyword Search
  const manualKeywords = ['pixi', 'luna', 'phaser', 'cocos', 'laya', 'egret', 'playcanvas', 'three.js', 'construct', 'cr.'];
  manualKeywords.forEach(k => {
    const combined = (meta.html + meta.inlineScripts.join(' ') + meta.externalScripts.join(' ')).toLowerCase();
    if (combined.includes(k)) {
      results.manualSearchHits.push(`命中关键词: ${k}`);
    }
  });

  // 4. Business Logic
  const recommendationData = getRecommendations(results);
  results.recommendation = recommendationData.recommendation;
  results.finalReviewStatus = recommendationData.finalReviewStatus;
  results.conflictWarnings.push(...recommendationData.warnings);
  // De-duplicate warnings
  results.conflictWarnings = [...new Set(results.conflictWarnings)];

  return results;
}

async function saveToHistory(item) {
  const data = await chrome.storage.local.get(['scanHistory']);
  const history = data.scanHistory || [];
  history.unshift(item);
  if (history.length > 20) history.pop();
  await chrome.storage.local.set({ scanHistory: history });
}

async function handleScan(tabId, scanId) {
  await updateScanStatus(tabId, 'scanning', '正在遍历页面 Frames...');
  const optionData = await chrome.storage.local.get(['scannerOptions']);
  const scannerOptions = { scanFrames: true, ...(optionData.scannerOptions || {}) };
  
  let frames = [];
  try {
    if (scannerOptions.scanFrames && chrome.webNavigation && chrome.webNavigation.getAllFrames) {
      frames = await chrome.webNavigation.getAllFrames({ tabId });
    }
  } catch (e) {
    console.warn('getAllFrames failed:', e.message);
  }

  const results = [];
  
  if (frames.length === 0) {
    frames = [{ frameId: 0 }]; // Always scan top frame
  }

  const scanPromises = frames.map(async (frame) => {
    try {
      const frameResult = await Promise.race([
        chrome.scripting.executeScript({
          target: { tabId, frameIds: [frame.frameId] },
          func: performProbe,
          world: 'MAIN',
          args: [FETCH_SOURCE_TIMEOUT, scanId, tabId]
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('FRAME_TIMEOUT')), FRAME_SCAN_TIMEOUT))
      ]);
      
      if (frameResult && frameResult[0] && frameResult[0].result) {
        results.push(frameResult[0].result);
      }
    } catch (e) {
      console.warn(`Frame ${frame.frameId} scan skipped or timed out: ${e.message}`);
    }
  });

  await Promise.allSettled(scanPromises);
  return results;
}

// Gather raw data from the page
async function performProbe(fetchTimeoutMs, scanId, tabId) {
  const meta = {
    url: window.location.href,
    html: document.documentElement.outerHTML.substring(0, 50000), 
    inlineScripts: Array.from(document.querySelectorAll('script:not([src])'))
      .map(s => s.textContent)
      .filter(t => t && !t.includes('playable-engine-scanner') && !t.includes('platformRules') && !t.includes('engineRules') && !t.includes('businessRules')),
    externalScripts: Array.from(document.querySelectorAll('script[src]'))
      .map(s => s.src)
      .filter(src => src && !src.startsWith('chrome-extension://') && !src.includes('playable-engine-scanner') && !src.includes('content.js') && !src.includes('injected-probe.js')),
    links: Array.from(document.querySelectorAll('link')).map(l => l.href),
    resources: typeof performance !== 'undefined' ? performance.getEntriesByType('resource')
      .map(r => r.name)
      .filter(name => !name.startsWith('chrome-extension://') && !name.includes('playable-engine-scanner') && !name.includes('service_worker') && !name.includes('content.js') && !name.includes('popup.')) : [],
    canvasCount: document.querySelectorAll('canvas').length,
    visibleText: (() => {
      let text = [];
      try {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while ((node = walker.nextNode())) {
          const parent = node.parentElement;
          if (!parent) continue;
          const tag = parent.tagName.toLowerCase();
          if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'template') continue;
          const style = window.getComputedStyle(parent);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
          const rect = parent.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            const val = node.nodeValue.trim();
            if (val && val.length < 200) {
              text.push(val);
            }
          }
        }
      } catch (e) {}
      return text;
    })()
  };

  await new Promise(resolve => setTimeout(resolve, 600));

  // Probe Globals
  const globals = {};
  const snapshotGlobalObject = (obj) => ({
    exists: true,
    VERSION: obj.VERSION,
    ENGINE_VERSION: obj.ENGINE_VERSION,
    REVISION: obj.REVISION,
    version: obj.version,
    director: !!obj.director,
    game: !!obj.game,
    Application: !!obj.Application,
    Renderer: !!obj.Renderer,
    Ticker: !!obj.Ticker,
    stage: !!obj.stage,
    init: !!obj.init,
    loader: !!obj.loader,
    Browser: !!obj.Browser,
    Sprite: !!obj.Sprite,
    Scene: !!obj.Scene,
    Game: !!obj.Game,
    AUTO: !!obj.AUTO,
    CANVAS: !!obj.CANVAS,
    WEBGL: !!obj.WEBGL,
    runEgret: !!obj.runEgret,
    MainContext: !!obj.MainContext,
    DisplayObject: !!obj.DisplayObject,
    Stage: !!obj.Stage,
    Capabilities: !!obj.Capabilities,
    lifecycle: !!obj.lifecycle,
    WebGLRenderer: !!obj.WebGLRenderer,
    PerspectiveCamera: !!obj.PerspectiveCamera,
    Mesh: !!obj.Mesh,
    TextureLoader: !!obj.TextureLoader,
    Entity: !!obj.Entity,
    AssetRegistry: !!obj.AssetRegistry,
    GraphicsDevice: !!obj.GraphicsDevice,
    app: !!obj.app
  });

  const probeList = ['PIXI', 'cc', 'CocosEngine', '_CCSettings', 'Phaser', 'Laya', 'laya', 'egret', 'pc', 'THREE', 'LUNA', 'LUNA_PLAYGROUND_BUND', 'LUNA_PLAYGROUND_BUNDLE', '__PIXI_APP__', '__PIXI_DEVTOOLS__', 'cr', 'c3_runtime', 'cr_getC2Runtime', 'cr_createRuntime', 'mbridge', 'MBridge', 'MBSDK', 'mintegral'];
  probeList.forEach(g => {
    if (window[g]) {
      globals[g] = snapshotGlobalObject(window[g]);
    }
  });

  try {
    const nestedPixi = window.app?.globals?.PIXI || window.app?.PIXI;
    if (!globals.PIXI && nestedPixi) {
      globals.PIXI = snapshotGlobalObject(nestedPixi);
    }
    if (!globals.__PIXI_APP__ && window.app?.globals?.pixiApp) {
      globals.__PIXI_APP__ = { exists: true };
    }
  } catch (e) {}

  const scriptLoadWarnings = [];
  const fetchedSources = (await Promise.allSettled(meta.externalScripts.slice(0, 16).map(async src => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), fetchTimeoutMs);
    try {
      const resp = await fetch(src, { signal: controller.signal });
      if (!resp.ok) return null;
      const text = await resp.text();
      return { src, text: text.substring(0, 140000) };
    } catch (e) {
      return null;
    } finally {
      clearTimeout(id);
    }
  })))
    .filter(item => item.status === 'fulfilled' && item.value)
    .map(item => item.value);

  return {
    scanId,
    tabId,
    isFrame: window.self !== window.top,
    frameUrl: window.location.href,
    meta,
    globals,
    fetchedSources,
    warnings: scriptLoadWarnings
  };
}

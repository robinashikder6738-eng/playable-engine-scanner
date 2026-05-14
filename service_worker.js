// Background service worker for Playable Engine Scanner v0.2.2
// Modular Design: rules/ engineRules.js, platformRules.js, businessRules.js

import { engineRules } from './rules/engineRules.js';
import { detectPlatforms } from './rules/platformRules.js';
import { getRecommendations } from './rules/businessRules.js';

const GLOBAL_SCAN_TIMEOUT = 8000;
const FRAME_SCAN_TIMEOUT = 1500;
const FETCH_SOURCE_TIMEOUT = 1200;

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
    const rawResults = await Promise.race([
      handleScan(tabId, scanId),
      new Promise((_, reject) => setTimeout(() => reject(new Error('SCAN_TIMEOUT')), GLOBAL_SCAN_TIMEOUT))
    ]);

    // Check if this scan is still active (not replaced)
    const latestStateData = await chrome.storage.local.get([key]);
    if (latestStateData[key]?.scanId !== scanId) return;

        // Process raw probe results with rules
    const analyzedResults = rawResults.map(raw => analyzeProbeResult(raw));
    const finalResult = aggregateScanResults(analyzedResults);

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
        renderLibScores.push({
          name: evalData.name,
          score: evalData.score,
          evidence: evalData.evidence,
          version: evalData.version || '未知',
          confidence: evalData.confidence
        });
      } else {
        engineScores.push({
          name: evalData.name,
          score: evalData.score,
          evidence: evalData.evidence,
          version: evalData.version || '未知',
          confidence: evalData.confidence
        });
      }
    }
  });

  if (engineScores.length > 0) {
    engineScores.sort((a, b) => b.score - a.score);
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
  
  let frames = [];
  try {
    if (chrome.webNavigation && chrome.webNavigation.getAllFrames) {
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

  // Probe Globals
  const globals = {};
  const probeList = ['PIXI', 'cc', '_CCSettings', 'Phaser', 'Laya', 'laya', 'egret', 'pc', 'THREE', 'LUNA', 'LUNA_PLAYGROUND_BUND', 'luna', 'LUNA_PLAYGROUND_BUNDLE', '__PIXI_APP__', '__PIXI_DEVTOOLS__', 'cr', 'c3_runtime', 'cr_getC2Runtime', 'cr_createRuntime', 'mbridge', 'MBridge', 'MBSDK', 'mintegral'];
  probeList.forEach(g => {
    if (window[g]) {
      const obj = window[g];
      globals[g] = {
        exists: true,
        VERSION: obj.VERSION,
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
      };
    }
  });

  const fetchedSources = [];
  const scriptLoadWarnings = [];
  
  for (const src of meta.externalScripts) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), fetchTimeoutMs);
      const resp = await fetch(src, { signal: controller.signal });
      clearTimeout(id);
      if (resp.ok) {
        const text = await resp.text();
        fetchedSources.push({ src, text: text.substring(0, 100000) });
      }
    } catch (e) {}
  }

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



/**
 * Platform detection rules for Playable Ads
 */

export function detectPlatforms(meta, globals = {}, fetchedSources = []) {
  const platformsDetected = [];
  const confirmedPlatformEvidence = [];
  const suspiciousPlatformEvidence = [];
  const ignoredPlatformEvidence = [];

  const urlLower = (meta.url || '').toLowerCase();
  const visibleTextCombined = (meta.visibleText || []).join(' ').toLowerCase();
  const sourceTexts = [...meta.inlineScripts, ...fetchedSources.map(s => s.text)].join('\n').toLowerCase();
  
  let adPlatform = 'Unknown';
  let platformSuspicion = '';

  const checkUrl = (keys) => {
    let evidence = [];
    keys.forEach(k => {
      if (urlLower.includes(k)) evidence.push(`URL 明确包含: ${k}`);
      if (meta.externalScripts.some(s => s.toLowerCase().includes(k))) evidence.push(`外链 JS 包含: ${k}`);
      if (meta.resources.some(r => r.toLowerCase().includes(k))) evidence.push(`资源路径包含: ${k}`);
    });
    return evidence;
  };

  // MTG
  const mtgConfirmedUrl = checkUrl(['mintegral', 'mobvista', 'mbridge', 'playable.mintegral']);
  let mtgConfirmed = [...mtgConfirmedUrl];
  
  ['mbridge', 'MBridge', 'MBSDK', 'mintegral'].forEach(g => {
    if (globals[g]) mtgConfirmed.push(`全局对象存在: ${g}`);
  });
  
  ['mintegral', 'mobvista', 'mbridge'].forEach(k => {
    if (visibleTextCombined.includes(k)) mtgConfirmed.push(`可见 DOM 文本包含: ${k}`);
  });

  // Medium: Fetched Source context
  let mtgMedium = [];
  const fetchedCount = fetchedSources.filter(src => {
    const text = src.text.toLowerCase();
    let hitCount = 0;
    ['mbridge', 'mobvista', 'mintegral', 'mtg_playable', 'playable.mintegral'].forEach(k => {
      if (text.includes(k)) hitCount++;
    });
    return hitCount > 1;
  });
  if (fetchedCount.length > 0) {
    mtgMedium.push(`源码中检测到多个 MTG 相关特征 (${fetchedCount.length} 个文件)`);
  }
  
  fetchedSources.forEach(src => {
    if (src.text.toLowerCase().includes('mbridge') && /(ad|playable|sdk|bridge|openURL|close|reward)/i.test(src.text)) {
      mtgMedium.push('mbridge 上下文包含广告运行时调用特征');
    }
  });

  const mtgWeakKeys = ['mintegral', 'mobvista', 'mbridge'];
  let mtgSuspicious = [];
  mtgWeakKeys.forEach(k => {
    if (sourceTexts.includes(k)) mtgSuspicious.push(`源码中存在弱关键词: ${k}`);
  });

  if (mtgConfirmed.length > 0) {
    confirmedPlatformEvidence.push(...mtgConfirmed);
    platformsDetected.push('Mintegral / MTG');
  } else if (mtgMedium.length >= 2) {
    confirmedPlatformEvidence.push(...mtgMedium);
    platformsDetected.push('Mintegral / MTG');
  } else if (mtgSuspicious.length > 0) {
    suspiciousPlatformEvidence.push(...mtgSuspicious);
    platformSuspicion = 'Mintegral / MTG 弱特征';
  }

  // AppLovin
  const alConfirmed = checkUrl(['applovin.com', 'res1.applovin.com', 'applovin']);
  if (alConfirmed.length > 0) {
    confirmedPlatformEvidence.push(...alConfirmed);
    platformsDetected.push('AppLovin');
  } else if (sourceTexts.includes('applovin')) {
    suspiciousPlatformEvidence.push('源码中存在弱关键词: applovin');
  }

  // ironSource
  const irConfirmed = checkUrl(['ironsource', 'supersonicads', 'playable.ironsrc']);
  if (irConfirmed.length > 0) {
    confirmedPlatformEvidence.push(...irConfirmed);
    platformsDetected.push('ironSource');
  } else if (sourceTexts.includes('ironsource')) {
    suspiciousPlatformEvidence.push('源码中存在弱关键词: ironsource');
  }

  // Vungle / Liftoff
  const vungleConfirmed = checkUrl(['vungle.com', 'liftoff', 'vungle_mraid']);
  if (vungleConfirmed.length > 0) {
    confirmedPlatformEvidence.push(...vungleConfirmed);
    platformsDetected.push('Vungle / Liftoff');
  } else if (sourceTexts.includes('vungle') || sourceTexts.includes('liftoff')) {
    suspiciousPlatformEvidence.push('源码中存在弱关键词: vungle/liftoff');
  }

  // Facebook / Meta
  const fbConfirmed = checkUrl(['facebook.com', 'fbcdn', 'audience_network', 'fbplayable']);
  if (fbConfirmed.length > 0) {
    confirmedPlatformEvidence.push(...fbConfirmed);
    platformsDetected.push('Facebook / Meta');
  } else if (sourceTexts.includes('facebook') || sourceTexts.includes('audience_network')) {
    suspiciousPlatformEvidence.push('源码中存在弱关键词: facebook');
  }

  // TikTok / Pangle
  const tiktokConfirmed = checkUrl(['pangle', 'tiktok', 'bytedance', 'pangleglobal']);
  if (tiktokConfirmed.length > 0) {
    confirmedPlatformEvidence.push(...tiktokConfirmed);
    platformsDetected.push('TikTok / Pangle');
  } else if (sourceTexts.includes('pangle') || sourceTexts.includes('tiktok')) {
    suspiciousPlatformEvidence.push('源码中存在弱关键词: tiktok/pangle');
  }

  if (platformsDetected.length > 1) {
    adPlatform = '多平台特征';
  } else if (platformsDetected.length === 1) {
    adPlatform = platformsDetected[0];
  }

  return {
    adPlatform,
    platformSuspicion,
    confirmedPlatformEvidence,
    suspiciousPlatformEvidence,
    ignoredPlatformEvidence,
    platformsDetected
  };
}

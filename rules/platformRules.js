/**
 * Platform detection rules for Playable Ads
 */

export function detectPlatforms(meta) {
  const platformsDetected = [];
  const platformEvidence = [];
  const combinedStr = (meta.html + meta.externalScripts.join(' ') + meta.resources.join(' ')).toLowerCase();
  
  let adPlatform = 'Unknown';

  // MTG / Mintegral
  const mtgEvidence = [];
  const mtgKeys = ['mintegral', 'mbridge', 'mobvista', 'mtg-sdk', 'mtg_playable'];
  mtgKeys.forEach(k => {
    if (combinedStr.includes(k)) mtgEvidence.push(`探测到 MTG 特征: ${k}`);
  });
  if (/\bmtg\b/i.test(combinedStr)) mtgEvidence.push('探测到精确匹配的 "mtg" 标识');
  if (mtgEvidence.length > 0) {
    adPlatform = 'Mintegral / MTG';
    platformEvidence.push(...mtgEvidence);
    platformsDetected.push('Mintegral / MTG');
  }

  // AppLovin
  const alEvidence = [];
  ['applovin.com', 'res1.applovin.com', 'applovin', 'app-lovin'].forEach(k => {
    if (combinedStr.includes(k)) alEvidence.push(`探测到 AppLovin 特征: ${k}`);
  });
  if (alEvidence.length > 0) {
    if (adPlatform !== 'Unknown' && adPlatform !== 'AppLovin') adPlatform = '多平台特征';
    else adPlatform = 'AppLovin';
    platformEvidence.push(...alEvidence);
    if (!platformsDetected.includes('AppLovin')) platformsDetected.push('AppLovin');
  }

  // Unity Ads
  const unityAdsEvidence = [];
  ['unityads', 'unity3d.com', 'unity.com/ads'].forEach(k => {
    if (combinedStr.includes(k)) unityAdsEvidence.push(`探测到 Unity Ads 特征: ${k}`);
  });
  if (unityAdsEvidence.length > 0) {
    if (platformsDetected.length > 0 && !platformsDetected.includes('Unity Ads')) adPlatform = '多平台特征';
    else adPlatform = 'Unity Ads';
    platformEvidence.push(...unityAdsEvidence);
    platformsDetected.push('Unity Ads');
  }

  // ironSource
  const irEvidence = [];
  ['ironsource', 'supersonicads'].forEach(k => {
    if (combinedStr.includes(k)) irEvidence.push(`探测到 ironSource 特征: ${k}`);
  });
  if (irEvidence.length > 0) {
    if (platformsDetected.length > 0 && !platformsDetected.includes('ironSource')) adPlatform = '多平台特征';
    else adPlatform = 'ironSource';
    platformEvidence.push(...irEvidence);
    platformsDetected.push('ironSource');
  }

  // Vungle / Liftoff
  const vungleEvidence = [];
  ['vungle', 'liftoff'].forEach(k => {
    if (combinedStr.includes(k)) vungleEvidence.push(`探测到 Vungle/Liftoff 特征: ${k}`);
  });
  if (vungleEvidence.length > 0) {
    if (platformsDetected.length > 0 && !platformsDetected.includes('Vungle / Liftoff')) adPlatform = '多平台特征';
    else adPlatform = 'Vungle / Liftoff';
    platformEvidence.push(...vungleEvidence);
    platformsDetected.push('Vungle / Liftoff');
  }

  return {
    adPlatform,
    platformEvidence,
    platformsDetected
  };
}

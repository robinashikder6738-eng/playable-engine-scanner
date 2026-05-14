/**
 * Business recommendation logic for Playable Ads
 */

export function getRecommendations(results) {
  let recommendation = '';
  let finalReviewStatus = '未识别，交技术复核';
  const warnings = [...(results.conflictWarnings || [])];

  const hasMtg = results.adPlatform.includes('MTG') || results.adPlatform.includes('Mintegral');
  const isMultiPlatform = results.adPlatform === '多平台特征';
  const isHighConfidence = results.confidence === '高';
  const isMediumConfidence = results.confidence === '中';
  const isLuna = results.engine.includes('Luna');
  const isUnknown = results.engine === '未知 / 高度混淆';

  if (results.platformSuspicion && results.platformSuspicion.includes('MTG')) {
    warnings.push('源码中出现 mintegral / mobvista 弱关键词，但未命中 MTG 强平台证据，暂不按 MTG 处理。');
  }

  if (hasMtg && isLuna) {
    finalReviewStatus = '规则冲突，交技术复核';
    recommendation = '规则冲突：Luna 试玩不能是 MTG 平台。当前结果需技术复核，不建议直接进入复刻。';
    if (!warnings.includes('Luna 引擎与 MTG 平台冲突。')) {
      warnings.push('Luna 引擎与 MTG 平台冲突。');
    }
  } else if (hasMtg) {
    finalReviewStatus = '暂不支持制作';
    recommendation = '命中 MTG / Mintegral 平台强特征，当前暂不支持制作；引擎识别结果仅作参考，建议技术复核。';
  } else if (isMultiPlatform) {
    finalReviewStatus = '建议人工复核';
    recommendation = '当前素材存在多个已确认广告平台特征，可能存在平台包装或转包，建议技术复核。';
  } else if (isHighConfidence && !hasMtg) {
    finalReviewStatus = '可进入复刻评估';
    if (isLuna) {
      recommendation = 'Luna 强特征命中明确，可进入复刻评估。';
    } else {
      recommendation = '制作引擎命中明确，可进入复刻评估。';
    }
  } else if (isMediumConfidence) {
    finalReviewStatus = '建议人工复核';
    recommendation = '命中部分引擎特征，建议按 F12 / VM 复核后进入复刻评估。';
  } else if (isUnknown) {
    finalReviewStatus = '未识别，交技术复核';
    recommendation = '未识别到明确制作引擎，建议按 F12 / VM 人工复核。';
  } else {
    finalReviewStatus = '建议人工复核';
    recommendation = '仅命中弱关键词，建议人工复核。';
  }

  // Preserve some specific warnings
  if (results.engine === 'PlayCanvas' && results.renderLibrary === 'Three.js') {
    if (!warnings.includes('PlayCanvas 引擎命中明确，同时检测到 Three.js 渲染库特征，建议技术复核依赖关系。')) {
      warnings.push('PlayCanvas 引擎命中明确，同时检测到 Three.js 渲染库特征，建议技术复核依赖关系。');
    }
  }

  return { recommendation, finalReviewStatus, warnings };
}

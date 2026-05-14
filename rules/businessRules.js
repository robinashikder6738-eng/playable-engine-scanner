/**
 * Business recommendation logic for Playable Ads
 */

export function getRecommendations(results) {
  let recommendation = '';
  const warnings = [...(results.conflictWarnings || [])];

  if (results.adPlatform.includes('MTG') || results.adPlatform.includes('Mintegral')) {
    if (results.engine.includes('Luna')) {
      recommendation = '规则冲突：Luna 试玩不能是 MTG 平台。当前结果需技术复核，不建议直接进入复刻。';
      if (!warnings.includes('Luna 引擎与 MTG 平台冲突。')) {
        warnings.push('Luna 引擎与 MTG 平台冲突。');
      }
    } else {
      recommendation = '命中 MTG / Mintegral 平台特征，当前暂不支持制作；引擎识别结果仅作参考，建议技术复核。';
    }
  } else if (results.engine === 'PlayCanvas' && results.renderLibrary === 'Three.js') {
    recommendation = 'PlayCanvas 引擎命中明确，同时检测到 Three.js 渲染库特征，建议技术复核依赖关系。';
  } else if (results.engine === '未知 / 高度混淆') {
    if (results.renderLibrary === 'Three.js') {
      recommendation = '检测到 Three.js 渲染库，但未识别到明确制作引擎，建议按 F12 / VM 人工复核。';
    } else {
      recommendation = '未识别到明确制作引擎，建议按 F12 / VM 人工复核。';
    }
  } else if (results.engine === '疑似 Construct') {
    recommendation = '仅命中 cr. 等弱关键词，建议按 F12 / VM 人工复核。';
  } else if (['Phaser', 'LayaAir', 'Egret', 'PixiJS', 'PlayCanvas', 'Construct 2', 'Construct 3', 'Construct'].includes(results.engine)) {
    if (results.confidence === '高') {
      if (results.engine === 'PixiJS') {
        recommendation = 'PixiJS 引擎命中明确，可进入复刻评估。';
      } else if (results.engine === 'PlayCanvas') {
        recommendation = 'PlayCanvas 引擎命中明确，可进入复刻评估。';
      } else if (results.engine.includes('Construct')) {
        recommendation = 'Construct 引擎命中明确，可进入复刻评估。';
      } else {
        recommendation = '引擎命中明确，可进入复刻评估。';
      }
    } else if (results.confidence === '中') {
      if (results.engine === 'PixiJS') {
        recommendation = '命中 PixiJS 中置信度，建议按 F12 / VM 复核版本号后进入复刻评估。';
      } else if (results.engine === 'PlayCanvas') {
        recommendation = '命中 PlayCanvas 部分特征，建议按 F12 / VM 复核后进入复刻评估。';
      } else if (results.engine.includes('Construct')) {
        recommendation = '命中 Construct 部分特征，建议按 F12 / VM 复核后进入复刻评估。';
      } else {
        recommendation = '命中部分引擎特征，建议按 F12 / VM 复核后进入复刻评估。';
      }
    } else {
      recommendation = '仅命中弱关键词，建议人工复核。';
    }
  } else if (results.confidence === '高') {
    recommendation = '引擎命中明确，可进入复刻评估。';
  } else if (warnings.length > 0) {
    recommendation = '当前素材存在多平台或多引擎特征，建议技术复核。';
  } else {
    recommendation = '仅命中弱关键词，建议人工复核。';
  }

  return { recommendation, warnings };
}

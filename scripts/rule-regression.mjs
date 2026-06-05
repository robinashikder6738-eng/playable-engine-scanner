import assert from 'node:assert/strict';
import fs from 'node:fs';

import { engineRules } from '../rules/engineRules.js';
import { detectPlatforms } from '../rules/platformRules.js';
import { getRecommendations } from '../rules/businessRules.js';

const UNKNOWN = '未知';
const HIGH = '高';

function createBaseMeta(overrides = {}) {
  return {
    url: 'https://example.com/playable',
    html: '',
    inlineScripts: [],
    externalScripts: [],
    links: [],
    resources: [],
    visibleText: [],
    canvasCount: 1,
    ...overrides
  };
}

function detectBestEngine(meta, globals = {}, fetchedSources = []) {
  const engineScores = [];

  for (const engineDef of engineRules) {
    const evalData = engineDef.evaluate(meta, globals, fetchedSources);
    if (!evalData || evalData.type === 'renderLibrary' || evalData.score <= 10) continue;
    engineScores.push({
      name: evalData.name,
      score: evalData.score,
      priority: engineDef.priority || 0,
      version: evalData.version || UNKNOWN,
      confidence: evalData.confidence,
      evidence: evalData.evidence
    });
  }

  engineScores.sort((a, b) => (b.score - a.score) || (b.priority - a.priority));
  return engineScores[0];
}

const cocosRule = engineRules.find((rule) => rule.name === 'Cocos Creator');
assert.ok(cocosRule, 'Cocos Creator rule should exist');
const lunaRule = engineRules.find((rule) => rule.name === 'Luna');
assert.ok(lunaRule, 'Luna rule should exist');

const designHandledCocosVersions = ['2.3.3', '2.3.4', '2.4.5', '2.4.9', '2.4.10', '2.4.12', '2.4.13'];

for (const version of designHandledCocosVersions) {
  const result = cocosRule.evaluate(
    createBaseMeta({
      html: `<script>window.cc={ENGINE_VERSION:'${version}',game:{},director:{}};</script>`,
      inlineScripts: [`cc.ENGINE_VERSION = '${version}'; Cocos Creator v${version}; cocos2d-js`],
      url: `https://example.com/cocos-creator-${version}`
    }),
    { cc: { ENGINE_VERSION: version, game: true, director: true }, _CCSettings: { exists: true } },
    []
  );

  assert.equal(result.name, 'Cocos Creator');
  assert.equal(result.version, version);
  assert.equal(result.confidence, HIGH);

  const recommendation = getRecommendations({
    adPlatform: 'AppLovin',
    engine: result.name,
    engineVersion: result.version,
    confidence: result.confidence,
    conflictWarnings: []
  });
  assert.equal(recommendation.finalReviewStatus, '可交设计手动处理');
}

const programHandledCocos = cocosRule.evaluate(
  createBaseMeta({
    inlineScripts: ['var y=t("VERSION","3.8.3");g.CocosEngine=v.ENGINE_VERSION=y,g.cc=v;'],
    url: 'https://example.com/cocos-creator-3.8.3'
  }),
  { CocosEngine: { ENGINE_VERSION: '3.8.3' }, cc: { ENGINE_VERSION: '3.8.3', game: true, director: true } },
  []
);
assert.equal(programHandledCocos.name, 'Cocos Creator');
assert.equal(programHandledCocos.version, '3.8.3');
assert.equal(programHandledCocos.confidence, HIGH);

const programRecommendation = getRecommendations({
  adPlatform: 'AppLovin',
  engine: programHandledCocos.name,
  engineVersion: programHandledCocos.version,
  confidence: programHandledCocos.confidence,
  conflictWarnings: []
});
assert.equal(programRecommendation.finalReviewStatus, '需程序人工处理');

const unrelatedVersion = cocosRule.evaluate(
  createBaseMeta({ inlineScripts: ['some unrelated text version 2.4.13'] }),
  {},
  []
);
assert.equal(unrelatedVersion.version, UNKNOWN);
assert.equal(unrelatedVersion.score, 10);

const lunaCompatibilityOnly = lunaRule.evaluate(
  createBaseMeta({
    inlineScripts: [
      'if ("Luna" in window) { var e = window.lunaParams; if (e && Luna.Unity && Luna.Unity.Playground) {} }'
    ]
  }),
  {},
  []
);
assert.ok(!lunaCompatibilityOnly.score || lunaCompatibilityOnly.score <= 10, 'Luna compatibility code should not identify Luna engine');

const phaserWithPixiDependency = detectBestEngine(
  createBaseMeta({
    inlineScripts: [
      '/* Phaser v2.6.2 - http://phaser.io */',
      'console.log("Phaser v2.6.2 | Pixi.js " + PIXI.VERSION);',
      'Phaser.Game; PIXI.VERSION = "v2.2.9"; pixi.js'
    ],
    externalScripts: ['https://res1.applovin.com/phaser2.js']
  }),
  {
    Phaser: { VERSION: '2.6.2', Game: true },
    PIXI: { VERSION: 'v2.2.9', Application: true, Renderer: true, Ticker: true }
  },
  []
);
assert.equal(phaserWithPixiDependency.name, 'Phaser');
assert.equal(phaserWithPixiDependency.version, '2.6.2');
assert.equal(phaserWithPixiDependency.confidence, HIGH);

const pixiRule = engineRules.find((rule) => rule.name === 'PixiJS');
assert.ok(pixiRule, 'PixiJS rule should exist');

const pixiWebpackResult = pixiRule.evaluate(
  createBaseMeta({
    inlineScripts: [
      'Object.defineProperty(Ee,l,{get:function(){return deprecation("6.0.0","PIXI.resources."+l+" has moved to PIXI."+l),ie[l]}});for(var Se in ie)_loop_2(Se);var Ae="6.5.10"}; pixi.js @pixi/core'
    ],
    externalScripts: ['https://res1.applovin.com/pixi-webpack.html']
  }),
  {},
  []
);
assert.equal(pixiWebpackResult.name, 'PixiJS');
assert.equal(pixiWebpackResult.version, '6.5.10');
assert.equal(pixiWebpackResult.confidence, HIGH);

const pixiV8RuntimeResult = pixiRule.evaluate(
  createBaseMeta({
    inlineScripts: [
      'app.globals.PIXI || window.PIXI || app.PIXI; new PIXI.UniformGroup(); app.globals.pixiApp.stage.addChild(sprite);'
    ]
  }),
  { PIXI: { VERSION: '8.14.0', Application: true, Renderer: true, Ticker: true } },
  []
);
assert.equal(pixiV8RuntimeResult.name, 'PixiJS');
assert.equal(pixiV8RuntimeResult.version, '8.14.0');
assert.equal(pixiV8RuntimeResult.confidence, HIGH);

const pixiV7DeprecationNoiseResult = pixiRule.evaluate(
  createBaseMeta({
    inlineScripts: [
      'utils.deprecation("7.2.0","Assets.add now uses an object instead of individual parameters");',
      't.VERSION="7.3.2";',
      'console.log(`PixiJS 7.3.2 - WebGL 2 - https://pixijs.com`);',
      '@pixi/core'
    ]
  }),
  {},
  []
);
assert.equal(pixiV7DeprecationNoiseResult.name, 'PixiJS');
assert.equal(pixiV7DeprecationNoiseResult.version, '7.3.2');
assert.equal(pixiV7DeprecationNoiseResult.confidence, HIGH);

const unityPlatform = detectPlatforms(
  createBaseMeta({ url: 'https://unityads.unity3d.com/playable/index.html' }),
  {},
  []
);
assert.equal(unityPlatform.adPlatform, 'Unity Ads');

const admobPlatform = detectPlatforms(
  createBaseMeta({ resources: ['https://googleads.g.doubleclick.net/pagead/ads?client=ca-app-pub-demo'] }),
  {},
  []
);
assert.equal(admobPlatform.adPlatform, 'Google / AdMob');

const samples = JSON.parse(fs.readFileSync(new URL('../samples.json', import.meta.url), 'utf8'));
const sampleIds = samples.map((sample) => sample.id);
assert.equal(new Set(sampleIds).size, sampleIds.length, 'sample ids should be unique');

for (const version of designHandledCocosVersions) {
  assert.ok(
    samples.some((sample) => sample.expectedEngine === 'Cocos Creator' && sample.expectedEngineVersion === version),
    `samples.json should include Cocos Creator ${version}`
  );
}

assert.ok(
  samples.some((sample) => sample.expectedEngine === 'Cocos Creator' && sample.expectedEngineVersion === '3.8.3' && sample.expectedFinalReviewStatus === '需程序人工处理'),
  'samples.json should include program-handled Cocos Creator 3.8.3'
);

console.log(`Rule regression passed: ${designHandledCocosVersions.length} design-handled Cocos versions, Cocos 3.8.3 program routing, Phaser 2 Pixi dependency, PixiJS webpack/runtime versions, Luna compatibility filtering, Unity Ads, Google / AdMob, sample integrity.`);

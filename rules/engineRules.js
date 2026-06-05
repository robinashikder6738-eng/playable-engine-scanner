/**
 * Engine recognition rules for Playable Ads
 */

export const engineRules = [
  {
    name: 'Luna',
    priority: 100,
    globals: ['LUNA', 'LUNA_PLAYGROUND_BUND', 'LUNA_PLAYGROUND_BUNDLE'],
    evaluate: (meta, globals, fetchedSources) => {
      let score = 0;
      const evidence = [];
      const combined = (meta.html + meta.inlineScripts.join('\n') + fetchedSources.map(s => s.text).join('\n'));
      let hasStrong = false;

      // Global checks
      if (globals.LUNA || globals.LUNA_PLAYGROUND_BUND || globals.LUNA_PLAYGROUND_BUNDLE) {
        hasStrong = true;
        evidence.push('window.LUNA / LUNA_PLAYGROUND');
      }

      // Source checks
      if (/\bwindow\.LUNA\b|\bwindow\.LUNA_PLAYGROUND(?:_BUND|_BUNDLE)?\b|\bLUNA_PLAYGROUND(?:_BUND|_BUNDLE)?\b/.test(meta.html + meta.inlineScripts.join(''))) {
        hasStrong = true;
        evidence.push('源码中检测到 Luna 关键字');
      }
      
      const logs = [
        'Project Settings loaded successfully', 
        'Bundle chain loaded successfully', 
        'Simple assets loaded successfully', 
        'Complex assets loaded successfully', 
        'Prefabs loaded successfully', 
        'Scenes loaded successfully'
      ];
      const foundLogs = logs.filter(log => combined.includes(log));
      if (foundLogs.length > 0) {
        hasStrong = true;
        evidence.push(`检测到 Luna 典型加载日志 (${foundLogs.length})`);
      }

      if (hasStrong) {
        score = 100;
        return { score, evidence, name: 'Luna', confidence: '高' };
      }

      return { score, evidence, name: '疑似 Luna' };
    }
  },
  {
    name: 'PixiJS',
    priority: 40,
    globals: ['PIXI', '__PIXI_APP__', '__PIXI_DEVTOOLS__'],
    evaluate: (meta, globals, fetchedSources) => {
      let score = 0;
      const evidence = [];
      let version = '未知';
      const combinedAll = (meta.html + meta.inlineScripts.join('\n') + meta.externalScripts.join('\n') + fetchedSources.map(s => s.text).join('\n'));
      const pixiMemberHits = (combinedAll.match(/\bPIXI\.[A-Za-z_$][\w$]*/g) || []).length;
      const embeddedInPhaser = !!globals.Phaser || /Phaser\s+v?[0-9]+\.[0-9]+\.[0-9]+|Phaser\.Game|Phaser\.CANVAS|Phaser\.WEBGL|phaser(?:\.min)?\.js/i.test(combinedAll);

      // 1. High Confidence Features
      const highFeatures = [
        { test: () => globals.PIXI, label: 'PIXI 运行时对象' },
        { test: () => globals.PIXI?.VERSION, label: 'PIXI.VERSION' },
        { test: () => globals.__PIXI_APP__, label: '__PIXI_APP__' },
        { test: () => globals.__PIXI_DEVTOOLS__, label: '__PIXI_DEVTOOLS__' },
        { test: () => globals.PIXI?.Application || combinedAll.includes('PIXI.Application'), label: 'PIXI.Application' },
        { test: () => globals.PIXI?.Renderer || combinedAll.includes('PIXI.Renderer'), label: 'PIXI.Renderer' },
        { test: () => globals.PIXI?.Ticker || combinedAll.includes('PIXI.Ticker'), label: 'PIXI.Ticker' },
        { test: () => pixiMemberHits >= 3, label: `多个 PIXI 核心调用 (${pixiMemberHits})` }
      ];

      // Version extraction
      if (globals.PIXI?.VERSION) version = globals.PIXI.VERSION;
      
      let versionMatch = combinedAll.match(/PixiJS\s+([0-9]+\.[0-9]+\.[0-9]+)/i) || 
                         combinedAll.match(/PIXI\.VERSION\s*=\s*["']([^"']+)["']/i) ||
                         combinedAll.match(/@pixi\/[^"']+["']?\s*[:@]\s*([0-9]+\.[0-9]+\.[0-9]+)/i) ||
                         combinedAll.match(/PIXI\.(?:resources|systems)[\s\S]{0,800}?\bvar\s+\w+\s*=\s*["']([0-9]+\.[0-9]+\.[0-9]+)["']/i);

      if (!versionMatch) {
         const contextMatch = combinedAll.match(/(?:pixi|PIXI).{0,100}version\s*:\s*["']([0-9]+\.[0-9]+\.[0-9]+)["']/i);
         if (contextMatch) versionMatch = contextMatch;
      }

      if (versionMatch && version === '未知') {
        version = versionMatch[1];
        score += 100;
        evidence.push(`获取到 PixiJS 版本提取: ${version}`);
      }

      let highHits = 0;
      highFeatures.forEach(f => {
        if (f.test()) {
          highHits++;
          evidence.push(`强特征: ${f.label}`);
          if (f.label === 'PIXI.VERSION' && globals.PIXI.VERSION) {
            version = globals.PIXI.VERSION;
          }
        }
      });

      // 2. Medium Confidence Features
      const mediumKeys = ['pixi.js', 'pixi.min.js', '@pixi', 'pixi-legacy', 'pixi-spine', 'pixi-particles'];
      let mediumHits = 0;
      mediumKeys.forEach(k => {
        if (combinedAll.toLowerCase().includes(k)) {
          mediumHits++;
          evidence.push(`中特征: ${k}`);
        }
      });

      // 3. Low Confidence Features
      const lowKeys = ['pixi', 'PixiJS'];
      let lowHits = 0;
      lowKeys.forEach(k => {
        if (combinedAll.includes(k)) {
          lowHits++;
          // Only add to evidence if no higher features found
          if (highHits === 0 && mediumHits === 0) evidence.push(`弱特征: ${k}`);
        }
      });

      let confidence = '低';
      let name = '疑似 PixiJS';
      let finalScore = 0;

      if (highHits > 0 || version !== '未知') {
        confidence = '高';
        name = 'PixiJS';
        finalScore = 100;
      } else if (mediumHits > 0) {
        confidence = '中';
        name = 'PixiJS';
        finalScore = 50;
      } else if (lowHits > 0) {
        confidence = '低';
        name = '疑似 PixiJS';
        finalScore = 20;
      }

      if (embeddedInPhaser && finalScore > 0) {
        evidence.push('检测到 Phaser 上下文，PixiJS 更可能是 Phaser 2 底层渲染依赖');
        confidence = '中';
        finalScore = Math.min(finalScore, 40);
      }

      return { score: finalScore, evidence, name, version, confidence };
    }
  },
  {
    name: 'Cocos Creator',
    priority: 90,
    globals: ['cc', 'CocosEngine', '_CCSettings'],
    evaluate: (meta, globals, fetchedSources) => {
      const combinedAll = (meta.html + meta.inlineScripts.join('\n') + meta.externalScripts.join('\n') + fetchedSources.map(s => s.text).join('\n'));
      const combinedLower = combinedAll.toLowerCase();
      const evidence = [];
      let version = '未知';

      const findVersion = (...candidates) => {
        for (const candidate of candidates) {
          if (typeof candidate !== 'string') continue;
          const match = candidate.trim().match(/\b([0-9]+\.[0-9]+\.[0-9]+)\b/);
          if (match) return match[1];
        }
        return '未知';
      };

      const versionPatterns = [
        /cc\.ENGINE_VERSION\s*=\s*["']([^"']+)["']/i,
        /CocosEngine\.ENGINE_VERSION\s*=\s*["']([^"']+)["']/i,
        /ENGINE_VERSION\s*[:=]\s*["']([^"']+)["']/i,
        /["']VERSION["']\s*,\s*["']([0-9]+\.[0-9]+\.[0-9]+)["'][\s\S]{0,160}?ENGINE_VERSION/i,
        /VERSION[^"']{0,80}["']([0-9]+\.[0-9]+\.[0-9]+)["'][\s\S]{0,160}?ENGINE_VERSION/i,
        /Cocos\s+Creator\s+v?([0-9]+\.[0-9]+\.[0-9]+)/i,
        /cocos2d-js[^\n"'<>]{0,120}?([0-9]+\.[0-9]+\.[0-9]+)/i,
        /"cocos-creator"\s*:\s*["']([0-9]+\.[0-9]+\.[0-9]+)["']/i,
        /"cocos"\s*:\s*["']([0-9]+\.[0-9]+\.[0-9]+)["']/i
      ];

      version = findVersion(
        globals.cc?.ENGINE_VERSION,
        globals.cc?.VERSION,
        globals.cc?.version,
        globals.CocosEngine?.ENGINE_VERSION,
        globals.CocosEngine?.VERSION,
        globals.CocosEngine?.version
      );

      if (version === '未知') {
        for (const pattern of versionPatterns) {
          const match = combinedAll.match(pattern);
          version = findVersion(match?.[1]);
          if (version !== '未知') break;
        }
      }
      
      const features = {
        cc: !!globals.cc,
        cocos: combinedLower.includes('cocos'),
        game: !!(globals.cc && globals.cc.game),
        director: !!(globals.cc && globals.cc.director),
        cocosEngine: !!globals.CocosEngine,
        settings: !!globals._CCSettings,
        cocos2djs: combinedLower.includes('cocos2d-js'),
        engineVersion: version !== '未知'
      };

      // Strong features count
      const strongFeaturesArr = [features.game, features.director, features.cocosEngine, features.settings, features.cocos2djs, features.engineVersion];
      const strongHits = strongFeaturesArr.filter(Boolean).length;

      let confidence = '低';
      let name = '疑似 Cocos';
      let score = 10;

      if (strongHits >= 3) {
        confidence = '高';
        name = 'Cocos Creator';
        score = 100;
      } else if (strongHits >= 2) {
        confidence = '中';
        name = 'Cocos Creator';
        score = 60;
      } else if (features.cc || features.cocos) {
        confidence = '低';
        name = '疑似 Cocos';
        score = 20;
      }

      if (features.cc) evidence.push('window.cc');
      if (features.game) evidence.push('cc.game');
      if (features.director) evidence.push('cc.director');
      if (features.cocosEngine) evidence.push('window.CocosEngine');
      if (features.settings) evidence.push('_CCSettings');
      if (features.cocos2djs) evidence.push('cocos2d-js');
      if (features.engineVersion) evidence.push(`获取到 Cocos Creator 版本: ${version}`);

      return { score, evidence, name, version, confidence };
    }
  },
  {
    name: 'Phaser',
    priority: 90,
    globals: ['Phaser'],
    evaluate: (meta, globals, fetchedSources) => {
      let version = '未知';
      const combinedAll = (meta.html + meta.inlineScripts.join('\n') + meta.externalScripts.join('\n') + fetchedSources.map(s => s.text).join('\n'));
      const evidence = [];

      let versionMatch = combinedAll.match(/Phaser\.VERSION\s*=\s*["']([^"']+)["']/i) || 
                         combinedAll.match(/Phaser\s+v?([0-9]+\.[0-9]+\.[0-9]+)/i) ||
                         combinedAll.match(/phaser(?:\.min)?\.js[^\n]*?([0-9]+\.[0-9]+\.[0-9]+)/i) ||
                         combinedAll.match(/"phaser"\s*:\s*["']([0-9]+\.[0-9]+\.[0-9]+)["']/i);

      if (globals.Phaser && globals.Phaser.VERSION) version = globals.Phaser.VERSION;
      else if (versionMatch) version = versionMatch[1];

      const features = {
        Phaser: !!globals.Phaser,
        VERSION: !!globals.Phaser?.VERSION,
        Game: !!(globals.Phaser && globals.Phaser.Game) || combinedAll.includes('Phaser.Game'),
        Scene: !!(globals.Phaser && globals.Phaser.Scene) || combinedAll.includes('Phaser.Scene'),
        AUTO: !!(globals.Phaser && globals.Phaser.AUTO) || combinedAll.includes('Phaser.AUTO'),
        CANVAS: !!(globals.Phaser && globals.Phaser.CANVAS) || combinedAll.includes('Phaser.CANVAS'),
        WEBGL: !!(globals.Phaser && globals.Phaser.WEBGL) || combinedAll.includes('Phaser.WEBGL')
      };

      const strongHits = [features.Game, features.Scene, features.AUTO, features.CANVAS, features.WEBGL].filter(Boolean).length;
      
      let confidence = '低';
      let name = '疑似 Phaser';
      let score = 10;

      const hasMedium = /phaser\.js|phaser\.min\.js|phaser3|Phaser CE|Phaser 3/i.test(combinedAll);

      if (features.Phaser || features.VERSION || strongHits >= 2 || (version !== '未知' && versionMatch)) {
        confidence = '高';
        name = 'Phaser';
        score = 100;
        if (features.Phaser) evidence.push('window.Phaser');
        if (features.VERSION) evidence.push('Phaser.VERSION');
        if (strongHits >= 2) evidence.push('命中多个 Phaser 核心类/常量');
      } else if (hasMedium) {
        confidence = '中';
        name = 'Phaser';
        score = 60;
        evidence.push('中置信度关键脚本/标识');
      } else if (/phaser/i.test(combinedAll)) {
        confidence = '低';
        name = '疑似 Phaser';
        score = 20;
        evidence.push('普通 phaser 字符串');
      }

      if (version !== '未知') evidence.push(`获取到版本: ${version}`);

      return { score, evidence, name, version, confidence };
    }
  },
  {
    name: 'LayaAir',
    priority: 85,
    globals: ['Laya', 'laya'],
    evaluate: (meta, globals, fetchedSources) => {
      let version = '未知';
      const combinedAll = (meta.html + meta.inlineScripts.join('\n') + meta.externalScripts.join('\n') + fetchedSources.map(s => s.text).join('\n'));
      const evidence = [];

      let versionMatch = combinedAll.match(/Laya\.version\s*=\s*["']([^"']+)["']/i) || 
                         combinedAll.match(/LayaAir\s+v?([0-9]+\.[0-9]+\.[0-9]+)/i) ||
                         combinedAll.match(/laya(?:\.core|\.webgl|\.ui|\.ani)?\.js[^\n]*?([0-9]+\.[0-9]+\.[0-9]+)/i);

      if (globals.Laya && globals.Laya.version) version = globals.Laya.version;
      else if (globals.laya && globals.laya.version) version = globals.laya.version;
      else if (versionMatch) version = versionMatch[1];

      const layaObj = globals.Laya || globals.laya;
      const features = {
        Laya: !!layaObj,
        stage: !!(layaObj && layaObj.stage) || combinedAll.includes('Laya.stage'),
        init: !!(layaObj && layaObj.init) || combinedAll.includes('Laya.init'),
        loader: !!(layaObj && layaObj.loader) || combinedAll.includes('Laya.loader'),
        LayaAir: combinedAll.includes('LayaAir'),
        versionObj: !!(layaObj && layaObj.version) || combinedAll.includes('Laya.version'),
        Browser: !!(layaObj && layaObj.Browser) || combinedAll.includes('Laya.Browser'),
        Sprite: !!(layaObj && layaObj.Sprite) || combinedAll.includes('Laya.Sprite'),
        Scene: !!(layaObj && layaObj.Scene) || combinedAll.includes('Laya.Scene')
      };

      const highHits = [features.Laya, features.stage, features.init, features.loader, features.LayaAir, features.versionObj, features.Browser, features.Sprite, features.Scene].filter(Boolean).length;
      
      let confidence = '低';
      let name = '疑似 LayaAir';
      let score = 10;

      const hasMedium = /laya\.js|laya\.core\.js|laya\.webgl\.js|laya\.ani\.js|laya\.ui\.js|LayaAir Engine/i.test(combinedAll);

      if (features.Laya || features.stage || features.init || highHits >= 2 || (features.LayaAir && hasMedium)) {
        confidence = '高';
        name = 'LayaAir';
        score = 100;
        if (features.Laya) evidence.push('window.Laya / laya');
        if (features.stage) evidence.push('Laya.stage');
        if (features.init) evidence.push('Laya.init');
        if (features.LayaAir) evidence.push('LayaAir标识');
        if (highHits >= 2 && !features.Laya && !features.stage && !features.init && !features.LayaAir) evidence.push('命中多个 Laya 核心类');
      } else if (hasMedium) {
        confidence = '中';
        name = 'LayaAir';
        score = 60;
        evidence.push('中置信度关键脚本/标识');
      } else if (/laya/i.test(combinedAll)) {
        confidence = '低';
        name = '疑似 LayaAir';
        score = 20;
        evidence.push('普通 laya 字符串');
      }

      if (version !== '未知') evidence.push(`获取到版本: ${version}`);

      return { score, evidence, name, version, confidence };
    }
  },
  {
    name: 'Egret',
    priority: 85,
    globals: ['egret'],
    evaluate: (meta, globals, fetchedSources) => {
      let version = '未知';
      const combinedAll = (meta.html + meta.inlineScripts.join('\n') + meta.externalScripts.join('\n') + fetchedSources.map(s => s.text).join('\n'));
      const evidence = [];

      let versionMatch = combinedAll.match(/egret\.version\s*=\s*["']([^"']+)["']/i) || 
                         combinedAll.match(/Egret\s+Engine\s+v?([0-9]+\.[0-9]+\.[0-9]+)/i) ||
                         combinedAll.match(/egret(?:\.min|\.web)?\.js[^\n]*?([0-9]+\.[0-9]+\.[0-9]+)/i);

      if (versionMatch) version = versionMatch[1];

      const eObj = globals.egret;
      const features = {
        egret: !!eObj,
        runEgret: !!(eObj && eObj.runEgret) || combinedAll.includes('egret.runEgret'),
        MainContext: !!(eObj && eObj.MainContext) || combinedAll.includes('egret.MainContext'),
        DisplayObject: !!(eObj && eObj.DisplayObject) || combinedAll.includes('egret.DisplayObject'),
        Stage: !!(eObj && eObj.Stage) || combinedAll.includes('egret.Stage'),
        Capabilities: !!(eObj && eObj.Capabilities) || combinedAll.includes('egret.Capabilities'),
        lifecycle: !!(eObj && eObj.lifecycle) || combinedAll.includes('egret.lifecycle')
      };

      const strongHits = [features.egret, features.runEgret, features.MainContext, features.DisplayObject, features.Stage, features.Capabilities, features.lifecycle].filter(Boolean).length;
      
      let confidence = '低';
      let name = '疑似 Egret';
      let score = 10;

      const hasMedium = /egret\.js|egret\.min\.js|egret\.web\.js|egret engine|Egret Engine/i.test(combinedAll);

      if (features.egret || features.runEgret || strongHits >= 2) {
        confidence = '高';
        name = 'Egret';
        score = 100;
        if (features.egret) evidence.push('window.egret');
        if (features.runEgret) evidence.push('egret.runEgret');
        if (strongHits >= 2 && !features.egret && !features.runEgret) evidence.push('命中多个 Egret 核心类/函数');
      } else if (hasMedium) {
        confidence = '中';
        name = 'Egret';
        score = 60;
        evidence.push('中置信度关键脚本/标识');
      } else if (/egret/i.test(combinedAll)) {
        confidence = '低';
        name = '疑似 Egret';
        score = 20;
        evidence.push('普通 egret 字符串');
      }

      if (version !== '未知') evidence.push(`获取到版本: ${version}`);

      return { score, evidence, name, version, confidence };
    }
  },
  {
    name: 'Three.js',
    type: 'renderLibrary',
    globals: ['THREE'],
    evaluate: (meta, globals, fetchedSources) => {
      let version = '未知';
      const combinedAll = (meta.html + meta.inlineScripts.join('\n') + meta.externalScripts.join('\n') + fetchedSources.map(s => s.text).join('\n'));
      const evidence = [];

      let versionMatch = combinedAll.match(/THREE\.REVISION\s*=\s*["']?([0-9]+)["']?/i) || 
                         combinedAll.match(/three(?:\.module|\.min)?\.js[^\n]*?([0-9]+\.[0-9]+\.[0-9]+)/i) ||
                         combinedAll.match(/"three"\s*:\s*["']([0-9]+\.[0-9]+\.[0-9]+)["']/i);

      if (globals.THREE && globals.THREE.REVISION) version = globals.THREE.REVISION;
      else if (versionMatch) version = versionMatch[1];

      const tObj = globals.THREE;
      const features = {
        THREE: !!tObj,
        REVISION: !!(tObj && tObj.REVISION) || combinedAll.includes('THREE.REVISION'),
        WebGLRenderer: !!(tObj && tObj.WebGLRenderer) || combinedAll.includes('THREE.WebGLRenderer'),
        Scene: !!(tObj && tObj.Scene) || combinedAll.includes('THREE.Scene'),
        PerspectiveCamera: !!(tObj && tObj.PerspectiveCamera) || combinedAll.includes('THREE.PerspectiveCamera'),
        Mesh: !!(tObj && tObj.Mesh) || combinedAll.includes('THREE.Mesh'),
        TextureLoader: !!(tObj && tObj.TextureLoader) || combinedAll.includes('THREE.TextureLoader')
      };

      const hasMedium = /three\.js|three\.min\.js|three\.module\.js|@react-three|three\/examples/i.test(combinedAll);

      let confidence = '低';
      let name = '疑似 Three.js';
      let score = 10;

      if (features.THREE || features.REVISION) {
        confidence = '高';
        name = 'Three.js';
        score = 100;
        if (features.THREE) evidence.push('window.THREE');
        if (features.REVISION) evidence.push('THREE.REVISION');
      } else if (hasMedium) {
        confidence = '中';
        name = 'Three.js';
        score = 60;
        evidence.push('中置信度关键脚本/标识');
      } else if (/three/i.test(combinedAll)) {
        confidence = '低';
        name = '疑似 Three.js';
        score = 20;
        evidence.push('普通 three 字符串');
      }

      if (version !== '未知') evidence.push(`获取到版本或 revision: ${version}`);

      return { score, evidence, name, version, confidence, type: 'renderLibrary' };
    }
  },
  {
    name: 'PlayCanvas',
    priority: 85,
    globals: ['pc'],
    evaluate: (meta, globals, fetchedSources) => {
      let version = '未知';
      const combinedAll = (meta.html + meta.inlineScripts.join('\n') + meta.externalScripts.join('\n') + fetchedSources.map(s => s.text).join('\n'));
      const evidence = [];

      let versionMatch = combinedAll.match(/pc\.version\s*=\s*["']([^"']+)["']/i) || 
                         combinedAll.match(/PlayCanvas\s+v?([0-9]+\.[0-9]+\.[0-9]+)/i) ||
                         combinedAll.match(/playcanvas(?:\.min)?\.js[^\n]*?([0-9]+\.[0-9]+\.[0-9]+)/i);

      if (globals.pc && globals.pc.version) version = globals.pc.version;
      else if (versionMatch) version = versionMatch[1];

      const pObj = globals.pc;
      const features = {
        pc: !!pObj,
        Application: !!(pObj && pObj.Application) || combinedAll.includes('pc.Application'),
        Entity: !!(pObj && pObj.Entity) || combinedAll.includes('pc.Entity'),
        Scene: !!(pObj && pObj.Scene) || combinedAll.includes('pc.Scene'),
        AssetRegistry: !!(pObj && pObj.AssetRegistry) || combinedAll.includes('pc.AssetRegistry'),
        GraphicsDevice: !!(pObj && pObj.GraphicsDevice) || combinedAll.includes('pc.GraphicsDevice'),
        app: !!(pObj && pObj.app) || combinedAll.includes('pc.app'),
        stable: combinedAll.includes('playcanvas-stable'),
        engine: combinedAll.includes('playcanvas engine')
      };

      const strongHits = [features.Application, features.Entity, features.Scene, features.AssetRegistry, features.GraphicsDevice, features.app, features.stable, features.engine].filter(Boolean).length;
      
      let confidence = '低';
      let name = '疑似 PlayCanvas';
      let score = 10;

      const hasMedium = /playcanvas\.js|playcanvas\.min\.js|pc\.Application/i.test(combinedAll);

      if ((features.pc && features.Application) || strongHits >= 2) {
        confidence = '高';
        name = 'PlayCanvas';
        score = 100;
        if (features.pc) evidence.push('window.pc');
        if (strongHits >= 2) evidence.push('命中多个 PlayCanvas 核心类/函数');
      } else if (hasMedium) {
        confidence = '中';
        name = 'PlayCanvas';
        score = 60;
        evidence.push('中置信度关键脚本/标识');
      } else if (/playcanvas|pc/i.test(combinedAll)) {
        confidence = '低';
        name = '疑似 PlayCanvas';
        score = 20;
        evidence.push('普通 playcanvas/pc 字符串');
      }

      if (version !== '未知') evidence.push(`获取到版本: ${version}`);

      return { score, evidence, name, version, confidence };
    }
  },
  {
    name: 'Construct',
    priority: 85,
    globals: ['cr', 'c3_runtime', 'cr_getC2Runtime', 'cr_createRuntime'],
    evaluate: (meta, globals, fetchedSources) => {
      let version = '未知';
      const combinedAll = (meta.html + meta.inlineScripts.join('\n') + meta.externalScripts.join('\n') + fetchedSources.map(s => s.text).join('\n'));
      const evidence = [];

      let c2High = 0;
      let c3High = 0;
      let c2Med = 0;
      let c3Med = 0;
      let hasLowCr = false;
      let hasLowConstruct = false;

      // C3 High
      if (globals.c3_runtime || combinedAll.includes('c3_runtime')) { c3High++; evidence.push('c3_runtime'); }
      if (combinedAll.includes('C3Runtime')) { c3High++; evidence.push('C3Runtime'); }
      if (combinedAll.includes('scripts/c3runtime.js')) { c3High++; evidence.push('scripts/c3runtime.js'); }
      if (combinedAll.includes('workermain.js')) { c3High++; evidence.push('workermain.js'); }
      if (combinedAll.includes('dispatchworker.js')) { c3High++; evidence.push('dispatchworker.js'); }
      if (combinedAll.includes('c3worker')) { c3High++; evidence.push('c3worker'); }
      if (/construct\s*3\s*runtime/i.test(combinedAll)) { c3High++; evidence.push('construct 3 runtime'); }
      else if (/construct\s*3/i.test(combinedAll)) { c3High++; evidence.push('Construct 3'); }

      // C3 Med
      if (combinedAll.includes('c3runtime.js')) { c3Med++; evidence.push('c3runtime.js'); }
      if (combinedAll.includes('c3runtime')) { c3Med++; evidence.push('c3runtime'); }
      if (/construct\s*3|construct3/i.test(combinedAll)) { c3Med++; evidence.push('construct 3 / construct3'); }
      if (combinedAll.includes('runtime.js') && combinedAll.includes('construct')) { c3Med++; evidence.push('runtime.js + construct'); }

      // C2 High
      if (globals.cr_getC2Runtime || combinedAll.includes('cr_getC2Runtime')) { c2High++; evidence.push('cr_getC2Runtime'); }
      if (globals.cr_createRuntime || combinedAll.includes('cr_createRuntime')) { c2High++; evidence.push('cr_createRuntime'); }
      if (globals.cr) { c2High++; evidence.push('window.cr'); }
      if (combinedAll.includes('c2runtime.js')) { c2High++; evidence.push('c2runtime.js'); }
      if (/construct\s*2\s*runtime/i.test(combinedAll)) { c2High++; evidence.push('Construct 2 runtime'); }
      else if (/construct\s*2/i.test(combinedAll)) { c2High++; evidence.push('Construct 2'); }

      // C2 Med
      if (combinedAll.includes('c2runtime')) { c2Med++; evidence.push('c2runtime'); }
      if (/construct\s*2|construct2/i.test(combinedAll)) { c2Med++; evidence.push('construct 2 / construct2'); }
      if (combinedAll.includes('cr.plugins_')) { c2Med++; evidence.push('cr.plugins_'); }
      if (combinedAll.includes('cr.behaviors')) { c2Med++; evidence.push('cr.behaviors'); }

      // Low
      if (combinedAll.includes('cr.')) { hasLowCr = true; }
      if (combinedAll.toLowerCase().includes('construct')) { hasLowConstruct = true; }
      
      let confidence = '低';
      let name = '疑似 Construct';
      let score = 10;
      
      let versionMatch = null;
      
      if (c3High > 0 || c3Med > 0 || c2High > 0 || c2Med > 0) {
        if (c3High > 0 && c2High > 0) {
          name = 'Construct';
          confidence = '中';
          score = 80;
          evidence.push('同时命中 Construct 2 与 Construct 3 强特征');
        } else if (c3High > 0) {
          name = 'Construct 3';
          confidence = '高';
          score = 100;
        } else if (c2High > 0) {
          name = 'Construct 2';
          confidence = '高';
          score = 100;
        } else if (c3Med > 0 && c2Med > 0) {
          name = 'Construct';
          confidence = '中';
          score = 60;
        } else if (c3Med > 0) {
          name = 'Construct 3';
          confidence = '中';
          score = 60;
        } else if (c2Med > 0) {
          name = 'Construct 2';
          confidence = '中';
          score = 60;
        }
        
        if (name === 'Construct 3' || name === 'Construct') {
          versionMatch = combinedAll.match(/Construct\s*3\s*v?([0-9]+\.[0-9]+\.[0-9]+)/i) || 
                         combinedAll.match(/C3Runtime[^\n]{0,80}?([0-9]+\.[0-9]+\.[0-9]+)/i) ||
                         combinedAll.match(/c3runtime\.js[^\n]*?([0-9]+\.[0-9]+\.[0-9]+)/i);
          if (versionMatch) version = versionMatch[1];
        }
        if (name === 'Construct 2' || (name === 'Construct' && version === '未知')) {
          versionMatch = combinedAll.match(/Construct\s*2\s*v?([0-9]+\.[0-9]+\.[0-9]+)/i) || 
                         combinedAll.match(/c2runtime\.js[^\n]*?([0-9]+\.[0-9]+\.[0-9]+)/i) ||
                         combinedAll.match(/cr\.version\s*=\s*["']([^"']+)["']/i);
          if (versionMatch) version = versionMatch[1];
        }
      } else if (hasLowCr || hasLowConstruct) {
        if (hasLowCr) evidence.push('cr.');
        if (hasLowConstruct) evidence.push('construct 字符串');
        confidence = '低';
        name = '疑似 Construct';
        score = 20;
      }
      
      if (version !== '未知') evidence.push(`获取到版本: ${version}`);

      return { score, evidence, name, version, confidence };
    }
  }
];

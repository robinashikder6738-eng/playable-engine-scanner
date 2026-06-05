# 版本号识别支持清单

本文档记录当前扩展能够输出版本号的引擎、渲染库和版本来源。

## 制作引擎

| 类型 | 当前支持的版本号来源 | 版本范围 |
| --- | --- | --- |
| PixiJS | `PIXI.VERSION`、`app.globals.PIXI.VERSION`、`app.PIXI.VERSION`、`PixiJS x.y.z`、`PIXI.VERSION = "x.y.z"`、`@pixi/*` 包版本、上下文中的 `version: "x.y.z"`、Pixi v6 Webpack 打包片段中的 `PIXI.resources` / `PIXI.systems` 版本变量 | 任意 `x.y.z` 语义版本 |
| Cocos Creator | `cc.ENGINE_VERSION`、`window.CocosEngine.ENGINE_VERSION`、`cc.VERSION`、`cc.version`、`cc.ENGINE_VERSION = "x.y.z"`、`CocosEngine.ENGINE_VERSION = "x.y.z"`、`ENGINE_VERSION: "x.y.z"`、`VERSION","x.y.z"` 后跟 `ENGINE_VERSION` 的压缩引擎上下文、`Cocos Creator vx.y.z`、`cocos2d-js` 上下文、`"cocos-creator": "x.y.z"` | 任意 `x.y.z` 语义版本；其中 `2.3.3`、`2.3.4`、`2.4.5`、`2.4.9`、`2.4.10`、`2.4.12`、`2.4.13` 可交设计手动处理，其它版本需程序人工处理 |
| Phaser | `Phaser.VERSION`、`Phaser v/x.y.z`、`phaser.js` 文件名上下文、`"phaser": "x.y.z"` | 任意 `x.y.z` 语义版本 |
| LayaAir | `Laya.version`、`laya.version`、`LayaAir x.y.z`、`laya.*.js` 文件名上下文 | 任意 `x.y.z` 语义版本 |
| Egret | `egret.version`、`Egret Engine x.y.z`、`egret*.js` 文件名上下文 | 任意 `x.y.z` 语义版本 |
| PlayCanvas | `pc.version`、`PlayCanvas x.y.z`、`playcanvas.js` 文件名上下文 | 任意 `x.y.z` 语义版本 |
| Construct 2 | `Construct 2 x.y.z`、`c2runtime.js` 文件名上下文、`cr.version` | 任意 `x.y.z` 语义版本 |
| Construct 3 | `Construct 3 x.y.z`、`C3Runtime` 上下文、`c3runtime.js` 文件名上下文 | 任意 `x.y.z` 语义版本 |

## 渲染库

| 类型 | 当前支持的版本号来源 | 版本范围 |
| --- | --- | --- |
| Three.js | `THREE.REVISION`、`three*.js` 文件名上下文、`"three": "x.y.z"` | `THREE.REVISION` 数字 revision 或任意 `x.y.z` 语义版本 |

## 注意事项

- Cocos Creator 会尽量输出版本号，但业务分流只把 `2.3.3`、`2.3.4`、`2.4.5`、`2.4.9`、`2.4.10`、`2.4.12`、`2.4.13` 判为“可交设计手动处理”。
- Cocos Creator 其它版本会输出“需程序人工处理”。
- PixiJS 的 `Deprecated since vx.y.z` / `deprecation("x.y.z", ...)` 属于 API 废弃提示，不作为实际运行版本优先来源。
- 版本号只作为证据补充，单独出现普通版本号不会直接判定引擎。
- 当前 Luna 规则以强特征和加载日志为主，不输出明确版本号。

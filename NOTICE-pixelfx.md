# 第三方素材说明：pixelfx

本项目里「首页卡片上的像素小生物」和「排位的像素动效」用的都是开源项目 **pixelfx**
（https://github.com/patch-gg/pixelfx ，https://patch-gg.github.io/pixelfx/ ）。

## 许可

pixelfx 的代码和全部 244 个特效都是 **MIT License**，可以商用、可以修改、可以只取其中几个。
唯一的例外是 `gallery/fonts/PatchPixel-Regular.woff2` 这个字体（Patch 自有版权，不随 MIT 授权）——
**我们没有用这个字体**，取的都是纯代码特效，所以不受影响。

MIT 的义务只有一条：保留版权与许可声明。本项目用到的部分如下：

```
pixelfx — https://github.com/patch-gg/pixelfx — MIT License
Copyright (c) 2026 patch-gg

其中部分特效改编自 Sprite Fusion 的开源像素特效（https://www.spritefusion.com/pixel-art-vfx），
Copyright (c) 2026 Hugo Duprez，MIT License。
```

## 本项目实际用到的特效

| 位置 | 特效 id | 用途 |
|---|---|---|
| 首页 15 张工具卡片（2026-11-03 扩池） | `critters/` 下 12 只小生物 + `fx/` 等目录下 17 个循环特效，共 29 个<br>小生物：bat、bird、butterfly、eyeball、fish-school、flying-skull、frog、ghost、jellyfish、slime、snake、wisp<br>循环特效：campfire、spirit-flame、halo、sunburst、ice-crystal、plasma-ball、energy-core、hologram、glitch、coin-spin、gem-spin、power-star、potion、crystal-shard、bubbles、whirlpool、portal | 卡片上端随机配一个（按排位发牌；池子 ≥15 张卡张张不同，色相变体只是超池兜底，见 fx/hx-critters.js） |
| 排位 · 开场倒数（2026-11-03） | `ui/countdown` | 3-2-1 引线圆环 + GO!，替换文字倒数（准备页符文环同日已删） |
| 排位 · 接入题目转场（2026-11-03） | `transitions/` 下 pixel-dissolve、iris、star-iris、crt-off、slash-wipe | 随机一个全屏转场：盖满时收准备页、揭幕时起表（见 rank.js 的 RK_FX_IN） |
| 排位 · 完成横幅（2026-11-03） | `ui/quest-complete` | 成绩出来前、排名展示前，屏幕正中放大播一遍 |
| 排位 · 停表 | `lightning/zap-hit` | 全部接对自动停表时，一道电弧打进计时条 |
| 排位 · 破纪录 | `ui/confetti` | 名次牌上炸两把彩纸（和原来的烟花叠着放） |

## 产物与重新打包

两个产物都是 esbuild 打成的独立 IIFE，直接内联/引用，不依赖 npm、不联网：

- `总入口/fx/pixelfx-critters.js` — 12 只小生物 + 17 个循环特效 + 核心运行时，约 156 KB，暴露 `window.PixelFX`（2026-11-03 扩池：29 个，首页 15 张卡张张不同）
- `接线仿真/vendor/pixelfx-rank.js` — 14 个特效（`zap-hit`、`confetti`、`level-up`、`collect-burst`、`hit-spark`、`rune-circle`、`countdown`、`quest-complete`、`glitch-wipe`、`pixel-dissolve`、`iris`、`crt-off`、`slash-wipe`、`star-iris`），
  约 97 KB，暴露 `window.PixelFXRank`。实际调用 6 个，其余打包进去是为了以后换特效不用重新构建。

两者都是从 pixelfx 仓库的 `demo/critters-entry.js` / `demo/rank-entry.js` 这两个入口打的。
要改特效（换一只生物、换成别的特效）时，回到 pixelfx 仓库执行：

```bash
# 小生物
node -e "require('esbuild').build({entryPoints:['demo/critters-entry.js'],bundle:true,format:'iife',globalName:'PixelFX',minify:true,target:['es2018'],outfile:'dist/critters/pixelfx-critters.js',legalComments:'none'})"
# 排位
node -e "require('esbuild').build({entryPoints:['demo/rank-entry.js'],bundle:true,format:'iife',globalName:'PixelFXRank',minify:true,target:['es2018'],outfile:'dist/rank/pixelfx-rank.js',legalComments:'none'})"
```

然后把产物复制到上面对应的位置。接线仿真的打包（`build-practice.cjs`）会自动把它内联进成品 HTML。

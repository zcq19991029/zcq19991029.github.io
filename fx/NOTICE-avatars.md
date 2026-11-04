# 像素动效头像库 · 第三方许可与署名

本目录下的两个文件 `pixelfx-avatars.js`、`hx-avatar.js` 使用了开源项目 **pixelfx** 的特效代码。

## 来源

| 项目 | 内容 |
|---|---|
| 仓库 | https://github.com/patch-gg/pixelfx |
| 版本 | 0.3.0 |
| 取用 commit | `a84159688af3ca37a4be05a0d422b94451b2e24e`（2026-10-31，提交信息 `pixelfx 0.3.0: give the effects a body that performs them`） |
| 取用内容 | `src/core/*`（帧缓冲、画笔、粒子、模拟等引擎）与 `src/fx/<分类>/<名字>.js` 中的 208 个特效 |
| 作者 | Patch（https://patch.gg） |
| 协议 | MIT（可商用、可修改、可闭源分发，**但必须保留下面的版权声明与许可全文**） |

`pixelfx-avatars.js` 是构建产物：用 esbuild 把 core 与挑好的 208 个特效打成一个 IIFE。
打包时未收 `moves`（整段角色连招）、`projectiles`（弹道）、`impacts`（受击一闪）三个分类，
原因是它们当头像要么画布过大、要么主体闪一下就没了，详见 `pixelfx-avatars.js` 文件头注释。
特效源码本身没有做任何改写，只做了压缩（esbuild --minify）。

## 原作者的其他署名（pixelfx 的 NOTICE.md 要求一并保留）

- **Hugo Duprez**：`src/core/sim.js` 以及部分特效在文件头注明改编自 Sprite Fusion 的开源像素特效
  （https://www.spritefusion.com/pixel-art-vfx），Copyright (c) 2026 Hugo Duprez，MIT License。
- **Hollow Crown**：`src/core/act.js` 改编自 https://github.com/rehan-remade/hollow-crown
  的技能表演方式，Copyright (c) 2026 rehan-remade，MIT License。
- **Patch Pixel 字体**（`gallery/fonts/PatchPixel-Regular.woff2`）**不在 MIT 范围内、未使用、未分发**。
  本项目没有引入该字体，界面文字用系统字体。

## MIT License 全文

```
MIT License

Copyright (c) 2026 Patch
Copyright (c) 2026 Hugo Duprez

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 修改说明（MIT 要求注明改动）

- 208 个特效与 core 被压缩打包进单个文件，未改动逻辑。
- 打包文件尾部追加了一小段索引代码（`PixelFXAvatar.meta / ids / list`），属于新增，不属于 pixelfx。
- `hx-avatar.js`（渲染器、选择面板、方框裁切、单 rAF 调度）为华夏工具自行编写，不来自 pixelfx。

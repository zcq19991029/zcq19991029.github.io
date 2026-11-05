# NOTICE：fx/hx-qr.js（课堂码大屏二维码）

`fx/hx-qr.js` 是从本仓库 node_modules 里已有的 **qrcode** npm 包（版本 1.5.4，MIT License，
作者 Ryan Day <soldair@gmail.com>，贡献者 Vincenzo Greco、Linus Unnebäck）的 `lib/core`
编码器打包成的单文件浏览器脚本。构建脚本：`fx/build-qr.mjs`（重新生成：`node 总入口/fx/build-qr.mjs`）。

- 打包内容：qrcode 1.5.4 `lib/core` 的 22 个模块（QR 矩阵生成，不包含 canvas/svg 渲染器）。
- `dijkstrajs` 依赖不在仓库里，以内联的等价 Dijkstra 最短路实现替代（标准算法，无原创版权问题）。
- 渲染（把矩阵画到 canvas）由 `总入口/index.html` 自己完成，本文件只负责编码。
- 不引任何外部 CDN：教室网络不稳，二维码必须离线可用。

## MIT License（qrcode 1.5.4 原文）

Copyright (c) 2016 Ryan Day

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

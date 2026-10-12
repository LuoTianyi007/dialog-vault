# 第三方依赖

本仓库通过 npm 下载依赖，不把 Electron 运行包或生成的阅读资源纳入 Git 历史。Windows 打包脚本会将相应运行时、Chromium 许可及渲染依赖许可一同复制进交付文件夹。

| 依赖 | 版本 | 许可证 |
| --- | --- | --- |
| Electron | 44.7.0 | MIT；随附 Chromium 等许可 |
| markdown-it | 15.0.2 | MIT |
| DOMPurify | 3.4.16 | MPL-2.0 或 Apache-2.0 |
| KaTeX | 0.19.0 | MIT |
| highlight.js / CDN assets | 11.12.0 | BSD-3-Clause |
| zip.js | 2.23.0 | BSD-3-Clause |
| Playwright（测试） | 1.64.0 | Apache-2.0 |

完整依赖版本在 `package-lock.json`，各包的许可证原文由 npm 包提供。项目自身尚未选择源码许可证。

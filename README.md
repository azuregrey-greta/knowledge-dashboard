# KnowledgeDashboard · 知识消化看板插件

2026-11-03/04 成品。Obsidian 插件视图：任务进度柱状图 / 下一步建议（含 AI 今日推送）/ 今日待办 / 随机回顾 / 心情不好双按钮 / 待验证与检索用 / 00_Todo 项目文件夹。

- 数据模型：笔记 frontmatter 七字段（层/主题/性质/消化方式/完成状态/消化状态/重要度），任务轴=消化方式。
- 安装：已装实例 `~/Nutstore Files/Obsidian Vault/.obsidian/plugins/knowledge-dashboard/`；本目录为源码与构建产物备份。
- 修改：`npm install` 后改 `main.ts` → `npm run build` + `npx tsc --noEmit` → 把 main.js 同步回已装实例并重载插件。
- 完整维护手册：vault `00_Todo/20261103看板插件/20261103看板插件.md`。
- 安卓可用（isDesktopOnly=false，无 Node 专属 API），手动复制 main.js/manifest.json/styles.css 到手机 vault 同名目录。

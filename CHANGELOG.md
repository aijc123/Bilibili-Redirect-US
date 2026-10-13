# 更新日志

这里记录aijc123维护的手机版；[Biliverse上游原更新记录](docs/history/UPSTREAM-CHANGELOG.md)单独保留。

## [Unreleased]

## 维护更新 · 2026-10-13

- 参考BTR的README阅读顺序、源码/产物划分、声明式打包和反馈表单，整理项目。
- Loon适配集中到src/loon，range-download与原版BTR range-core分开命名；bundle.json集中描述打包顺序及入口。
- 首页增加安装导航、生效判断、原理、常见问题及效果证据入口；技术和历史文档集中到docs，原链接保留。
- 增加中文问题/建议模板、贡献说明和项目图标；npm build/test/check成为无需额外依赖的手机版入口，上游命令另行保留。
- **运行版本仍为0.1.14，生成的9个手机版文件与整理前逐一一致；没有更改手机调度策略。**

## [0.1.14-experimental] · 2026-10-13

- 日常版只有启用开关；15节点自动回退，常规上限8，按负载与近期网络错误收缩。
- 短诊断显示请求处理版本、近期事件和过期样本；详细诊断及研发对照单独保留。
- 167项检查通过，真实播放体验继续验证。[发布说明](https://github.com/aijc123/Bilibili-Redirect-US/releases/tag/range-v0.1.14-experimental)

## [0.1.13-experimental] · 2026-10-13

- BTR大陆/海外节点组、成功节点优先、失败对照暂停与恢复。
- 首选08c，节点扩展至15个；保留严格校验。[发布说明](https://github.com/aijc123/Bilibili-Redirect-US/releases/tag/range-v0.1.13-experimental)

## [0.1.12-experimental] · 2026-10-13

- 手动诊断增量、成功与尝试耗时分开报告，观察分片尾部差异。
- 已有响应中的SIDX只作已见表示估计，不等于当前播放码率。[发布说明](https://github.com/aijc123/Bilibili-Redirect-US/releases/tag/range-v0.1.12-experimental)

更早版本和独立电脑中转原型见[版本入口](docs/VERSIONS.md)与[完整GitHub Releases](https://github.com/aijc123/Bilibili-Redirect-US/releases)。

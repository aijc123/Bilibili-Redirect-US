# 参与贡献

感谢帮助改进海外iPhone播放体验。普通用户用[中文问题表单](https://github.com/aijc123/Bilibili-Redirect-US/issues/new?template=bug-report.yml)即可；希望新增功能可用[建议表单](https://github.com/aijc123/Bilibili-Redirect-US/issues/new?template=feature-request.yml)。

## 改代码前看哪里

先看[结构说明](docs/ARCHITECTURE.md)与[src/loon/bundle.json](src/loon/bundle.json)。Loon源码在src/loon，生成文件在dist/lab；编辑源码后重新构建，不直接修生成bundle。BTR固定模块保留原文件、MIT许可、来源和SHA，适配逻辑放在自己的模块中。

## 验证

Node.js24即可，不需要npm install：

```sh
npm run build
npm test
```

准备提交的产物已生成后，`npm run check`检查测试及构建复现。原Redirect依赖其他工具的构建保留为build:upstream，全部原测试入口保留为test:upstream，不宣称它们在此依赖环境中通过。

PR说明写清具体问题、修改后行为、验证及真机证据。更新CHANGELOG；播放性能变化需要说明视频条件与实际现象，合成测试不能代替无卡顿证据。公开诊断不包含Cookie或完整签名视频地址。

纯目录/文档整理先检查生成产物一致；运行逻辑变化再更新运行版本及固定tag。旧订阅地址、已有效的版本和许可证都需要保留。[发布过程](docs/ARCHITECTURE.md)

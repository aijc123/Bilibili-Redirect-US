# aijc123 的 Loon CDN 定制订阅

这是原固定CDN订阅的维护说明。日常使用请看[当前自动版](README.md)；[Range代码结构与构建](docs/ARCHITECTURE.md)另有独立入口。

订阅：https://raw.githubusercontent.com/aijc123/Bilibili-Redirect-US/main/dist/BiliBili.Redirect.plugin

基于 Biliverse/Redirect 的 Apache-2.0 项目，保留完整 fork 历史和 LICENSE。仓库首页 README 为本定制版的中文说明，上游 README 可在 fork 历史中查看。此版本为非官方定制。

新增 hwo1 与 08c 到 Host.OverseaVideo、Host.BStar、Host.PCDN 的 Loon/BoxJS 选项。Loon 默认第一个选项为 hwo1，可手动换成 08c；没有自动测速或故障切换。MCDN 使用特殊代理流程，因此保持原选项。国内普通 UPOS 请求保持上游行为，不强行改写所有国内节点。

运行脚本来自官方 v0.2.24 Release，完整不修改，随订阅托管在本仓库 dist/。该脚本通过 Host 参数直接赋值目标主机，没有目的主机白名单，已经支持这两个目标。源参数配置与 Loon 模板也已修改；当前 main 源码来自上游 9dca779681dadd271d6996295537512c9a8c94ed。发布构建走固定 Release 定制流程，不混用 main 的未发布脚本。Storage=database 会回到原始 Release 默认值；请保留 Storage=Argument，已有 BoxJS 的 Storage 覆盖设置应清除或改成 Argument。

## 可重复构建

需要 Node.js 24，无 npm 安装、GitHub Packages token 或 Cloudflare/Gist 密钥：

```
node scripts/build-us.mjs
node --test tests/us-bundle.test.mjs
```

vendor/upstream-v0.2.24 保留原始 Release 文件；dist 是生成产物。更新节点时同步修改源参数与 scripts/build-us.mjs。升级运行脚本时先查看新 Release 的逻辑、模板、许可，再整体替换 vendor 并重新测试，勿自动跟随上游。原 fork 的工作流已禁用，避免触发依赖作者私有凭据的部署流程。

## 验证与限制

测试直接运行发布脚本，在模拟 Loon 环境验证两个目标处理海外 UPOS、Akamai、香港、BStar 和 PCDN，检查路径、查询签名和 Host 请求头。发布后检查插件、JSON 和 JS 的公开 HTTP URL。没有在用户的真实 iPhone 上安装或测量宾州速度。

需要 Loon 3.5.1+、开启脚本和复写，并安装及信任 Loon 的 MITM 证书以处理 HTTPS；参见 https://nsloon.app/docs/Plugin/ 与上游 https://biliverse.github.io/guide/redirect 。本插件不改变用户路由策略或视频权限。签名和路径按上游逻辑保留；不同视频或服务端的签名校验可能限制换主机，遇到 403 应切换节点，不能保证所有内容兼容。

基准来源：https://github.com/chrisliu298/bilibili-cdn-fix/blob/main/benchmarks.md 。2026-06-11 的美国单线路数据将 hwo1 与 08c 列为前两名，仅是该时间、线路、视频的参考，不能保证宾州或当前网络同样排名，也不能保证普适提速。

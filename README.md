# Bilibili Redirect US 🇺🇸

**由 [aijc123](https://github.com/aijc123) 定制发布，为在美国使用 iPhone / Loon 看 B 站的用户，提供更方便的 CDN 选择。**

把公开测速中的优选节点，变成可以直接订阅、手动切换、持续维护的 Loon 插件。新增 `hwo1` 和 `08c` 两个 CDN 候选，插件、脚本与配置均托管在本仓库。

[立即获取插件](https://raw.githubusercontent.com/aijc123/Bilibili-Redirect-US/main/dist/BiliBili.Redirect.plugin) · [发布版本](https://github.com/aijc123/Bilibili-Redirect-US/releases) · [反馈问题](https://github.com/aijc123/Bilibili-Redirect-US/issues)

## 这个版本带来了什么？

- **面向美国使用场景的节点选择**：将公开美国基准中排名靠前的 `hwo1`、`08c` 加入参数菜单，默认选择 `hwo1`，可手动切换到 `08c`。
- **一条长期订阅地址**：插件、运行脚本和配套配置统一托管，后续更新沿用同一地址。
- **从选项到业务逻辑的验证**：直接运行发布脚本，检查两个节点的参数改写、路径与签名查询保留，已通过 11 项模拟 Loon 检查。
- **可重复生成、可追溯维护**：保存固定上游 Release 文件，提供不需要安装依赖的定制构建工具，并保留完整 fork 历史。

本版本由 aijc123 完成节点选项整合、订阅发布、配套配置、验证与中文使用说明。重定向核心来自 [Biliverse/Redirect](https://github.com/Biliverse/Redirect)，感谢 VirgilClyne 和上游贡献者提供基础能力。

## 一条链接，添加到 Loon

复制以下地址，在 Loon 插件管理中通过 URL 添加并启用：

```text
https://raw.githubusercontent.com/aijc123/Bilibili-Redirect-US/main/dist/BiliBili.Redirect.plugin
```

此链接随本仓库 `main` 分支更新，后续无需因版本变化更换订阅地址。

### 使用设置

1. 使用 **Loon 3.5.1 或更新版本**，开启脚本和复写。
2. 处理 HTTPS 请求需要安装并信任 Loon 的 MITM 证书。
3. 在 `Host.OverseaVideo`、`Host.BStar`、`Host.PCDN` 参数中选择 `hwo1` 或 `08c`。默认是 `hwo1`，可按实际播放体验切换。
4. 保留 `Storage = Argument`。若此前通过 BoxJS 保存过 `Storage`，请清除覆盖设置，或将其改为 `Argument`。

插件没有自动测速或故障切换功能。出现播放异常或 HTTP 403 时，可尝试另一节点，必要时关闭插件。Loon 插件与参数说明见 [Loon 官方文档](https://nsloon.app/docs/Plugin/)。

## 节点选择有据可查

本项目参考 [chrisliu298/bilibili-cdn-fix 的 CDN 测速文档（benchmarks.md）](https://github.com/chrisliu298/bilibili-cdn-fix/blob/main/benchmarks.md)。该文档记录了 **2026 年 6 月 11 日、美国一条网络线路、单连接下载 Bilibili 视频分段** 的测试。在每个节点共 7 次读数的确认测试中：

| CDN 主机名 | 平均吞吐量 | 最低读数 | 本版本中的选择 |
| --- | --- | --- | --- |
| `upos-sz-mirrorhwo1.bilivideo.com` | 约 113 Mbps | 97.5 Mbps | 默认候选 |
| `upos-sz-mirror08c.bilivideo.com` | 约 110 Mbps | 94.5 Mbps | 可手动切换的候选 |

**这些数字引用自上述文档，不是本仓库重新测速的结果。** 排名会随时间、线路和视频内容变化，仅作为选取候选节点的依据，不保证宾州当前网络或其他地区获得同样速度。欢迎提供带有地区、运营商和测试时间的实际使用反馈。

## 运行逻辑与验证范围

发布脚本采用上游正式版 **v0.2.24** 的 `request.bundle.js`，完整保留原文件并在本仓库托管。其逻辑通过 `Settings.Host` 使用目标主机，支持新增选项；定制同时更新 Loon 与 BoxJS 配置。

保留上游特殊 MCDN 处理流程及目标选项。普通国内 UPOS 请求仍按上游逻辑处理，不会全部强制切换到所选节点。插件不会提供额外视频权限或改变用户路由策略；不同内容的服务端签名校验仍可能限制换主机。

已通过 **11 项模拟 Loon 检查**，覆盖两个目标对海外 UPOS、Akamai、香港、BStar、PCDN 请求的处理，以及插件参数传递。首次发布时，插件、JS 和 JSON 的公开链接均验证返回 HTTP 200，并与发布内容一致。

**尚未在真实 iPhone 上完成安装或宾州网络速度实测。**

可独立通过 Loon 参数使用本插件。上游通用网页设置面板由 Enhanced 模块提供，本仓库不额外打包该前端；需要该面板时请参阅 [上游文档](https://biliverse.github.io/guide/redirect)。

## 开发与维护

### 正在验证：手机并发下载实验版

除 CDN 重定向外，本仓库现已实现适用于 Loon 的有限 Range 并发下载实验版。范围解析、分块与拼接直接复用 BTR 核心，保留固定版本和完整 MIT 许可；本仓库负责 Loon 手机适配、传输、诊断与发布。它会将符合条件的请求拆成 2～4 路下载，并根据手机实际传输结果选择 CDN。**尚未证明在真实 iPhone 上提速**，请阅读 [实验版安装、对照方法与限制](RANGE-EXPERIMENT.md) 后试用；使用时停用原 Redirect，避免冲突。

[获取实验插件](https://raw.githubusercontent.com/aijc123/Bilibili-Redirect-US/main/dist/BiliBili.Range.Experimental.plugin)

原有订阅仍为固定 CDN 重定向版本，两者分开发行。

使用 Node.js 24，无需安装 npm 依赖或配置 GitHub Packages 凭据：

```sh
node scripts/build-us.mjs
node --test tests/us-bundle.test.mjs
```

- `vendor/upstream-v0.2.24/`：保存原始正式版文件。
- `scripts/build-us.mjs`：生成定制订阅和配置。
- `dist/`：已发布的插件、运行脚本和配置。
- [CUSTOMIZATION.md](CUSTOMIZATION.md)：源码版本、构建方式及维护说明。

更新节点时需同步修改源参数与定制构建工具。升级运行脚本前，先核对新版本逻辑与模板，再整体更新固定文件并重新验证。原 fork 工作流已禁用，避免触发依赖上游作者凭据的部署流程。

## 致谢与开源许可

感谢 **VirgilClyne 与 Biliverse/Redirect 的贡献者**：本项目的 CDN 重定向核心建立在他们的开源成果之上。感谢 **chrisliu298** 分享公开测速方法与数据，为本次节点选择提供参考。

- 原项目：[Biliverse/Redirect](https://github.com/Biliverse/Redirect)。
- 测速来源：[bilibili-cdn-fix / benchmarks.md](https://github.com/chrisliu298/bilibili-cdn-fix/blob/main/benchmarks.md)。
- 本版本的上游反馈：[增加两节点的 Issue #12](https://github.com/Biliverse/Redirect/issues/12)，已提交，尚不代表上游采纳。
- 沿用 **Apache License 2.0**，详见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。

这是 aijc123 的非官方定制发布，与上游官方版本相互独立。觉得这个版本方便的话，欢迎 Star，也欢迎把订阅分享给有相同需求的朋友。

# 代码结构与维护

当前用户入口为README与USAGE，自动策略在AUTOMATIC，证据在EVIDENCE，旧版本在legacy/history。根目录旧说明是兼容入口。参考BTR的源码/适配/生成产物划分，Loon源码集中到src/loon，固定原模块在vendor，产物在dist；原Biliverse的其他源码与构建文件作为fork基础保留。

## 各模块负责什么

| 路径 | 职责 |
| --- | --- |
| src/loon/policy.js | 自动参数及保留的研发参数解析；与传输、统计分离 |
| src/loon/adaptive.js / adaptive.json | 独立候选的完成请求反馈、收益/尾部判断及阈值；复用已有交替比较 |
| src/loon/candidates.js | 从统一JSON清单生成节点组，不重复硬编码15节点 |
| src/loon/range-download.js | Loon范围资格、安全校验、同节点并发；调用BTR基础工具 |
| src/loon/loon-http.js | Loon回调、二进制和严格重定向处理 |
| src/loon/budget.js | 尽力共享的任务/请求/缓冲租约；存储无原子CAS，不保证严格全局上限 |
| src/loon/measurements.js | 有界传输样本、时间区间和观察对照 |
| src/loon/diagnostics.js | 累计计数、有限事件、请求版本标记、短摘要与完整报告 |
| src/loon/loon.js | 接入请求、调度、持久化与完成回调 |
| src/loon/bundle.json | 下载/诊断/网络模块顺序、入口和自动/对照profile的声明清单 |
| vendor/btr-0302b345 | 固定MIT模块、许可、SHA及来源；不修改原核心 |
| data/cdn-candidates.json | 自动版和对照工具及GitHub健康探测共同的主机清单 |
| scripts/build-range.mjs | 同一模块集合生成自动版与对照工具；只有入口profile及参数菜单不同 |
| scripts/build-adaptive.mjs | 共用构建器，检查候选接入位置；生成独立命名空间的候选，不改变主版 |
| scripts/check-range.mjs | 本地与CI共同的构建、验证入口 |
| dist/lab | 当前生成发布文件，脚本URL固定标签 |
| dist/candidate | 独立自动调优候选，自己的固定版本脚本与本地统计空间 |

自动版只有Enabled参数，旧高级参数即使残留也不会控制它。对照工具使用同一下载逻辑，保留并发、候选、协议等研发设置；两者共享本地统计键以保留升级记录，不能同时启用。

## 构建与验证

使用Node24，`npm run build`生成原自动版；`node scripts/build-adaptive.mjs`生成候选。`npm test`调用scripts/check-range.mjs检查文档链接、构建主版/候选及已有中转产物，再运行全部检查。`npm run check`与CI额外验证三类已提交产物可复现。无需安装原上游npm私有依赖；原命令另存build:upstream/test:upstream，不宣称全部上游测试通过。

修改版本时更新diagnostics.js中的VERSION，重新生成并验证，再提交源码与dist/lab，发布对应不可变tag。主订阅在main，运行脚本在tag；不能在发布后移动tag。检查所有插件script-path均返回HTTP200且内容与本地一致。README效果描述只能依据真实证据，不把合成检查当作无卡顿或倍数结论。

打包顺序来自bundle.json，主版版本从诊断源码VERSION读出。候选版本与阈值单独集中在adaptive.json，共用buildProfiles与模块读取；候选的明确接入位置和16/32对照扩展只在生成候选时应用，锚点不一致立即停止构建。主版产物与0.1.14逐一一致，候选使用独立tag和存储键。提交说明先写进[CHANGELOG](../CHANGELOG.md)，不因单纯目录或文档改动另发运行版本。

电脑中转0.1.1的构建另外固定在vendor/loon-range-0.1.12，SHA与来源可查，避免手机自动策略升级意外改变已发布中转。它仍默认关闭、未验证iPhone实际效果。

## 复用与许可

Biliverse/Redirect的原运行文件保存在vendor/upstream-v0.2.24；BTR Range/SIDX原文件按MIT固定直接复用。节点主机与成功优先思路参考BTR CDN resolver，Loon适配、policy、budget与diagnostics由aijc123实现（Apache-2.0）。BTR的progress、buffer与stall控制依赖浏览器播放器，不伪装成Loon可用接口。历史测速来源只引用公开数据与主机，不复制无代码许可的实现。

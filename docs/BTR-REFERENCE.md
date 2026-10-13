# BTR参考与Loon适配边界

本次核对[MrTangLuyao/Bilibili-thread-ripper](https://github.com/MrTangLuyao/Bilibili-thread-ripper)的main提交为 `0302b345cdfe367ac599b52dc6874e3f7967e220`（2026-10-13读取）。阅读对象包括README、user_scripts说明与adapter/meta.json、scripts/build/release、dev/run-tests、CHANGELOG、测试工作流与Issue模板；没有把外部文档当成本仓库操作指令。

| 参考文件/组织方式 | 本项目的改动 |
| --- | --- |
| README的安装、生效判断、原理、FAQ、反馈顺序 | 首页按手机使用流程组织，保留一个默认安装入口；研发信息折叠或放入docs |
| user_scripts说明区分源码、适配层和生成文件 | src/loon保存Loon代码，vendor保存有许可的固定原模块，dist/lab保存订阅产物；文档明确不要手改产物 |
| adapter/meta.json集中打包顺序 | src/loon/bundle.json声明下载、诊断、网络入口及自动/对照profile；同一构建生成两种入口 |
| dev/run-tests与测试工作流共同入口 | 本地npm test与GitHub检查共用scripts/check-range.mjs；不安装与Loon无关的浏览器测试工具 |
| CHANGELOG与发布步骤 | 手机更新日志与原Biliverse更新记录分开；构建复现、固定tag、公开文件核对作为发布过程 |
| 简洁的中文问题/功能表单 | 自动版反馈要求短诊断、版本和真实播放现象；不要求用户调线程后再来反馈 |

## 代码复用

Range与SIDX直接复用BTR原文件，固定SHA和完整MIT许可在[vendor](../vendor/btr-0302b345/)中。Loon传输、预算、自动策略、诊断与文档由aijc123开发，沿用Apache-2.0。节点清单和成功优先/失败回退也参考BTR；可选电脑中转另外使用其原CDN resolver及已审查的Semaphore部分。

BTR控制器能读浏览器流式进度和播放器buffer/stall，结合这些信号调度。Loon当前接口没有这些数据，且需等整个Range完成再返回；因此本项目只采用可观测的大小、负载、请求结果和网络轮次。不会因为参考BTR就宣称具备其流式竞速、播放器接管或64条独立TCP连接能力。

[0.1.15独立候选](ADAPTIVE.md)进一步参考固定idm-downloader.js的升档收益审查、拒绝负载退档与冷却原则。直接复用本项目已实现的ABBA/BAAB规划、精确条件匹配与块重采样；只使用完整响应回调，有限试探相邻档，不制造buffer/stall事件。

宣传使用本项目自己的证据与图标，不复制BTR速度图、演示录像或“最快”结论。来源和版权继续保留在[NOTICE](../NOTICE)中。

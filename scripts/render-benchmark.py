"""Plot recorded observations with Matplotlib. Never generates benchmark numbers.

Optional plotting tool; not required by the Node-only plugin build/CI.
"""
import argparse
import csv
import json
import math
from collections import defaultdict
from pathlib import Path
from statistics import median

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.font_manager import FontProperties
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch


def configure_font():
    candidates = [Path("C:/Windows/Fonts/msyh.ttc"),
                  Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
                  Path("/System/Library/Fonts/PingFang.ttc")]
    font = next((p for p in candidates if p.exists()), None)
    if not font:
        raise ValueError("未找到中文字体；请安装Noto/思源黑体，或在字体列表填入本机字体路径")
    from matplotlib.font_manager import fontManager
    fontManager.addfont(str(font))
    plt.rcParams["font.family"] = FontProperties(fname=str(font)).get_name()
    plt.rcParams.update({"axes.unicode_minus": False, "font.size": 11,
                         "svg.fonttype": "path", "figure.facecolor": "white"})


def bar_plot(ax, groups, labels, colors, ylabel):
    values = [median(g) for g in groups]
    bars = ax.bar(range(len(groups)), values, color=colors, width=.62,
                  yerr=[[m-min(g) for m, g in zip(values, groups)],
                        [max(g)-m for m, g in zip(values, groups)]],
                  capsize=4, error_kw={"elinewidth": 1.2, "ecolor": "#334155"})
    ax.set_xticks(range(len(groups)), labels)
    ax.set_ylabel(ylabel)
    ax.grid(axis="y", color="#e2e8f0", linewidth=.7)
    ax.set_axisbelow(True)
    for side in ["top", "right"]:
        ax.spines[side].set_visible(False)
    for bar, value in zip(bars, values):
        ax.annotate(f"{value:.2f}", (bar.get_x()+bar.get_width()/2, bar.get_height()),
                    xytext=(0, 7), textcoords="offset points", ha="center", fontsize=10,
                    color="#0f172a", fontweight="bold")
    return values


def fixture_figure(path):
    data = json.loads(path.read_text(encoding="utf-8"))
    if "loopback" not in data.get("scope", "").lower():
        raise ValueError("Fixture chart requires an explicitly labelled loopback dataset")
    size = data["bytes"]
    if not isinstance(size, int) or size <= 0:
        raise ValueError("Invalid payload byte count")
    counts = [1, 2, 4, 8, 16, 32]
    profiles = [("single-job-limit", "仅每任务限速"),
                ("shared-link-limit", "每任务限速 + 总出口配额")]
    groups_all = []
    for profile, _ in profiles:
        groups = []
        for n in counts:
            rows = [r for r in data["measurements"] if r["profile"] == profile and r["configured"] == n]
            if len(rows) < 3 or any(r["elapsedMs"] <= 0 or r["effective"] != n or r["peakHTTPJobs"] != n for r in rows):
                raise ValueError("Missing observations or actual concurrency does not match label")
            groups.append([size*8/r["elapsedMs"]/1000 for r in rows])
        groups_all.append(groups)
    colors = ["#94a3b8", "#67e8f9", "#22d3ee", "#fb7299", "#38bdf8", "#818cf8"]
    fig, axes = plt.subplots(1, 2, figsize=(13, 6), sharey=True)
    ceiling = max(max(g) for groups in groups_all for g in groups)*1.18
    for ax, (_, title), groups in zip(axes, profiles, groups_all):
        bar_plot(ax, groups, [str(n) for n in counts], colors, "有效交付率（Mbps）")
        ax.set_title(title, fontsize=14, fontweight="bold", pad=15)
        ax.set_xlabel("并发 HTTP 任务数（非 iPhone 连接数）", labelpad=12)
        ax.set_ylim(0, ceiling)
    fig.suptitle("并发分片下载对比 · 本机受控 HTTP 实验", fontsize=20, fontweight="bold", y=.97)
    fig.text(.5, .89, "4 MiB固定数据 · 每条件3轮 · 柱为中位数，误差线为最小—最大值 · 两图同一纵轴", ha="center", color="#475569")
    fig.text(.5, .09, "合成回环模型，不是 B 站 CDN 或 iPhone 实测；不能推断海外提速倍数。", ha="center", fontsize=12, color="#9f1239", fontweight="bold")
    date = data.get("generatedAt", "未记录日期")[:10]
    env = data.get("environment", {})
    fig.text(.5, .045, f"{date} · {env.get('platform', '未知环境')} / Node {env.get('node', '未知')} · 下载与校验耗时 · 粉色标记8任务（自动版常规上限）", ha="center", fontsize=9, color="#64748b")
    fig.subplots_adjust(top=.78, bottom=.23, left=.075, right=.98, wspace=.19)
    return fig


def phone_figure(path):
    rows = list(csv.DictReader(path.open(encoding="utf-8-sig", newline="")))
    names = {"native": "无加速", "redirect": "原 Redirect", "auto": "Bili Range 自动版"}
    groups, blocks = defaultdict(list), defaultdict(list)
    for row in rows:
        method = row.get("method")
        if method not in names or row.get("new_transfer_confirmed") != "yes":
            raise ValueError("Each recorded row needs a known method and confirmed new media transfer; cached/uncertain rows must be excluded and documented")
        for key in ["session", "block", "video_label", "quality"]:
            if not row.get(key):
                raise ValueError(f"Missing {key}; do not plot an unfilled template")
        row["order"] = int(row["order"])
        if row["order"] < 1:
            raise ValueError("Order must be positive")
        for key in ["playback_rate", "duration_s", "startup_s", "stall_count", "stall_seconds"]:
            value = float(row[key])
            if not math.isfinite(value) or value < 0:
                raise ValueError(f"Invalid {key}")
            row[key] = value
        if min(row["playback_rate"], row["duration_s"], row["startup_s"]) <= 0 or row["stall_seconds"] > row["duration_s"] or not row["stall_count"].is_integer():
            raise ValueError("Invalid observation window or startup/stall values")
        groups[method].append(row)
        blocks[(row["session"], row["block"], row["video_label"])].append(row)
    if len(groups) < 2 or any(len(g) < 3 for g in groups.values()):
        raise ValueError("At least two methods and three observations per method are needed; still an observational comparison")
    for block in blocks.values():
        counts = {m: sum(r["method"] == m for r in block) for m in groups}
        if not all(counts.values()) or len(set(counts.values())) != 1 or len({r["order"] for r in block}) != len(block) or len({(r["quality"], r["playback_rate"], r["duration_s"]) for r in block}) != 1:
            raise ValueError("对照块方案/次数不齐、轮次重复，或画质/倍速/时长不一致；请核对记录")
    methods = [m for m in names if m in groups]
    fig, axes = plt.subplots(1, 2, figsize=(12, 6))
    labels = [names[m]+f"\n(n={len(groups[m])})" for m in methods]
    colors = [{"native": "#94a3b8", "redirect": "#22d3ee", "auto": "#fb7299"}[m] for m in methods]
    for ax, key, title, ylabel in [(axes[0], "startup_s", "点击到首帧（越低越好）", "秒"),
                                   (axes[1], "stall_seconds", "播放中卡顿（越低越好）", "每分钟卡顿秒数")]:
        values = [[r[key] if key == "startup_s" else r[key]/r["duration_s"]*60 for r in groups[m]] for m in methods]
        bar_plot(ax, values, labels, colors, ylabel)
        ax.set_title(title, fontsize=14, fontweight="bold", pad=15)
        ax.set_ylim(0, max(.5, max(max(v) for v in values)*1.2))
    fig.suptitle("iPhone 播放体验对照 · 用户实测记录", fontsize=20, fontweight="bold", y=.97)
    fig.text(.5, .89, "中位数与最小—最大值 · 体验指标，不是下载 Mbps · 不代表因果提速倍数", ha="center", color="#475569")
    fig.text(.5, .07, "同视频段、同清晰度/倍速/观察时长分块比较；缓存、网络与观察误差仍可能影响结果。", ha="center", color="#64748b", fontsize=10)
    fig.subplots_adjust(top=.78, bottom=.24, wspace=.3)
    return fig


def flow_figure():
    fig, ax = plt.subplots(figsize=(13.5, 8.3))
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")

    def box(x, y, w, h, text, color, fontsize=11):
        ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.007,rounding_size=0.012",
                                   facecolor=color, edgecolor="#94a3b8", linewidth=1))
        ax.text(x+w/2, y+h/2, text, ha="center", va="center", fontsize=fontsize, color="#0f172a")

    def arrow(x1, y1, x2, y2, color="#64748b"):
        ax.add_patch(FancyArrowPatch((x1, y1), (x2, y2), arrowstyle="-|>", mutation_scale=12,
                                    linewidth=1.25, color=color))

    fig.suptitle("一个媒体请求，多个 Range 任务并发下载", fontsize=21, fontweight="bold", y=.97)
    fig.text(.5, .912, "1 MiB / 8任务示意：每片128 KiB，只下载自己的字节区间，不重复下载8份", ha="center", color="#475569", fontsize=12)
    box(.015, .77, .17, .10, "官方 App 发出\n1 MiB 媒体请求", "#f1f5f9")
    box(.015, .48, .17, .18, "检查是否适合接管\n保留原地址或失败回退\n分配共享任务预算", "#fce7f3", 10)
    arrow(.095, .765, .095, .67)
    ax.plot([.22, .22], [.19, .845], color="#0891b2", linewidth=2)
    arrow(.19, .57, .22, .57, "#0891b2")
    ax.text(.465, .865, "以下8个任务同时进行 · 同一媒体服务器", ha="center", color="#0e7490", fontweight="bold")
    for i in range(8):
        y = .805-i*.087
        start, end = i*131072, (i+1)*131072-1
        box(.285, y-.03, .36, .060, f"任务 {i+1}     bytes={start:,}–{end:,}", "#cffafe", 11)
        arrow(.22, y, .276, y, "#0891b2")
        arrow(.65, y, .713, y, "#0891b2")
    ax.plot([.722, .722], [.19, .845], color="#0891b2", linewidth=2)
    arrow(.722, .56, .757, .56)
    box(.765, .39, .225, .32, "等待所有任务回调完成\n\n校验 206 / 范围 / 长度\n总长度与实体标记一致", "#f1f5f9", 11)
    box(.765, .185, .225, .12, "校验通过\n按字节顺序合并为1 MiB", "#fce7f3", 11)
    arrow(.88, .384, .88, .313, "#db2777")
    box(.015, .045, .27, .09, "不适合接管或校验失败\n交给原请求继续处理", "#fff7ed", 10)
    box(.575, .045, .415, .09, "官方 App 继续负责播放、清晰度和缓冲", "#fce7f3", 11)
    arrow(.88, .178, .88, .142, "#db2777")
    arrow(.095, .473, .095, .143)
    ax.plot([.755, .75, .34, .34], [.43, .155, .155, .09], color="#c2410c", linewidth=1, linestyle="--")
    arrow(.34, .09, .292, .09, "#c2410c")
    ax.text(.743, .335, "失败", ha="right", va="center", fontsize=9, color="#9a3412")
    arrow(.29, .09, .568, .09)
    fig.text(.5, .035, "示意不是耗时图；HTTP任务数按大小和负载缩减，不等于实际TCP连接数。", ha="center", fontsize=10, color="#64748b")
    fig.text(.5, .012, "Loon等待完整Range；分片失败也要等待全部回调，再交还原请求。", ha="center", fontsize=10, color="#64748b")
    fig.subplots_adjust(top=.885, bottom=.04, left=.025, right=.975)
    return fig


def phone_media_figure(path):
    data = json.loads(path.read_text(encoding="utf-8"))
    if "user-reported" not in data.get("scope", "").lower():
        raise ValueError("Phone media chart requires explicitly attributed observed data")
    rows = data["rows"]
    hosts = list(dict.fromkeys(row["host"] for row in rows))
    if not 1 <= len(hosts) <= 5 or len(rows) != 2*len(hosts) or not 262144 <= data["rangeBytes"] <= 1048576:
        raise ValueError("Unexpected observed dataset; do not invent missing measurements")
    for row in rows:
        if (row["configured"] not in [1, 8] or row["attempts"] != 2
                or row["success"] + sum(row["errors"].values()) != row["attempts"]
                or (row["medianMbps"] is None) != (row["success"] == 0)
                or row["actual"] != min(row["configured"], data["rangeBytes"]//(128*1024))
                or not 0 <= row["success"] <= row["attempts"]
                or row["medianAttemptMs"] <= 0
                or (row["medianMbps"] is not None and row["medianMbps"] <= 0)):
            raise ValueError("Invalid success/error or unavailable-speed observation")
    if any(sum(row["host"] == host and row["configured"] == arm for row in rows) != 1
           for host in hosts for arm in [1, 8]):
        raise ValueError("Each observed host needs one single-task and one parallel summary")
    fig, axes = plt.subplots(2, 1, figsize=(12, 8), sharex=True)
    short = lambda host: "Akamai" if host.endswith(".akamaized.net") else host.removeprefix("upos-sz-mirror").removesuffix(".bilivideo.com")
    labels = [("原地址\n" if next(row for row in rows if row["host"] == host)["original"] else "替换 ")+short(host) for host in hosts]
    colors = {1: "#0ea5e9", 8: "#ec4899"}
    for configured, offset in [(1, -.19), (8, .19)]:
        selected = [next(r for r in rows if r["host"] == h and r["configured"] == configured) for h in hosts]
        x = [i + offset for i in range(len(hosts))]
        rates = [r["medianMbps"] or 0 for r in selected]
        bars = axes[0].bar(x, rates, width=.34, color=colors[configured],
                           label=f'配置{configured}任务 · 实际{selected[0]["actual"]}')
        for bar, row in zip(bars, selected):
            if row["medianMbps"] is None:
                axes[0].scatter([bar.get_x()+bar.get_width()/2], [.45], marker="x", color="#b91c1c", s=50)
                value = "无成功"
            else:
                value = f'{row["medianMbps"]:.2f}'
            axes[0].annotate(value+f'\n{row["success"]}/2成功',
                             (bar.get_x()+bar.get_width()/2, bar.get_height()), xytext=(0, 7),
                             textcoords="offset points", ha="center", fontsize=9,
                             color="#0f172a" if row["success"] else "#b91c1c")
        bars = axes[1].bar(x, [r["medianAttemptMs"] for r in selected], width=.34, color=colors[configured])
        for bar, row in zip(bars, selected):
            if row["errors"]:
                bar.set_hatch("//")
            axes[1].annotate(str(row["medianAttemptMs"]),
                             (bar.get_x()+bar.get_width()/2, bar.get_height()), xytext=(0, 5),
                             textcoords="offset points", ha="center", fontsize=9)
    for ax in axes:
        ax.grid(axis="y", color="#e2e8f0", linewidth=.7)
        ax.set_axisbelow(True)
        for side in ["top", "right"]:
            ax.spines[side].set_visible(False)
    axes[0].set_ylim(0, max(row["medianMbps"] or 0 for row in rows)*1.28)
    axes[0].set_ylabel("成功请求中位速度 · Mbps")
    axes[0].legend(loc="upper right", frameon=False, fontsize=10)
    axes[1].set_ylim(0, max(row["medianAttemptMs"] for row in rows)*1.22)
    axes[1].set_ylabel("完整尝试中位耗时 · ms\n含失败；斜线表示有失败")
    axes[1].set_xticks(range(len(hosts)), labels)
    fig.suptitle("Bili Range · iPhone 真实媒体范围下载对照", fontsize=19, fontweight="bold", y=.97)
    version = data.get("version") or "版本未附"
    fig.text(.5, .917, f'用户报告 · 2026-10-14 · {version} · 相同{data["rangeBytes"]:,}字节 · h1偏好 · 每档最多2次', ha="center", fontsize=10, color="#475569")
    fig.text(.5, .13, "速度只统计成功请求；原地址也是脚本下载，不是原生App对照。无原始单次数据，不画误差线或置信区间。", ha="center", fontsize=9.5, color="#475569")
    fig.text(.5, .091, "媒体轨类型未知；缓存、时间顺序与小样本仍有影响。当前路由的观察，不是长期节点排名、因果提速倍数或无卡顿证明。", ha="center", fontsize=9.5, color="#475569")
    error_names = {"redirect-untrusted": "跳转拒绝", "transport": "网络错误", "entity-mismatch": "实体校验失败"}
    failures = [f'{short(row["host"])} {row["actual"]}任务 {count}次{error_names.get(reason, reason)}'
                for row in rows for reason, count in row["errors"].items()]
    fig.text(.5, .052, "成功响应跨节点逐字节比对。"+"；".join(failures)+"。", ha="center", fontsize=9, color="#475569")
    fig.subplots_adjust(top=.86, bottom=.22, left=.10, right=.98, hspace=.22)
    return fig


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--fixture", type=Path)
    source.add_argument("--phone", type=Path)
    source.add_argument("--phone-media", type=Path)
    source.add_argument("--flow", action="store_true")
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--name", help="Optional output basename; preserve earlier observed figures")
    args = parser.parse_args()
    try:
        configure_font()
        fig = phone_media_figure(args.phone_media) if args.phone_media else flow_figure() if args.flow else fixture_figure(args.fixture) if args.fixture else phone_figure(args.phone)
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.error("无法绘图："+str(error))
    args.out_dir.mkdir(parents=True, exist_ok=True)
    name = "phone-media-observed" if args.phone_media else "parallel-range-flow" if args.flow else "concurrency-fixture" if args.fixture else "phone-experience"
    if args.name:
        if not args.name.replace("-", "").isalnum() or len(args.name) > 80:
            parser.error("Output basename must contain only letters, digits and hyphens")
        name = args.name
    for ext in ["svg", "png"]:
        target = args.out_dir/(name+"."+ext)
        fig.savefig(target, dpi=180, facecolor="white")
        if ext == "svg":
            target.write_text("\n".join(line.rstrip() for line in target.read_text(encoding="utf-8").splitlines())+"\n", encoding="utf-8")
    plt.close(fig)
    print(str(args.out_dir/(name+".png")))


if __name__ == "__main__":
    main()

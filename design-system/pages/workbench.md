# 工作台（Workbench）— 页面覆盖

> 存在即覆盖 MASTER.md 对应条目。背景：用户裁定 2026-09-29——低质量游戏录屏的
> 监视器被挤压看不清，工作台主区必须让给视频（task-5，M14）。

## 视频优先规则

- 监视器行（`.workbench-monitor`，grid row 1）是 `.workbench-grid` 唯一的
  `minmax(0, 1fr)` 弹性轨道——传送带/对比条/缩略图带/时间轴四行都按内容
  auto 定高，监视器吸收其余全部空间，默认应占视口高度 ≥50%。
- 时间轴面板高度不再回退到内容自适应（旧 `auto`，实测 306px+）：无
  `vd.tl-h` 存储值（或值非法）时默认 **200px**——标尺 + 当前选中泳道完整
  可见，同时把尽量多的垂直空间让给监视器行。分割条双击复位同步回到这个
  200px 默认（localStorage 语义不变：仍是移除 `vd.tl-h` 键，只是渲染时的
  默认值从 auto 改成 200）。
- 右栏（Inspector，标注/推断）与缩略图带均可收合，让视频获得更多宽度/高度
  （见下方收合清单）。

## 收合项清单

| 项 | 状态 key（localStorage） | 默认 | 收合效果 | 控件 |
|---|---|---|---|---|
| 右栏 Inspector | `vd.inspector-open` | 展开 | 列宽 320px→0，`.workbench-grid` 单列让给监视器；对比模式下双画面各多得 ~160px 宽 | 展开态：列缘 44px chevron（`ChevronRight`，收起）；收合态：视口右上角浮动 36px 药丸（`ChevronLeft`，展开），不遮监视器角部（该角落无常驻控件） |
| 缩略图带 ThumbStrip | `vd.strip-open` | 展开 | 行内容收窄为 8px 把手条 | 展开态：带左缘小 chevron（`ChevronDown`，收起）；收合态：整条 8px 把手（`ChevronUp`，展开） |
| 时间轴面板高度 | `vd.tl-h` | 200px（无存储值时） | 分割条拖动/双击复位，clamp 语义不变（`clampTlHeight`：min 180，max = viewportH − 320） | 已有分割条（M11），本任务只改默认值 |

两个收合状态互相独立，持久化到各自的 localStorage key；读取一律 guard——
值不是精确的 `'false'`/合法数字时回退到默认（展开 / 200px），不会把用户
锁在一个空面板或异常高度里。收合/展开把手均带 Tooltip + `aria-label`，
`<button>` 原生键盘可达（Tab 聚焦、Enter/Space 触发），不额外占用全局快
捷键位。

三处改动全部是 CSS 网格模板（`gridTemplateColumns`/`gridTemplateRows`）+
条件渲染，不改时间轴画布常量（`GUTTER_W`/`LANE_H`/`RULER_H`）、指针逻辑或
播放器同步逻辑；Timeline 的 ResizeObserver（M11 遗留）与 ThumbStrip 的 %
定位保证画布/缩略图带随实际可用宽度即时重排。

## 量化验收线（task-5 brief）

- 1440×860、对比模式开、右栏 + 缩略图带均收合、`tlH=200`：单侧视频画面
  ≥ 700×394。
- 单视频模式（不开对比）：视频高度 ≥ 480px。
- 100vh 无页面滚动（1280×800 / 1440×860 双查），900px 降级不破版。

（本次实现的实测数值见 `.superpowers/sdd/2026-09-29-m14-redesign/task-5-report.md`。）

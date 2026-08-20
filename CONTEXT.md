# Video Distiller

本地优先的游戏操作录像蒸馏工作台：把《燕云十六声》操作录像提炼为分层操作序列 IR，及其派生的文档与脚本。

## Language

### 五层体系

**Operation（操作，L0）**:
单个输入动作（tap / hold / chord / wheel / wait）。视频里看不见键盘，L0 是分析师基于键位知识做的**推断**。
_Avoid_: 按键事件（那是 L0 的事件流表示，见 Event）

**Skill（技能，L1）**:
单次技能释放，对应一段可直接观察的动画；其 pattern 全部是原始输入 op（可多步）。
_Avoid_: 招式、法术

**Combo（连招，L2）**:
L1 片段的组合（pattern 含至少一个 skill 引用，可杂糅 L0 操作）。与 Skill 共用同一数据实体，层级由 pattern 内容决定。
_Avoid_: 连击、combo chain

**Rotation（循环，L3）**:
从多个 Analysis 归纳出的可参数化重复序列。属于 Project（知识），不属于任何单个视频。
_Avoid_: 手法循环、loop

**Playbook（方案，L4）**:
多个循环与序列拼接成的完整打法。属于 Project。
_Avoid_: profile、打法档案

### 标注与测量

**Analysis（分析）**:
对一个视频在一个 Keymap 假设下的标注全集。命名 `video-1_km-mage-v3_a1`；序号 `aN` 仅在人主动另起一遍重标时递增。
_Avoid_: 标注工程、session

**Lane（泳道）**:
Analysis 内每层一条的标注通道（L0 / L1 / L2）。

**Take**:
同一泳道的一次独立标注过程，即一次独立测量。多 Take 聚合产出稳健时序与不确定度。
_Avoid_: 版本、遍

**Mark（标记）**:
Take 内的一条标注，point（单时刻）或 span（起止区间）。L0 的 hold span 由"点标记 + holding 勾选"物化而来。

**Release mark（空标记）**:
不带键的点标记，充当 hold 间隔的终点，自身不产生任何操作。
_Avoid_: 松开事件（那是 L0 事件流的 key_up）

**Segment（片段）**:
分析作用范围选择器，圈定 Agent 分析与导出处理的时间区间。与 Lane 是兄弟关系，不拥有标记。
_Avoid_: 剪辑、clip

**打表 marker**:
独立于 IR 的纯测量草稿点，用于量间隔，可随时清空。
_Avoid_: 标记（与 Mark 混淆）

### 游戏知识

**Skill Catalog（技能目录）**:
游戏知识库：技能/连招定义及其时序常量（cd_ms / cast_ms / anim_ms）。与键位无关，边标注边沉淀。

**Keymap（键位）**:
职业级的技能 → 输入模式映射，带版本。对他人录像而言是分析师的**假设**，因此由 Analysis 钉住具体版本。
_Avoid_: profile、按键设置

**Pattern**:
技能/连招的输入模式描述，六种 op（tap / hold / chord / wheel / gap / skill(ref)），可递归。

### 加工与产出

**IR**:
唯一的中心资产。视频是它的证据，脚本是它的投影；系统永远不反向解析脚本。

**Event（事件）**:
L0 的原子表示（key_down / key_up / mouse_down / mouse_up / wheel），注入执行器的消费格式。严格原子，不支持组合。

**Proposal（提案）**:
Agent 的产出形态。以块级 diff 呈现，人逐块裁决后才写入 IR，附确定性匹配器的验证报告。

**Note（笔记）**:
人写的说明，独立于 IR 主体存储，可锚定到任意元素或时间区间。

**Provenance（来源）**:
每个 IR 元素的出处标记（human_manual / human_edited / human_authored / agent / execution_log）。

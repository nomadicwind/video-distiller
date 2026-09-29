import type { PatternItem } from '../api/types'

/**
 * PatternBuilder 的块模型（M14 任务 3）：只覆盖 tap/gap/hold 三种 op——
 * skill 引用（L2 连招）与 chord/wheel 仍走「高级：JSON」，见
 * validate_pattern（backend/src/vd/store.py）的完整 op 语法权威定义。
 */
export type Block =
  | { op: 'tap'; key: string }
  | { op: 'gap'; ms: number; tol_ms?: number }
  | { op: 'hold'; key?: string; button?: string; ms?: number; tol_ms?: number }

/** 块 -> pattern：字段名与 PatternItem 一致，直接展开即可。 */
export function blocksToPattern(blocks: Block[]): PatternItem[] {
  return blocks.map(b => ({ ...b }))
}

/**
 * pattern -> 块：仅当整条 pattern 全部由 tap/gap/hold 且字段满足
 * validate_pattern 的必填约束时才 `supported:true`——任何 skill/chord/wheel
 * 引用或字段缺失都整体退回 JSON 高级模式（不做部分转换，半个 pattern 在
 * 块视图里编辑不出所以然）。
 */
export function patternToBlocks(
  pattern: PatternItem[],
): { supported: true; blocks: Block[] } | { supported: false } {
  const blocks: Block[] = []
  for (const item of pattern) {
    if (item.op === 'tap') {
      if (!item.key || item.tol_ms !== undefined) return { supported: false }
      blocks.push({ op: 'tap', key: item.key })
    } else if (item.op === 'gap') {
      if (item.ms == null) return { supported: false }
      blocks.push({ op: 'gap', ms: item.ms, ...(item.tol_ms !== undefined ? { tol_ms: item.tol_ms } : {}) })
    } else if (item.op === 'hold') {
      if (!item.key && !item.button) return { supported: false }
      blocks.push({
        op: 'hold',
        ...(item.key !== undefined ? { key: item.key } : {}),
        ...(item.button !== undefined ? { button: item.button } : {}),
        ...(item.ms !== undefined ? { ms: item.ms } : {}),
        ...(item.tol_ms !== undefined ? { tol_ms: item.tol_ms } : {}),
      })
    } else {
      return { supported: false }
    }
  }
  return { supported: true, blocks }
}

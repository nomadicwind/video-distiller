/** 推断就绪引导卡（M14 任务 3）：键位表对 L0 标签集合的覆盖度。
 * `binds` 是 keymap.binds（skillId -> 键位字符串数组），一个 L0 标签只要
 * 出现在任意一个技能的绑定列表里就算覆盖——不关心具体覆盖它的是哪个技能。 */
export function coverageOf(
  labels: string[],
  binds: Record<string, string[]>,
): { covered: string[]; uncovered: string[] } {
  const boundKeys = new Set(Object.values(binds).flat())
  const covered: string[] = []
  const uncovered: string[] = []
  for (const label of new Set(labels)) {
    (boundKeys.has(label) ? covered : uncovered).push(label)
  }
  return { covered, uncovered }
}

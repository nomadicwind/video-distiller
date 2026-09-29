/** 键位绑定表重复技能检测（M14 任务 3）：同一 skill_id 出现在多行时，保存
 * 会按行序覆盖（后行胜），这里只负责找出哪些 skill_id 重复，UI 层据此画
 * 非阻塞警告条——不阻止保存，只是提醒。 */
export function findDuplicateBinds(rows: { skill_id: string; keys: string }[]): string[] {
  const seen = new Set<string>()
  const dup = new Set<string>()
  for (const r of rows) {
    if (!r.skill_id) continue
    if (seen.has(r.skill_id)) dup.add(r.skill_id)
    seen.add(r.skill_id)
  }
  return [...dup]
}

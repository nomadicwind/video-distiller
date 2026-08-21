import type { Proposal, Rotation } from './types'

/**
 * 错误降噪（修复清单 #8，M5 复查修复 #2 扩展）：LLM 失败时后端把原始异常/
 * 鉴权拒绝文本塞进 note 字段（backend/src/vd/api.py 的 discover 与 compose
 * 端点同构但字段名不同）——playbook 提案有明确的 report.fallback；rotation
 * 提案没有专门字段，但命名失败时 name 必定回退为「未命名循环」，accept_proposal
 * 落库后 Rotation.name 原样带着这个回退值。两者互斥且足够可靠地标出“这条
 * note 其实是错误串，别当正文渲染”——InferPanel（提案列表）与 PlaybooksPage
 * （已接受的循环表）共用同一判据，避免两处各写一份、日后走样。
 */
const UNNAMED_ROTATION = '未命名循环'

/** Proposal（InferPanel 待裁决列表）是否为 LLM 降级产物。 */
export const isDegradedProposal = (p: Proposal): boolean =>
  p.kind === 'playbook' ? !!p.report.fallback : p.payload.name === UNNAMED_ROTATION

/** 已接受的 Rotation（PlaybooksPage 循环表）是否为 LLM 降级产物。 */
export const isDegradedRotation = (r: Pick<Rotation, 'name'>): boolean =>
  r.name === UNNAMED_ROTATION

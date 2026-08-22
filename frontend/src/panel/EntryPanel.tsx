import { api } from '../api/client'
import { currentTake, useSession } from '../state/store'
import { Button } from '../ui/Button'
import { Switch } from '../ui/Switch'
import { MarkList } from './MarkList'

export function EntryPanel() {
  const s = useSession()
  const lane = s.analysis?.lanes.find(l => l.id === s.laneId)
  const take = currentTake(s)

  if (!s.analysis || !lane) return null

  return (
    <div className="entry-panel">
      {/* M9 任务 3：泳道卡整块移除——时间轴沟槽（Timeline 的轨道点击区）已经
          承担了泳道选择与状态显示，这里再画一遍是纯重复。s.laneId 仍是双向
          同步的单一状态源，只是选择的入口收敛到时间轴一侧。 */}

      {/* Take 段：chip 行 + 新 Take ghost + 聚合叠加 Switch（A 热键提示）。 */}
      <div className="take-row">
        <div className="take-chips">
          {lane.takes.map(t => (
            <button
              key={t.id}
              type="button"
              className={`take-chip${t.id === s.takeId ? ' is-current' : ''}`}
              onClick={() => s.selectTake(t.id)}
            >
              #{t.idx}
            </button>
          ))}
          <Button variant="ghost" size="sm" onClick={async () => {
            const created = await api.newTake(lane.id)
            s.addTakeLocal(lane.id, created)
          }}>+ 新 Take</Button>
        </div>
        <Switch
          checked={s.showAggregate}
          onChange={s.toggleAggregate}
          label={<>聚合叠加<span className="hotkey-hint">A</span></>}
        />
      </div>

      {/* M10 任务 1：打点区块（keycap 网格/空标记/录入 Switch/L1-L2 技能
          输入）整体迁移到 timeline/EntryStrip.tsx，挂载在时间轴 Toolbar 与
          画布之间（见 Timeline.tsx）；本面板只剩 take 行 + 标记列表。 */}

      {/* M9 任务 3：面板主体——当前泳道当前 take 的标记列表，占满剩余高度
          自行滚动（.mark-list 的 flex:1/overflow-y:auto，见 styles.css）。 */}
      <MarkList lane={lane} take={take} />
    </div>
  )
}

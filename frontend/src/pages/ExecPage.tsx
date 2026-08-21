import { useEffect, useRef, useState } from 'react';
import { Pause, Play, Square, StepForward } from 'lucide-react';
import { api } from '../api/client';
import type { ExecState, ExecStatus, Playbook, Rotation, Video } from '../api/types';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Field } from '../ui/Field';

const STATE_BADGE: Record<ExecState, 'neutral' | 'accent' | 'warn' | 'danger' | 'success'> = {
  idle: 'neutral',
  running: 'accent',
  paused: 'warn',
  stopped: 'danger',
  done: 'success',
};

const STATE_LABEL: Record<ExecState, string> = {
  idle: '空闲',
  running: '执行中',
  paused: '已暂停',
  stopped: '已停止',
  done: '已完成',
};

export function ExecPage({ onBack }: { onBack: () => void }) {
  void onBack; // TopBar 导航已常驻，页内不再自带 ← 返回（spec §7）
  const [rotations, setRotations] = useState<Rotation[]>([]);
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [kind, setKind] = useState<'rotation' | 'playbook'>('playbook');
  const [targetId, setTargetId] = useState('');
  const [analysisId, setAnalysisId] = useState('');
  const [st, setSt] = useState<ExecStatus>({ state: 'idle' });
  const [videoAnalysisMap, setVideoAnalysisMap] = useState<Record<string, string>>({});
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    void api.listRotations().then(setRotations);
    void api.listPlaybooks().then(setPlaybooks);
    void api.listVideos().then(setVideos);
  }, []);

  // Load analysis IDs for all videos
  useEffect(() => {
    const loadAnalysisIds = async () => {
      const map: Record<string, string> = {};
      for (const v of videos) {
        const analyses = await api.listAnalyses(v.id);
        if (analyses.length > 0) {
          map[v.id] = analyses[0].id;
        }
      }
      setVideoAnalysisMap(map);
    };
    if (videos.length > 0) {
      void loadAnalysisIds();
    }
  }, [videos]);

  useEffect(() => {
    if (st.state !== 'running') return;
    const id = window.setInterval(() => {
      void api.execStatus().then(setSt);
    }, 500);
    return () => window.clearInterval(id);
  }, [st.state]);

  // 新行自动滚底（spec §7：.log-view 新行到达时滚动到最底）
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [st.log]);

  const options = kind === 'rotation' ? rotations : playbooks;
  const running = st.state === 'running' || st.state === 'paused';
  const finished = st.state === 'stopped' || st.state === 'done';
  const pct = st.total ? Math.min(100, Math.max(0, ((st.cursor ?? 0) / st.total) * 100)) : 0;
  const hasWarnings = (st.warnings && st.warnings.length > 0) || (st.manual_loops && st.manual_loops.length > 0);

  return (
    <div className="page">
      <div className="page-head">
        <h1>执行台</h1>
        <p className="page-sub">
          仅执行不判断成败；F12 全局急停（Windows）。macOS 上仅 Mock/演练。
        </p>
      </div>

      <Card title="执行目标">
        <div className="exec-target-row">
          <Field label="类型">
            <select value={kind}
              onChange={e => { setKind(e.target.value as 'rotation' | 'playbook'); setTargetId(''); }}>
              <option value="playbook">方案</option>
              <option value="rotation">循环</option>
            </select>
          </Field>
          <Field label="目标">
            <select value={targetId} onChange={e => setTargetId(e.target.value)}>
              <option value="">选择目标…</option>
              {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </Field>
        </div>
        <p className="form-hint">
          循环（L3）为单一动作序列的重复执行；方案（L4）为多段编排的完整流程。
        </p>
      </Card>

      <div className="exec-controls">
        <Button variant="primary" icon={<Play />} disabled={!targetId || running}
          onClick={() => void api.startExec(kind, targetId).then(setSt)}>
          开始
        </Button>
        <Button variant="ghost" icon={<Pause />} disabled={st.state !== 'running'}
          onClick={() => void api.execCmd('pause').then(setSt)}>
          暂停
        </Button>
        <Button variant="ghost" icon={<Play />} disabled={st.state !== 'paused'}
          onClick={() => void api.execCmd('resume').then(setSt)}>
          继续
        </Button>
        <Button variant="ghost" icon={<StepForward />} disabled={!(st.state === 'idle' || st.state === 'paused') || !targetId}
          onClick={() => void (st.state === 'idle'
            ? api.startExec(kind, targetId, 1.0, true).then(() => api.execCmd('step')).then(setSt)
            : api.execCmd('step').then(setSt))}>
          单步
        </Button>
        <Button variant="danger" icon={<Square />} disabled={!running}
          onClick={() => void api.execCmd('stop').then(setSt)}>
          停止
        </Button>
      </div>

      <Card title="状态">
        <div className="exec-status-row">
          <Badge kind={STATE_BADGE[st.state]}>{STATE_LABEL[st.state]}</Badge>
          {st.total != null && <span className="mono exec-status-count">{st.cursor}/{st.total}</span>}
        </div>
        {st.total != null && (
          <div className="progress-bar exec-progress">
            <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
          </div>
        )}
      </Card>

      {st.error && (
        <Card title="错误" accent="var(--danger)">
          <p className="exec-error-text">{st.error}</p>
        </Card>
      )}

      {hasWarnings && (
        <Card title="警告" accent="var(--warn)">
          <div className="exec-warn-list">
            {st.warnings?.map((w, i) => <p key={`w-${i}`} className="exec-warn-item">⚠ {w}</p>)}
            {st.manual_loops?.map((m, i) => <p key={`m-${i}`} className="exec-warn-item">⚠ {m}</p>)}
          </div>
        </Card>
      )}

      {st.log && st.log.length > 0 && (
        <Card title="日志">
          <pre className="log-view" ref={logRef}>
            {st.log.map(l => `${String(l.t_ms).padStart(6)}ms  ${l.action} ${l.key}`).join('\n')}
          </pre>
        </Card>
      )}

      {finished && (
        <Card title="回灌为 Take">
          <div className="exec-backfeed-row">
            <Field label="选择视频的分析">
              <select value={analysisId} onChange={e => setAnalysisId(e.target.value)}>
                <option value="">选择视频的分析…</option>
                {videos.map(v => (
                  <option key={v.id} value={videoAnalysisMap[v.id] ?? ''}>{v.name}</option>
                ))}
              </select>
            </Field>
            <Button variant="primary" disabled={!analysisId}
              onClick={() => void api.backfeedExec(analysisId).then(() => setSt({ state: 'idle' }))}>
              回灌
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

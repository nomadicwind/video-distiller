import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { ExecStatus, Playbook, Rotation, Video } from '../api/types';

export function ExecPage({ onBack }: { onBack: () => void }) {
  const [rotations, setRotations] = useState<Rotation[]>([]);
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [kind, setKind] = useState<'rotation' | 'playbook'>('playbook');
  const [targetId, setTargetId] = useState('');
  const [analysisId, setAnalysisId] = useState('');
  const [st, setSt] = useState<ExecStatus>({ state: 'idle' });
  const [videoAnalysisMap, setVideoAnalysisMap] = useState<Record<string, string>>({});

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

  const options = kind === 'rotation' ? rotations : playbooks;
  const running = st.state === 'running' || st.state === 'paused';
  const finished = st.state === 'stopped' || st.state === 'done';

  return (
    <div className="library">
      <p><button onClick={onBack}>← 返回</button></p>
      <h1>执行台</h1>
      <p style={{ color: '#888' }}>
        仅执行不判断成败；F12 全局急停（Windows）。macOS 上仅 Mock/演练。
      </p>
      <p>
        <select value={kind}
                onChange={e => { setKind(e.target.value as 'rotation' | 'playbook'); setTargetId(''); }}>
          <option value="playbook">方案</option>
          <option value="rotation">循环</option>
        </select>{' '}
        <select value={targetId} onChange={e => setTargetId(e.target.value)}>
          <option value="">选择目标…</option>
          {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>{' '}
        <button disabled={!targetId || running}
                onClick={() => void api.startExec(kind, targetId).then(setSt)}>
          开始
        </button>{' '}
        <button disabled={st.state !== 'running'}
                onClick={() => void api.execCmd('pause').then(setSt)}>暂停</button>{' '}
        <button disabled={st.state !== 'paused'}
                onClick={() => void api.execCmd('resume').then(setSt)}>继续</button>{' '}
        <button disabled={!(st.state === 'idle' || st.state === 'paused') || !targetId}
                onClick={() => void (st.state === 'idle'
                  ? api.startExec(kind, targetId, 1.0, true).then(() => api.execCmd('step')).then(setSt)
                  : api.execCmd('step').then(setSt))}>单步</button>{' '}
        <button disabled={!running}
                onClick={() => void api.execCmd('stop').then(setSt)}>停止</button>
      </p>
      <p>
        状态：{st.state}
        {st.total != null && <> · {st.cursor}/{st.total}</>}
        {st.error && <span style={{ color: '#c33' }}> · {st.error}</span>}
      </p>
      {((st.warnings && st.warnings.length > 0) || (st.manual_loops && st.manual_loops.length > 0)) && (
        <div style={{ color: '#c90' }}>
          {st.warnings?.map((w, i) => <p key={`w-${i}`} style={{ margin: '2px 0' }}>⚠ {w}</p>)}
          {st.manual_loops?.map((m, i) => <p key={`m-${i}`} style={{ margin: '2px 0' }}>⚠ {m}</p>)}
        </div>
      )}
      {st.log && st.log.length > 0 && (
        <pre style={{ maxHeight: 200, overflow: 'auto' }}>
          {st.log.map(l => `${String(l.t_ms).padStart(6)}ms  ${l.action} ${l.key}`).join('\n')}
        </pre>
      )}
      {finished && (
        <p>
          回灌为 Take：{' '}
          <select value={analysisId} onChange={e => setAnalysisId(e.target.value)}>
            <option value="">选择视频的分析…</option>
            {videos.map(v => (
              <option key={v.id} value={videoAnalysisMap[v.id] ?? ''}>{v.name}</option>
            ))}
          </select>{' '}
          <button disabled={!analysisId}
                  onClick={() => void api.backfeedExec(analysisId).then(() => setSt({ state: 'idle' }))}>
            回灌
          </button>
        </p>
      )}
    </div>
  );
}

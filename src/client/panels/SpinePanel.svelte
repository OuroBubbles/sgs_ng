<script lang="ts">
  import { onMount } from 'svelte';
  import type { SpineLab, SpineMetrics } from '../presentation/spine-lab';
  import { observeVisibility } from '../../platform/lifecycle';

  const { onclose }: { onclose: () => void } = $props();
  let host: HTMLDivElement;
  let dialog: HTMLDialogElement;
  let lab: SpineLab | null = null;
  let ready: Promise<void> = Promise.resolve();
  let loaded = $state(false);
  let closing = $state(false);
  let error = $state('');
  let count = $state<1 | 8>(1);
  let paused = $state(false);
  let visible = true;
  let animation = $state<'walk' | 'run'>('walk');
  let metrics = $state<SpineMetrics>({
    instances: 0,
    frames: 0,
    p95: 0,
    fps: 0,
    paused: false,
    animation: 'walk',
  });

  onMount(() => {
    dialog.showModal();
    ready = import('../presentation/spine-lab')
      .then(async ({ SpineLab }) => {
        lab = new SpineLab();
        await lab.mount(host, (value) => {
          metrics = value;
        });
        lab.setPaused(paused || !visible);
        loaded = true;
      })
      .catch((cause: unknown) => {
        error = cause instanceof Error ? cause.message : String(cause);
      });
    const unsubscribe = observeVisibility((active) => {
      visible = active;
      lab?.setPaused(paused || !visible);
    });
    return () => {
      unsubscribe();
      ready
        .then(() => lab?.destroy())
        .catch((cause: unknown) => {
          console.error('Spine cleanup failed', cause);
        });
    };
  });

  function setCount(value: 1 | 8) {
    count = value;
    lab?.setCount(value);
  }

  function setPaused() {
    paused = !paused;
    lab?.setPaused(paused || !visible);
  }

  function setAnimation() {
    animation = animation === 'walk' ? 'run' : 'walk';
    lab?.setAnimation(animation);
  }

  async function close() {
    if (closing) return;
    closing = true;
    await ready;
    await lab?.destroy();
    dialog.close();
    onclose();
  }

  function exportMetrics() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            capturedAt: new Date().toISOString(),
            userAgent: navigator.userAgent,
            viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
            ...metrics,
            note: '浏览器帧间隔采样，不代表 Android 真机或 GPU 基准。',
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sgs-ng-spine-metrics.json';
    link.click();
    URL.revokeObjectURL(url);
  }
</script>

<div class="modal-backdrop">
  <dialog
    class="spine-panel"
    bind:this={dialog}
    aria-labelledby="spine-title"
    oncancel={(event) => {
      event.preventDefault();
      close().catch(console.error);
    }}
  >
    <header class="panel-heading">
      <div>
        <span class="eyebrow">MOTION STUDY / 01</span>
        <h2 id="spine-title">骨骼动画验证</h2>
      </div>
      <button
        class="icon-button"
        aria-label="关闭动画验证"
        disabled={closing}
        onclick={() => close().catch(console.error)}>×</button
      >
    </header>
    <p class="panel-intro">Spine 4.2 · WebGL · 官方 Spineboy 样本</p>
    <div class="spine-stage" bind:this={host} data-testid="spine-stage">
      {#if !loaded && !error}<span class="loading-label">正在加载骨骼与图集…</span>{/if}
      {#if error}<p class="error-message">动画加载失败：{error}</p>{/if}
    </div>
    <div class="lab-toolbar">
      <div class="segmented" aria-label="骨骼实例数量">
        <button class:active={count === 1} disabled={!loaded} onclick={() => setCount(1)}
          >1 个实例</button
        >
        <button class:active={count === 8} disabled={!loaded} onclick={() => setCount(8)}
          >8 个实例</button
        >
      </div>
      <button class="subtle-button" disabled={!loaded} onclick={setAnimation}
        >{animation === 'walk' ? '切换奔跑' : '切换行走'}</button
      >
      <button class="subtle-button" disabled={!loaded} onclick={setPaused}
        >{paused ? '继续动画' : '暂停动画'}</button
      >
    </div>
    <div class="metric-grid" aria-live="off">
      <div><strong data-testid="spine-count">{metrics.instances}</strong><span>骨骼实例</span></div>
      <div><strong data-testid="spine-frames">{metrics.frames}</strong><span>采样帧数</span></div>
      <div><strong>{metrics.fps.toFixed(0)}<small> fps</small></strong><span>平均帧率</span></div>
      <div><strong>{metrics.p95.toFixed(1)}<small> ms</small></strong><span>p95 帧间隔</span></div>
    </div>
    <footer class="lab-footer">
      <span>样本用于验证运行时，正式美术另行制作。</span><button
        class="text-button"
        onclick={exportMetrics}>导出采样 ↗</button
      >
    </footer>
  </dialog>
</div>

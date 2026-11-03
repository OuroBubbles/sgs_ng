<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { GameView } from '../../core/view/game';
  import type { TableLayout } from './layout';

  const {
    view,
    layout,
    targets,
    active,
    baseline = 0,
  }: {
    view: GameView;
    layout: TableLayout | null;
    targets: readonly string[];
    active: boolean;
    baseline?: number;
  } = $props();
  type Route = {
    readonly seq: number;
    readonly actor: string;
    readonly targets: readonly string[];
  };
  let effects = $state<readonly Route[]>([]);
  let seen = untrack(() => baseline);
  // 句柄只用于资源回收，不参与模板或派生值的响应式依赖。
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  const id = $props.id();
  const routes = $derived([
    ...effects,
    ...(view.viewer && targets.length ? [{ seq: 0, actor: view.viewer, targets }] : []),
  ]);

  function clear() {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  }

  $effect(() => {
    const fresh = view.actions.filter(
      (action) => action.seq > seen && action.targets.length && action.kind === 'use',
    );
    seen = Math.max(seen, ...view.actions.map((action) => action.seq));
    const enabled = active;
    untrack(() => {
      if (!enabled) {
        clear();
        effects = [];
        return;
      }
      if (!fresh.length) return;
      effects = [...effects, ...fresh].slice(-8);
      for (const [seq, timer] of timers)
        if (!effects.some((effect) => effect.seq === seq)) {
          clearTimeout(timer);
          timers.delete(seq);
        }
      for (const action of fresh)
        timers.set(
          action.seq,
          setTimeout(() => {
            effects = effects.filter((effect) => effect.seq !== action.seq);
            timers.delete(action.seq);
          }, 700),
        );
    });
  });
  onDestroy(clear);

  function point(player: string) {
    return layout?.seats[view.players.findIndex((item) => item.id === player)];
  }
</script>

<!-- FreeKill IndicatorLine：6px 淡外层、3px 金色内层，200ms 伸展、200ms 停留、300ms 淡出。 -->
{#if layout}<svg
    class="target-lines"
    viewBox={`0 0 ${layout.width} ${layout.height}`}
    aria-hidden="true"
  >
    {#each routes as route (route.seq)}
      {@const start = point(route.actor)}
      {#each route.targets as target, i (`${route.seq}:${target}`)}
        {@const end = point(target)}
        {#if start && end && target !== route.actor}
          {@const distance = Math.hypot(end.x - start.x, end.y - start.y)}
          {@const angle = (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI}
          <defs>
            <linearGradient
              id={`${id}-${route.seq}-${i}-outer`}
              gradientUnits="userSpaceOnUse"
              x1="0"
              y1="0"
              x2={distance}
              y2="0"
              ><stop stop-color="white" stop-opacity="0" /><stop
                offset="1"
                stop-color="#c8c8c8"
                stop-opacity="0.12"
              /></linearGradient
            >
            <linearGradient
              id={`${id}-${route.seq}-${i}-inner`}
              gradientUnits="userSpaceOnUse"
              x1="0"
              y1="0"
              x2={distance}
              y2="0"
              ><stop stop-color="white" stop-opacity="0" /><stop
                offset="1"
                stop-color="#e1de5c"
              /></linearGradient
            >
          </defs>
          <g
            class:committed={route.seq > 0}
            data-action-seq={route.seq}
            transform={`translate(${start.x} ${start.y}) rotate(${angle})`}
          >
            <g class="ray">
              <line
                x1="0"
                y1="0"
                x2={distance}
                y2="0"
                stroke={`url(#${id}-${route.seq}-${i}-outer)`}
                stroke-width="6"
              />
              <line
                x1="0"
                y1="0"
                x2={distance}
                y2="0"
                stroke={`url(#${id}-${route.seq}-${i}-inner)`}
                stroke-width="3"
              />
            </g>
          </g>
        {/if}
      {/each}
    {/each}
  </svg>{/if}

<style>
  .target-lines {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 1;
    overflow: visible;
  }
  line {
    stroke-linecap: butt;
  }
  .committed {
    animation: fade 300ms cubic-bezier(0.895, 0.03, 0.685, 0.22) 400ms both;
  }
  /* 缩放局部坐标中的线及渐变：明亮端点跟随伸展，避免擦出固定渐变。 */
  .committed .ray {
    transform-origin: 0 0;
    animation: extend 200ms cubic-bezier(0.215, 0.61, 0.355, 1) both;
  }
  @keyframes extend {
    from {
      transform: scaleX(0);
    }
    to {
      transform: scaleX(1);
    }
  }
  @keyframes fade {
    from {
      opacity: 1;
    }
    to {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .committed,
    .committed .ray {
      animation-duration: 1ms;
    }
  }
</style>

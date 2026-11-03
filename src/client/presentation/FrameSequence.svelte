<script lang="ts">
  const { frames, animated = true }: { frames: readonly string[]; animated?: boolean } = $props();
  let index = $state(0);

  // 只切换当前图片，不重绘牌桌；停止或卸载时释放计时器。
  $effect(() => {
    const count = frames.length;
    if (!animated || count < 2) return;
    const timer = setInterval(() => {
      index = (index + 1) % count;
    }, 50);
    return () => clearInterval(timer);
  });
</script>

{#if frames.length}<img src={frames[index]} alt="" aria-hidden="true" />{/if}

<style>
  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    pointer-events: none;
  }
</style>

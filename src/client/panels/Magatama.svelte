<script lang="ts">
  import { untrack } from 'svelte';
  import { skinImage } from '../presentation/skin';

  const { value, animated }: { value: number; animated: boolean } = $props();
  let image: HTMLImageElement | undefined = $state();
  let previous = untrack(() => value);

  $effect(() => {
    const next = value;
    const enabled = animated;
    const element = image;
    const before = previous;
    previous = next;
    if (
      !enabled ||
      !element ||
      Boolean(before) === Boolean(next) ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;

    // FreeKill Magatama：空满切换时在 1/4 倍间过渡。变换只活在动画中，
    // 完成后不留下不可见的放大图元；暂停、状态改变或卸载均取消当前动画。
    const empty = { opacity: 0, transform: 'scale(4)' };
    const full = { opacity: 1, transform: 'scale(1)' };
    const animation = element.animate(next ? [empty, full] : [full, empty], { duration: 150 });
    return () => animation.cancel();
  });
</script>

<span class="magatama" aria-hidden="true">
  <img src={skinImage('ui/hp/0.png')} alt="" />
  <img
    bind:this={image}
    class="filled"
    class:empty={value === 0}
    src={skinImage(`ui/hp/${value}.png`)}
    alt=""
  />
</span>

<style>
  .magatama {
    position: relative;
    display: block;
    width: 19.7647px;
    height: 18.6667px;
  }
  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .filled {
    position: absolute;
    inset: 0;
  }
  .empty {
    opacity: 0;
  }
</style>

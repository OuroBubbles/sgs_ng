<script lang="ts">
  import type { SeatView } from '../../core/view/game';
  import { roleImage } from '../presentation/skin';
  import Magatama from './Magatama.svelte';

  const { player, index, animated }: { player: SeatView; index: number; animated: boolean } =
    $props();
  const numeric = $derived(
    player.maxHp > 4 || player.hp > player.maxHp || (player.shield > 0 && player.maxHp > 3),
  );
  const hpColor = $derived(
    player.hp >= 3 || player.hp >= player.maxHp ? 3 : Math.max(0, player.hp),
  );
</script>

<!-- 按 FreeKill Photo 的 175×233 原图组织，由面板统一等比缩放。 -->
<span class="seat-status" class:dead={!player.alive} aria-hidden="true">
  <span class="seat-name" title={player.title || player.name}>{player.title || player.name}</span>
  <span class="seat-role" title={player.role ?? '身份未知'}>
    <img src={roleImage(player.role)} alt="" /><span class="sr-only">{player.role ?? '未知'}</span>
  </span>
  <span class="seat-hand" title="手牌数量"><b>{player.handCount}</b></span>
  <span class="seat-vitals">
    {#if player.alive && player.shield > 0}<span class="seat-effect shield" title="护盾"
        >{player.shield}</span
      >{/if}
    <span
      class="health-pips"
      class:numeric
      style:color={['#f4180e', '#f4180e', '#e3b006', '#25ec27'][hpColor]}
    >
      {#if numeric}
        <Magatama value={hpColor} {animated} />
        <span class="hp-value">{player.hp}<i>/</i>{player.maxHp}</span>
      {:else}
        {#each Array.from({ length: player.maxHp }, (_, i) => i) as i (i)}
          <Magatama value={i < player.maxHp - player.hp ? 0 : hpColor} {animated} />
        {/each}
      {/if}
    </span>
    <span class="seat-health sr-only">{player.hp}/{player.maxHp}</span>
    <span class="seat-gender sr-only">{player.gender}</span>
  </span>
  {#if player.alive && player.chained}<span class="seat-effect chain" title="连环"
      ><span class="sr-only">连环</span></span
    >{/if}
  {#if !player.alive}<img class="death-seal" src={roleImage(player.role, true)} alt="" />{/if}
  {#if player.self}<span class="seat-you">你</span>{/if}
  <span class="seat-number"
    >{['一', '二', '三', '四', '五', '六', '七', '八'][index] ?? index + 1}</span
  >
</span>

<style>
  .seat-status {
    position: absolute;
    inset: 0;
    pointer-events: none;
    color: white;
    font-family: var(--fk-name);
    text-shadow:
      0 1px 3px #000,
      0 0 2px #000;
  }
  .seat-status img {
    display: block;
  }
  .seat-name {
    position: absolute;
    left: 6.6667px;
    top: 28px;
    width: 24px;
    writing-mode: vertical-rl;
    text-orientation: upright;
    font-size: 21.3333px;
    line-height: 0.875;
    text-align: center;
    white-space: nowrap;
  }
  .seat-role {
    position: absolute;
    right: -5.3333px;
    top: -5.3333px;
    width: 42.6667px;
    height: 46.6667px;
  }
  .seat-role img {
    width: 100%;
    height: 100%;
  }
  .seat-hand {
    position: absolute;
    left: -6.6667px;
    bottom: -6.6667px;
    width: 53.3333px;
    height: 40px;
    background: url('../../assets/freekill/ui/photo/handcard.png') center / contain no-repeat;
    display: grid;
    place-items: center;
    padding-bottom: 3px;
    font-size: 32px;
    line-height: 1;
  }
  .seat-hand b {
    font-weight: 400;
  }
  .seat-vitals {
    position: absolute;
    left: 8px;
    bottom: 36px;
    width: 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .health-pips {
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .health-pips.numeric {
    gap: 0;
    color: #25ec27;
  }
  .hp-value {
    display: flex;
    flex-direction: column;
    align-items: center;
    font-size: 21.3333px;
    line-height: 0.95;
  }
  .hp-value i {
    height: 12px;
    font-size: 18px;
    transform: rotate(40deg);
  }
  .shield {
    display: grid;
    place-items: center;
    width: 20px;
    height: 21.3333px;
    background: url('../../assets/freekill/ui/hp/shield.png') center / contain no-repeat;
    font-size: 20px;
  }
  .chain {
    position: absolute;
    top: 72px;
    left: 30px;
    width: 140px;
    height: 54px;
    background: url('../../assets/freekill/ui/photo/chain.png') center / contain no-repeat;
  }
  .death-seal {
    position: absolute;
    left: 31px;
    top: 55px;
    width: 137px;
    height: 135px;
    object-fit: contain;
  }
  .seat-you {
    position: absolute;
    left: 150px;
    top: 200px;
    font-size: 14px;
    opacity: 0.9;
  }
  .seat-number {
    position: absolute;
    left: 0;
    bottom: -32px;
    width: 175px;
    text-align: center;
    font: 32px var(--fk-button);
    text-shadow:
      0 0 5px #522b10,
      0 1px 2px black;
  }
  .dead {
    filter: grayscale(1);
  }
</style>

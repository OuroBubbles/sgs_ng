<script lang="ts">
  import { onMount } from 'svelte';
  const {
    name,
    turn,
    extra,
    onconfirm,
  }: { name: string; turn: boolean; extra: boolean; onconfirm: () => void } = $props();
  let dialog: HTMLDialogElement;
  onMount(() => {
    dialog.showModal();
  });
</script>

<dialog
  class="seat-curtain"
  bind:this={dialog}
  aria-labelledby="handoff-title"
  oncancel={(event) => event.preventDefault()}
>
  <span class="eyebrow">LOCAL TABLE / PASS THE DEVICE</span>
  <span class="curtain-seal" aria-hidden="true">弈</span>
  <h2 id="handoff-title">请交给 <strong>{name}</strong></h2>
  <p>
    {turn ? (extra ? '额外回合即将开始。' : '新回合即将开始。') : '有一个选择需要你决定。'}<br
    />请其他玩家移开视线，再查看自己的手牌。
  </p>
  <button class="confirm-button" onclick={onconfirm}>我是{name}，查看手牌</button>
</dialog>

<style>
  dialog {
    width: min(480px, calc(100vw - 32px));
    max-height: calc(100dvh - 30px);
    overflow-y: auto;
    color: var(--text);
    background: radial-gradient(ellipse at top, #2a4130, #162a22);
    border: 1px solid #98845277;
    border-radius: 8px;
    padding: 38px 30px;
    text-align: center;
    box-shadow: 0 30px 100px #0008;
  }
  dialog::backdrop {
    background: #0c1916f5;
    backdrop-filter: blur(14px);
  }
  .curtain-seal {
    display: block;
    margin: 25px auto 17px;
    font: 60px var(--serif);
    color: #bc9c63;
  }
  h2 {
    font: 25px var(--serif);
    font-weight: 400;
    color: #c9cdb4;
    letter-spacing: 3px;
  }
  h2 strong {
    color: #e3c68a;
    font-weight: 400;
  }
  p {
    font-size: 11px;
    color: #9eaf93;
    line-height: 2;
    margin-bottom: 25px;
  }
  @media (max-height: 500px) {
    dialog {
      padding: 20px;
    }
    .curtain-seal {
      margin: 10px;
      font-size: 35px;
    }
    h2 {
      margin: 10px;
    }
    p {
      margin: 10px 0;
    }
  }
</style>

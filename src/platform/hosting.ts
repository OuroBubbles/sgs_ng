import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { RoomSetup } from '../app/network/setup';

export interface HostedRoom {
  readonly port: number;
  readonly local: string;
  readonly addresses: readonly { readonly name: string; readonly address: string }[];
  readonly setup: RoomSetup;
}

export interface HostingState {
  readonly supported: boolean;
  readonly revision: number;
  readonly busy: boolean;
  readonly room: HostedRoom | null;
  readonly error: string;
}

export const unavailableHosting: HostingState = {
  supported: false,
  revision: 0,
  busy: false,
  room: null,
  error: '',
};

/** 先订阅再读取，按原生 revision 隔离迟到的初始状态；浏览器仍可加入远端房间。 */
export async function observeHosting(changed: (state: HostingState) => void): Promise<() => void> {
  if (!isTauri()) {
    changed(unavailableHosting);
    return () => {};
  }
  let revision = -1;
  const apply = (state: HostingState) => {
    if (state.revision <= revision) return;
    revision = state.revision;
    changed(state);
  };
  let off = () => {};
  try {
    off = await listen<HostingState>('desktop-host-changed', (event) => apply(event.payload));
    apply(await invoke<HostingState>('hosting_status'));
  } catch {
    // 尚无主持能力的平台不显示创建入口；远端客户端路径不受影响。
    off();
    changed(unavailableHosting);
    return () => {};
  }
  return off;
}

export async function createDesktopRoom(port: number, setup: RoomSetup): Promise<HostedRoom> {
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error('房间端口应为 0–65535 的整数。');
  return invoke<HostedRoom>('start_host', {
    port,
    setup: { ...setup, lineup: [...setup.lineup] },
  });
}

export async function closeDesktopRoom(): Promise<void> {
  await invoke('stop_host');
}

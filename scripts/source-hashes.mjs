// Bun 预加载（见 bunfig.toml）：宿主直接跑源码，握手哈希按当前源码树计算，
// 与 Vite/vitest 构建期 define 注入的同名常量一致。
import { protocolHash } from './network-build.mjs';

globalThis.__SGS_PROTOCOL_HASH__ = protocolHash();

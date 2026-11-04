import type { BuildHello } from './wire';

declare const __SGS_PROTOCOL_HASH__: string;

/** 协议契约哈希；握手强制相等只比较此项。 */
export const protocolHash = __SGS_PROTOCOL_HASH__;

export const buildMismatch = '客户端与主持端的协议构建不一致，请使用同一份构建后重新加入。';

/** 握手帧：protocol 强制相等；主持端另附 contentHash（见 ServerMessage）。 */
export function helloPayload<T extends object = object>(extra?: T): BuildHello & T {
  return { kind: 'hello', protocol: protocolHash, ...(extra as T) };
}

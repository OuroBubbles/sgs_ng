import type { BuildHello } from './wire';

declare const __SGS_PROTOCOL_HASH__: string;
declare const __SGS_CONTENT_HASH__: string;

/** 协议契约哈希；握手强制相等只比较此项。 */
export const protocolHash = __SGS_PROTOCOL_HASH__;

/** 内容树哈希；hello 携带，客户端不强求同内容代码。 */
export const contentHash = __SGS_CONTENT_HASH__;

export const buildMismatch = '客户端与主持端的协议构建不一致，请使用同一份构建后重新加入。';

/** 握手帧：protocol 强制相等；content 仅记录。 */
export function helloPayload<T extends object = object>(extra?: T): BuildHello & T {
  return { kind: 'hello', protocol: protocolHash, content: contentHash, ...(extra as T) };
}

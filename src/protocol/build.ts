import type { RemoteAsset } from './wire';

declare const __SGS_PROTOCOL_HASH__: string;
declare const __SGS_CONTENT_HASH__: string;

/** 协议契约哈希；握手强制相等只比较此项。 */
export const protocolHash = __SGS_PROTOCOL_HASH__;

/** 内容树哈希；hello 携带，客户端不强求同内容代码。 */
export const contentHash = __SGS_CONTENT_HASH__;

/**
 * 历史字段兼容：等于 protocolHash。新代码请用 protocolHash / contentHash。
 */
export const networkBuild = protocolHash;

export const buildMismatch = '客户端与主持端的协议构建不一致，请使用同一份构建后重新加入。';

/** 握手帧：protocol 强制相等；content 仅记录；build 双写 protocol。 */
export function helloPayload(
  extra: { readonly resume?: string; readonly assets?: readonly RemoteAsset[] } = {},
) {
  return {
    kind: 'hello' as const,
    protocol: protocolHash,
    content: contentHash,
    build: protocolHash,
    ...extra,
  };
}

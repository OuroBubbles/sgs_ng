declare const __SGS_NETWORK_BUILD__: string;

/** 构建时注入；不能用可忘记更新的应用版本号替代源代码和资源一致性。 */
export const networkBuild = __SGS_NETWORK_BUILD__;

export const buildMismatch = '客户端与主持端的规则或资源构建不一致，请使用同一份构建后重新加入。';

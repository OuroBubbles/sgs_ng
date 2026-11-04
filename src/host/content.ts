import { createContent } from '../content/catalog';
import type { ContentCatalog, ContentDefinition } from '../content/catalog';
import { contentTree } from './content-tree';
import { loadContent } from './load-content';
import { RoleMatch } from './role-match';

/** 主持端启动时发现的内容包（标准包在前）；新增武将/技能文件后重启主持端即生效。 */
export const { packs, hash: contentHash } = await loadContent(await contentTree());
export const defaultContent = createContent(
  ...packs.filter((pack) => !pack.practice).map((pack) => pack.definition),
);
/** 机制演武在常规包之外再启用 practice 包；开关只选择内容。 */
export const practiceContent = createContent(...packs.map((pack) => pack.definition));
export const seatNames = ['甲席', '乙席', '丙席', '丁席', '戊席', '己席', '庚席', '辛席'];

/** 指定阵容时由其长度决定席位；练习局也可只指定人数，不保存另一份可矛盾的数量。 */
export type RoleMatchSetup = {
  readonly seed?: number;
  readonly preset?: string;
  readonly content?: ContentDefinition | ContentCatalog;
} & (
  | { readonly lineup: readonly string[]; readonly count?: never }
  | { readonly count?: number; readonly lineup?: never }
);

/** 默认规则直接从源码装配；普通配置按需填写，无位置占位或分发参与。 */
export function createRoleMatch(options: RoleMatchSetup = {}): RoleMatch {
  const { seed = 42, preset = 'standard:identity', content = defaultContent, lineup } = options;
  const count = lineup?.length ?? options.count ?? 4;
  return new RoleMatch({
    id: 'local',
    seed,
    players: Array.from({ length: count }, (_, i) => ({
      id: seatNames[i]!,
      ...(lineup
        ? { general: lineup[i]! }
        : {
            gender: i % 2 === 0 ? ('male' as const) : ('female' as const),
            ...(i === 0 ? { skills: ['standard:wusheng'] } : {}),
          }),
    })),
    deck: preset,
    content,
  });
}

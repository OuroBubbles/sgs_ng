import type { ContentCatalog } from '../content/catalog';
import type { ContentSummary, HostCatalog } from '../protocol';
import { defaultContent, practiceContent, seatNames } from './content';

/** 大厅只需展示字段；技能说明取自实际装配，不另维护一份文案。 */
export function summarizeContent(content: ContentCatalog): ContentSummary {
  const { skills } = content.createBooks();
  return {
    cards: content.cards.length,
    decks: content.decks.map(({ id, label }) => ({ id, label })),
    generals: content.generals.map((general) => {
      const portrait = content.generalViews[general.id]?.portrait;
      return {
        id: general.id,
        name: general.name,
        kingdom: general.kingdom,
        maxHp: general.maxHp,
        ...(portrait ? { portrait } : {}),
        skills: general.skills.map((id) => {
          const skill = skills.definition(id);
          return {
            id,
            name: skill.name,
            lord: Boolean(skill.lord),
            description: skill.description ?? '',
          };
        }),
      };
    }),
  };
}

let catalog: HostCatalog | null = null;

/** 主持端内置内容的大厅目录；首次请求时生成并缓存。 */
export function hostCatalog(): HostCatalog {
  catalog ??= {
    seats: seatNames,
    standard: summarizeContent(defaultContent),
    practice: summarizeContent(practiceContent),
  };
  return catalog;
}

import type { ContentDefinition } from '../catalog';
import { standardCards } from './cards';
import { standardGenerals, standardGeneralSkills } from './generals';
import { createStandardDeck } from './deck';
import { mechanicsDeck } from './practice-deck';
import { standardCardViews } from './presentation';
import { standardGeneralViews } from './portraits';
import { luoyiAftereffect } from './wei';

export default {
  cards: standardCards,
  skills: standardGeneralSkills,
  effects: [luoyiAftereffect],
  generals: standardGenerals,
  cardViews: standardCardViews,
  generalViews: standardGeneralViews,
  decks: [
    { id: 'standard:identity', label: '标准＋EX（108 张）', create: createStandardDeck },
    { id: 'standard:mechanics', label: '机制练习（288 张）', create: mechanicsDeck },
  ],
} satisfies ContentDefinition;

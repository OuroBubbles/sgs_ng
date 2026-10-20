import { definePackage } from '../package';
import { standardCards } from './cards';
import { standardGenerals, standardGeneralSkills } from './generals';
import { createStandardDeck } from './deck';
import { mechanicsDeck } from './practice-deck';
import { standardCardViews } from './presentation';
import { standardGeneralViews } from './portraits';

export default definePackage({
  manifest: { id: 'standard', name: '标准＋EX', version: '0.1.20' },
  cards: standardCards,
  skills: standardGeneralSkills,
  generals: standardGenerals,
  cardViews: standardCardViews,
  generalViews: standardGeneralViews,
  decks: [
    { id: 'standard:identity', label: '标准＋EX（108 张）', create: createStandardDeck },
    { id: 'standard:mechanics', label: '机制练习（288 张）', create: mechanicsDeck },
  ],
});

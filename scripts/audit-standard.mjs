import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { collectStandardCatalogue, walk, literal, at } from './standard-catalogue.mjs';

// 显式调用才读取本地参考；只解析文本，不加载/执行参考项目，也不据此宣称行为通过。
const root = fileURLToPath(new URL('../', import.meta.url));
const inputs = new Map();
function read(file) {
  if (!inputs.has(file)) {
    const bytes = readFileSync(resolve(root, file));
    inputs.set(file, {
      text: bytes.toString('utf8'),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  return inputs.get(file).text;
}
function parse(file) {
  return ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
}
function translations(file, lua = false) {
  const result = new Map();
  if (lua) {
    for (const match of read(file).matchAll(/^\s*\["([^"\n]+)"\]\s*=\s*"((?:\\.|[^"\\])*)"/gm))
      result.set(match[1], {
        text: match[2],
        file,
        line: read(file).slice(0, match.index).split('\n').length,
      });
  } else {
    const source = parse(file);
    walk(source, (node) => {
      if (ts.isPropertyAssignment(node) && literal(node.initializer) !== null)
        result.set(node.name.getText(source).replace(/^['"]|['"]$/g, ''), {
          text: literal(node.initializer),
          ...at(file, source, node),
        });
    });
  }
  return result;
}

const { skills, cards, generals, definitions } = collectStandardCatalogue(
  read,
  readdirSync(resolve(root, 'src/content/standard'))
    .filter((name) => name.endsWith('.ts'))
    .sort(),
);

const fkSkills = translations('../freekill/packages/standard/i18n/zh_CN.lua', true);
const fkCards = translations('../freekill/packages/standard_cards/i18n/zh_CN.lua', true);
const nmSkills = translations('../noname/resources/app/character/standard/translate.js');
const nmCards = translations('../noname/resources/app/card/standard.js');
const aliases = {
  slash: 'sha',
  jink: 'shan',
  peach: 'tao',
  duel: 'juedou',
  ex_nihilo: 'wuzhong',
  nullification: 'wuxie',
  savage_assault: 'nanman',
  archery_attack: 'wanjian',
  god_salvation: 'taoyuan',
  amazing_grace: 'wugu',
  snatch: 'shunshou',
  dismantlement: 'guohe',
  collateral: 'jiedao',
  indulgence: 'lebu',
  lightning: 'shandian',
  crossbow: 'zhuge',
  double_swords: 'cixiong',
  qinggang_sword: 'qinggang',
  blade: 'qinglong',
  spear: 'zhangba',
  axe: 'guanshi',
  halberd: 'fangtian',
  kylin_bow: 'qilin',
  ice_sword: 'hanbing',
  eight_diagram: 'bagua',
  nioh_shield: 'renwang',
  chitu: 'chitu',
  dayuan: 'dawan',
  zixing: 'zixin',
  jueying: 'jueying',
  dilu: 'dilu',
  zhuahuangfeidian: 'zhuahuang',
};
function reference(entry, card) {
  const id = entry.id.slice('standard:'.length);
  const name = card ? aliases[id] : id === 'tieqi' ? 'tieji' : id;
  const freeKill = (card ? fkCards : fkSkills).get(`:${id}`);
  const noname = (card ? nmCards : nmSkills).get(`${name}_info`);
  if (!freeKill || !noname) throw new Error(`Missing literal reference text: ${entry.id}`);
  if (card && !definitions.has(entry.id))
    throw new Error(`Missing static card definition: ${entry.id}`);
  const fkRule = `../freekill/packages/${card ? 'standard_cards' : 'standard'}/pkg/skills/${id}.lua`;
  const nmRule = `../noname/resources/app/${card ? 'card/standard.js' : 'character/standard/skill.js'}`;
  read(fkRule);
  read(nmRule);
  return {
    ...entry,
    ...(card ? { definition: definitions.get(entry.id) } : {}),
    freeKill: { ...freeKill, rule: fkRule },
    noname: { id: name, ...noname, rule: nmRule },
  };
}
const report = {
  capturedAt: new Date().toISOString(),
  kind: 'static-reference-inventory',
  behaviorVerified: false,
  generals,
  skills: [...skills.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((entry) => reference(entry, false)),
  cards: [...cards.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((entry) => reference(entry, true)),
  inputs: [...inputs].map(([file, input]) => ({ file, sha256: input.sha256 })),
};
const output = resolve(root, '.artifacts/validation/standard-semantics-inventory.json');
mkdirSync(resolve(root, '.artifacts/validation'), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(
  `Static reference inventory: ${generals.length} generals, ${skills.size} skills, ${cards.size} cards; ${inputs.size} hashed inputs.`,
);
console.log(
  `${output}\nText/source inventory only; semantic equivalence and branch coverage require review and behavior evidence.`,
);

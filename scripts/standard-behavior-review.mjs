import cardReviews from './standard-card-review.mjs';

// 人工核对的项目基线与具名断言；这里只登记证据，不生成游戏规则或自动推断覆盖率。
const test = (file, name) => ({ file: `tests/scenarios/${file}.test.ts`, name });
const clause = (id, requirement, ...evidence) => ({ id, requirement, evidence });
const material = (skill, recipe) => [
  test(
    'standard-authoring-baseline',
    `${skill}/${recipe} 恰好一张本人合法手牌，数量/牌面/归属和打出用途分别校验`,
  ),
  test('standard-authoring-baseline', `${skill}/${recipe} 装备区域材料按本技能边界处理`),
];
const once = (name) =>
  ['recreate', 'disable-enable', 'additional-source'].map((change) =>
    test(
      'skill-identity',
      `${name}支付后${change}不刷新本阶段次数；新阶段仍可再次发动且原后效完整结束`,
    ),
  );

const reviewedActiveSkills = [
  {
    id: 'standard:wusheng',
    description: '将一张红色手牌或装备牌当杀使用或打出；沿用杀的距离、次数与目标条件。',
    clauses: [
      clause(
        'materials',
        '一张本人红色手牌/装备，拒绝其他数量/归属/颜色，允许打出',
        ...material('wusheng', 'red-slash'),
      ),
      clause(
        'use',
        '真实转换保留花色点数与材料，受距离/目标限制并接受闪',
        test('view-as', '武圣仅转换红色材料，牌名/距离/目标/响应复用普通杀管线'),
        test('view-as', '装备区红色材料也能转换，不受固定手牌入口限制'),
      ),
      clause(
        'response-and-face',
        '真实供牌保留武圣来源；读取当前颜色，杀阶段额度仍经过原管线',
        test('benevolence', '激将保留供牌者的wusheng转换和全部材料来源'),
        test('card-faces', '过滤后的黑桃可作为 武圣 的红色材料，转换继承当前花色/颜色'),
        test(
          'standard-authoring-baseline',
          'wusheng 实际授予后保留杀的距离/自身目标/完整闪使用，阶段额度按该技能分别生效',
        ),
      ),
    ],
  },
  {
    id: 'standard:longdan',
    description: '可以将一张杀当闪使用或打出，或将一张闪当杀使用或打出。',
    clauses: [
      clause(
        'recipes',
        '杀/闪两个配方各仅一张本人手牌，装备不能扩张材料范围，均允许使用/打出',
        ...material('longdan', 'jink-slash'),
        ...material('longdan', 'slash-jink'),
      ),
      clause(
        'use-and-response',
        '真实闪作杀及杀作闪保留牌面，使用闪不误记打出',
        test('martial-generals', '龙胆将闪当杀沿用原花色点数、材料和伤害管线'),
        test('martial-generals', '龙胆响应时杀可当闪，不能直接以实体杀响应闪，不能冒用对方的材料'),
      ),
      clause(
        'limits',
        '不绕过杀距离/次数，失去技能使旧配方失效',
        test('martial-generals', '龙胆不绕过杀的距离与阶段次数，失去技能后旧配方立即不可用'),
      ),
    ],
  },
  {
    id: 'standard:paoxiao',
    description: '锁定技，你使用杀没有次数限制。距离、目标与响应条件不变。',
    clauses: [
      clause(
        'usage',
        '连续用杀仍累计次数，失去技能后恢复已累计上限，新阶段重置',
        test(
          'martial-generals',
          '咆哮允许连续用杀但仍累计次数，失去后恢复已累计的上限，新阶段独立重置',
        ),
      ),
      clause(
        'other-rules',
        '实际授予咆哮时距离/目标/完整闪响应仍生效，只解除杀额度',
        test(
          'standard-authoring-baseline',
          'paoxiao 实际授予后保留杀的距离/自身目标/完整闪使用，阶段额度按该技能分别生效',
        ),
      ),
    ],
  },
  {
    id: 'standard:qixi',
    description: '可以将一张黑色手牌或装备牌当过河拆桥使用。',
    clauses: [
      clause(
        'materials',
        '一张本人黑色手牌/装备，只能作为使用，数量/归属/牌面重查',
        ...material('qixi', 'black-dismantlement'),
      ),
      clause(
        'payment',
        '转换材料不是自弃费用，装备离场触发枭姬；目标弃置仍检查权限',
        test(
          'martial-generals',
          '奇袭可以使用受自弃禁止的黑色装备作材料，仍触发枭姬，目标弃牌另查目标权限',
        ),
      ),
      clause(
        'live-ownership',
        '红牌和已经交出的旧材料不支付',
        test('martial-generals', '奇袭拒绝红色牌和已交出的旧材料，不复制一次选择时的持有权'),
      ),
    ],
  },
  {
    id: 'standard:qingguo',
    description: '可以将一张黑色手牌当闪使用或打出。装备区的牌不能作为材料。',
    clauses: [
      clause(
        'materials',
        '一张本人黑色手牌，拒绝装备/红牌/他人材料；允许使用和打出',
        ...material('qingguo', 'black-jink'),
        test(
          'wei-generals',
          '倾国可用黑色手牌响应闪，拒绝红牌、装备和他人的牌，并沿用材料花色点数',
        ),
      ),
      clause(
        'purpose-and-face',
        '抵消杀时实际使用闪，读取当前颜色而不借用印刷黑色',
        test('response-purpose', '真实倾国按使用用途转换黑色杀为闪，使用后效归本人且不提交打出'),
        test('card-faces', '过滤后的黑桃不再提供 倾国 的黑色配方'),
      ),
    ],
  },
  {
    id: 'standard:guose',
    description: '可以将一张方块手牌或装备牌当乐不思蜀使用。',
    clauses: [
      clause(
        'materials',
        '一张本人方块手牌/装备，其他数量/花色/归属及打出用途拒绝',
        ...material('guose', 'diamond-indulgence'),
        test('tacticians', '国色拒绝非方块和他人材料，不改变材料位置'),
      ),
      clause(
        'delayed',
        '两种区域的材料进入独立持久延时区，保留牌面且禁止同名叠放',
        test('tacticians', '国色的方块 hand 进入持久延时区，保留牌面并防同名叠放'),
        test('tacticians', '国色的方块 equipment 进入持久延时区，保留牌面并防同名叠放'),
      ),
      clause(
        'current-face',
        '材料花色读取当前牌面过滤',
        test('card-faces', '过滤花色供国色，过滤名称供实体杀与龙胆，仍走正式牌型/材料校验'),
      ),
    ],
  },
  {
    id: 'standard:jijiu',
    description:
      '你的回合外，你可以将一张红色手牌或装备牌当桃使用。救援属于使用牌，不能将急救当作普通打出。',
    clauses: [
      clause(
        'materials-purpose',
        '一张本人当前红色手牌/装备，只能使用不能打出',
        ...material('jijiu', 'red-peach'),
        test('card-faces', '过滤后的黑桃可作为 急救 的红色材料，转换继承当前花色/颜色'),
      ),
      clause(
        'rescue',
        '手牌和装备实际救援，保留使用归属',
        test('benevolence', '急救回合外红色hand当桃，走真实救援和用牌，不能当普通打出'),
        test('benevolence', '急救回合外红色equipment当桃，走真实救援和用牌，不能当普通打出'),
      ),
      clause(
        'ordinary-use',
        '没有本人回合时，规则可完整使用急救桃自疗，并非仅能救援',
        test(
          'standard-authoring-baseline',
          '急救在无本人回合的规则使用中可用红牌自疗，仍是实际使用桃',
        ),
      ),
      clause(
        'turn-and-ban',
        '本人正常/额外回合不生效，黑色材料与使用桃禁令不能绕过',
        test('benevolence', '急救在本人normal回合不可用，不能用红牌救别人'),
        test('benevolence', '急救在本人extra回合不可用，不能用红牌救别人'),
        test('benevolence', '急救不能选择黑色材料，回合外仍完整检查使用桃禁令'),
      ),
    ],
  },
  {
    id: 'standard:kurou',
    description:
      '出牌阶段，你可以失去 1 点体力，然后摸两张牌。不限次数；濒死时先完成救援，存活才摸牌。',
    clauses: [
      clause(
        'action',
        '本人出牌阶段零材料可反复发动，失去体力后摸二',
        test('active-skills', '零牌也提供苦肉；同一阶段可反复发动，失去体力与摸牌都由领域流程提交'),
      ),
      clause(
        'eligibility',
        '他人/失效技能/非本人阶段/关闭阶段不能发动',
        test(
          'active-skills',
          '不能发动他人技能、失效技能、非当前阶段或已关闭阶段；纯候选不执行写入',
        ),
      ),
      clause(
        'dying',
        '一血先救援，获救再摸二，死亡不摸',
        test('active-skills', '苦肉一血进入濒死，救援成功后才摸两张；死亡后不摸'),
      ),
    ],
  },
  {
    id: 'standard:jieyin',
    description:
      '出牌阶段限一次，弃置两张手牌，令一名受伤的其他男性角色和你各回复 1 点体力。你无需处于受伤状态。',
    clauses: [
      clause(
        'choice',
        '两张手牌，受伤其他男性/双性男性；自己/女性/装备拒绝，取消不支付',
        test('active-skills', '结姻取消不支付；拒绝装备、自己和女性目标，双性男性分支可选'),
      ),
      clause(
        'effect',
        '费用/次数/宣告同次提交，目标先回复本人后回复；本人无需受伤',
        test('active-skills', '结姻费用、次数和宣告同次提交；回复先目标后本人，一阶段不能再次发动'),
        test('active-skills', '结姻不要求本人受伤，下一独立出牌阶段重新获得次数'),
      ),
      clause(
        'phase-identity',
        '来源重建/启停/追加不刷新本阶段次数，新阶段可再次发动',
        ...once('结姻'),
      ),
      clause(
        'committed',
        '失去技能不撤销宣告；目标死亡费用保留，本人按当前状态回复',
        test(
          'active-skills',
          '结姻支付后目标死亡仍消耗次数，本人按当前状态回复；技能失去不撤销已宣告效果',
        ),
      ),
    ],
  },
  {
    id: 'standard:rende',
    description:
      '出牌阶段，你可以将至少一张手牌交给一名其他角色，可以多次分配。本阶段以此法给出的手牌首次累计达到两张后，你回复 1 点体力。交牌不是弃牌。',
    clauses: [
      clause(
        'choice',
        '至少一张本人手牌交给其他角色，取消/装备/他人牌/自己目标不支付',
        test('benevolence', '仁德取消不付费，装备/他人牌/自己目标均非法；重新选择可正常发动'),
      ),
      clause(
        'threshold',
        '多次分配与累计同次提交；首次跨过二张回复一次，满体力也消耗门槛',
        test('benevolence', '仁德分批交给不同角色，累计跨过两张时只回复一次，交牌和累计原子可见'),
        test('benevolence', '仁德满体力跨过两张也消耗首次门槛，随后受伤再给牌不补发回复'),
      ),
      clause(
        'lifetime',
        '失去再获得不刷新累计，重复出牌阶段独立',
        test('benevolence', '仁德计数不因支付后失去并重获技能重置，重复出牌阶段各有独立门槛'),
      ),
      clause(
        'movement',
        '转交不是弃牌，已转交牌随接收者死亡正常埋葬',
        test('benevolence', '仁德转交不受弃置禁令约束，目标死亡后已转交牌照常埋葬'),
      ),
    ],
  },
  {
    id: 'standard:qingnang',
    description:
      '出牌阶段限一次，你可以弃置一张手牌，令一名已受伤的角色回复 1 点体力，可以选择自己。',
    clauses: [
      clause(
        'choice',
        '一张可弃手牌治疗受伤角色含自己，无受伤目标不提供动作',
        test('benevolence', '青囊可以治疗自己，取消不占次数，成功后本阶段不能再发动'),
        test('benevolence', '青囊只弃手牌且受弃置权限约束，无受伤目标时不显示动作'),
      ),
      clause(
        'phase-identity',
        '本阶段限一次，来源重建/启停/追加不刷新，新阶段重置',
        ...once('青囊'),
      ),
      clause(
        'committed',
        '宣告后费用保留，失去技能或来源死亡仍按目标当前存活治疗',
        ...['lost', 'source-dead', 'target-dead'].map((kind) =>
          test('benevolence', `青囊宣告后不撤销费用，按目标当前存活结算：${kind}`),
        ),
      ),
    ],
  },
  {
    id: 'standard:zhiheng',
    description:
      '出牌阶段限一次，你可以弃置至少一张手牌或装备牌，然后摸等量的牌。标准版制衡不额外奖励弃光手牌。',
    clauses: [
      clause(
        'choice',
        '至少一张可弃手牌/装备；同批弃置后按实际费用数摸牌，弃光不加摸',
        test('wu-generals', '制衡手牌/装备同批弃置，后效后按实际费用数量摸牌，一阶段一次'),
        test('wu-generals', '制衡取消不计次数，禁止弃置牌不可作为费用'),
      ),
      clause(
        'phase-identity',
        '本阶段限一次，来源重建/启停/追加不刷新，新阶段重置',
        ...once('制衡'),
      ),
      clause(
        'committed',
        '失去技能不撤销已付效果，死亡停止摸牌',
        test('wu-generals', '制衡支付后失去技能仍摸牌，死亡则停止：lost'),
        test('wu-generals', '制衡支付后失去技能仍摸牌，死亡则停止：dead'),
      ),
    ],
  },
  {
    id: 'standard:fanjian',
    description:
      '出牌阶段限一次，令一名其他角色猜一种花色，再正面朝上获得你的一张手牌。若花色不同，你对其造成一点伤害。手牌由目标暗选。',
    clauses: [
      clause(
        'choice',
        '其他角色先猜花色再暗选；四种猜测都先公开转交再比较花色',
        ...['spade', 'heart', 'club', 'diamond'].map((suit) =>
          test('intrigue', `反间猜 ${suit}，目标暗选后公开获得手牌，先移牌再比较花色`),
        ),
        test('intrigue', '反间的目标界面只收到暗选项，交牌后才公开牌面与准确的展示事实序号'),
      ),
      clause(
        'phase-identity',
        '取消不计次，无手牌不能发动；来源重建/启停/追加不刷新次数',
        test('intrigue', '反间取消不消耗次数，空手或只有装备时不能发动'),
        ...once('反间'),
      ),
      clause(
        'current-face',
        '交牌不是弃牌；移牌后效先结束，再按接收后的当前花色比较',
        test('intrigue', '反间交牌不是弃牌；连营等移牌后效在猜错伤害前完成'),
        test('card-faces', '反间按接收后的当前花色比较：未过滤黑桃交给映绯角色，猜红桃不受伤'),
      ),
      clause(
        'committed',
        '宣告后失去技能/交牌后来源死亡不撤销猜错伤害；手牌先被取走不伪造新牌',
        test('intrigue', '已宣告反间失去技能仍执行，移动后来源死亡也不撤销猜错伤害'),
        test('intrigue', '反间支付后手牌被取走，不生成假牌或多问一次花色，次数仍消耗'),
      ),
    ],
  },
  {
    id: 'standard:lijian',
    description:
      '出牌阶段限一次，弃置一张手牌或装备，选择两名其他男性角色。后选角色视为对先选角色使用一张不能被无懈可击的决斗。',
    clauses: [
      clause(
        'choice',
        '一张手牌/装备、两名不同其他男性，按有序目标验证禁令',
        test('intrigue', '离间弃 hand，后选角色使用完整零材料决斗且禁止无懈'),
        test('intrigue', '离间弃 equipment，后选角色使用完整零材料决斗且禁止无懈'),
        test('intrigue', '离间按有序目标验证禁止使用与目标禁令，不接受女性、本人和重复目标'),
      ),
      clause(
        'phase-identity',
        '取消不计次，同阶段一次，新阶段可用，来源变化不重置',
        test('intrigue', '离间取消不计次、同阶段只支付一次，下一阶段重新可用'),
        ...once('离间'),
      ),
      clause(
        'real-use',
        '后选者完整使用不可无懈决斗，集智/无双及实际胜者伤害归属保留',
        test('intrigue', '离间的实际决斗者可触发集智，无双要求对方两杀，伤害仍归赢得决斗者'),
      ),
      clause(
        'committed',
        '已接受后失去技能/性别改变不撤销，最终禁令仍重查，费用不退',
        test('intrigue', '离间接受后失去技能或性别改变不撤销，最终决斗禁令仍重查且费用不退'),
      ),
    ],
  },
  {
    id: 'standard:liuli',
    description:
      '当你成为杀的目标时，可以弃置一张手牌或装备，将此杀转移给你攻击范围内的一名其他角色（不能是出杀者）。弃置的装备不再提供范围。',
    clauses: [
      clause(
        'choice',
        '一张可弃手牌/装备，排除本人/出杀者/被禁止/已在本次杀中的目标',
        test('tacticians', '流离不能给本人、出杀者、被禁止或已在本次杀内的目标'),
      ),
      clause(
        'range',
        '按流离者范围判断，已作为费用离场的武器/进攻坐骑不提供范围',
        test('tacticians', '流离弃 weapon 后不能借用离场装备的范围，联合反馈可先选目标'),
        test('tacticians', '流离弃 horse 后不能借用离场装备的范围，联合反馈可先选目标'),
      ),
      clause(
        'atomic-target',
        '支付与目标替换同次提交，保留杀来源/材料，新身份四层独立且旧同窗停止',
        test('tacticians', '流离费用与目标替换原子提交，忽略出杀者距离，保留杀的来源与材料'),
        test(
          'target-window-boundaries',
          '真实流离支付并转移后，不再执行旧目标同窗的后席候选，新目标补齐四层',
        ),
      ),
      clause(
        'committed',
        '取消不支付，失去技能不撤销转移，目标死亡不退费用；新目标无双/防具继续有效',
        test('tacticians', '流离取消不支付，新目标独立确认并继承来源无双'),
        test('tacticians', '支付后失去流离不撤销转移，目标死亡则跳过，不退费用'),
        test('tacticians', '流离新目标的仁王盾仍生效，青釭剑规则仍随杀传递'),
      ),
    ],
  },
];

export default [
  ...cardReviews,
  ...reviewedActiveSkills,
  {
    id: 'standard:guanxing',
    description:
      '准备阶段，你可以观看牌堆顶 X 张牌（X 为存活角色数，至多 5），将任意张以任意顺序放回牌顶，其余以任意顺序置于牌底。',
    clauses: [
      clause(
        'timing-count',
        '仅本人未跳过的准备阶段，可拒绝，按存活人数取牌且至多五张',
        test('astrology', '诸葛亮初始化与观星数量按 2 人局存活人数计算，上限五张'),
        test('astrology', '诸葛亮初始化与观星数量按 8 人局存活人数计算，上限五张'),
        test('astrology', '观星计数排除阵亡席位，必选排序的非法重复回复不改变牌堆或支付次数'),
        test('astrology', '拒绝发动不取牌；跳过准备阶段与他人准备阶段均不询问'),
      ),
      clause(
        'order',
        '两组真实有序回顶/置底，可全选任一组；不算摸牌或手牌得失',
        test('astrology', '观星两组顺序真实移入同一牌堆，既不是摸牌也不产生手牌得失'),
        test('astrology', '观星允许全部置于 top，空组不吞牌不倒序'),
        test('astrology', '观星允许全部置于 bottom，空组不吞牌不倒序'),
      ),
      clause(
        'private-cleanup',
        '只向本人公开；缺牌/空堆可结束，中断归还实时余牌且不追回已转交牌',
        test('astrology', '观星可洗入弃牌，仍不足则使用实有牌；空牌堆无必选排序等待'),
        test('astrology', '排序请求和牌面只给本人，其他投影/AI 不知牌序；公开日志仅给上下数量'),
        test('astrology', '私有取牌的自定义善后在局部中止后归还实时余牌，已经转交的牌不重复移动'),
        test('astrology', '观星已宣告后 lost，私有余牌按领域规则回顶而非弃置'),
        test('astrology', '观星已宣告后 dead，私有余牌按领域规则回顶而非弃置'),
      ),
    ],
  },
  {
    id: 'standard:kongcheng',
    description: '锁定技，若你没有手牌，你不能成为杀或决斗的目标。装备不影响空城。',
    clauses: [
      clause(
        'scope',
        '只限制无手牌本人的杀/决斗目标；装备/私有池不充当手牌，其他牌/来源不受误伤',
        test('astrology', '空城只禁止空手角色成为杀/决斗目标，装备、私有池和响应资格分别处理'),
        test(
          'standard-trigger-baseline',
          'kongcheng 只禁止本人的指定牌名目标，不扩张到其他牌、其他角色或来源用牌',
        ),
      ),
      clause(
        'live-target',
        '目标确认后空手仍在效果开始前重查；已经开始的决斗正常完成',
        test('astrology', '空城目标确认后失去最后手牌，实际效果重查跳过；决斗已经开始则正常继续'),
      ),
    ],
  },
  {
    id: 'standard:jijiang',
    description:
      '主公技。当你需要使用或打出杀时，可以请求其他蜀势力角色依次替你打出杀。实际供牌者打出，使用杀时由你承担目标、距离和次数；本阶段请求失败后，不能再主动以激将使用杀。',
    clauses: [
      clause(
        'lord-and-supply',
        '身份模式授予主公技；蜀角色依行动序供杀，实际供牌打出与主公使用分别归属',
        test('standard-games', '标准二十五将统一初始化：目录字段、主公技能与体力奖励及事实重建'),
        test('benevolence', '激将由蜀角色打出、刘备使用：两种归属各一次，实际材料与来源可重建'),
        test('action-order', '激将依当前 b行动序供杀，真实打出者与使用者各自保留'),
        test('benevolence', '激将第一人放弃后询问下一人，只有实际供牌者支付'),
      ),
      clause(
        'recipes-and-purpose',
        '供牌可用武圣/龙胆/丈八；普通打出不伪造主公活动，区分打出与使用禁令',
        test('benevolence', '激将保留供牌者的wusheng转换和全部材料来源'),
        test('benevolence', '激将保留供牌者的longdan转换和全部材料来源'),
        test('benevolence', '激将保留供牌者的spear转换和全部材料来源'),
        test('benevolence', '激将普通打出请求走已有委托，不伪造刘备第二次用牌或打出'),
        test('benevolence', '激将检查供牌者的打出禁令，不混用其使用禁令：response'),
        test('benevolence', '激将检查供牌者的打出禁令，不混用其使用禁令：use'),
      ),
      clause(
        'failed-phase',
        '失败不耗杀额度，本阶段关闭主动配方但仍可自己响应，下阶段恢复',
        test('benevolence', '激将失败不消耗用杀次数，本阶段隐藏该用牌配方；下一阶段自动恢复'),
        test('benevolence', '本人出牌阶段激将打出失败后仍可自己响应，但本阶段不能再主动激将'),
      ),
      clause(
        'committed',
        '实际牌面重查目标，已付材料不追回或再向下一人收费；失去技能不撤销宣告',
        test(
          'benevolence',
          '激将以实际供牌牌面重新检查目标禁令，失败不宣告刘备用牌、不追回供牌费用',
        ),
        test('benevolence', '激将供牌已支付后失效，不继续收费下一个供牌者：moved'),
        test('benevolence', '激将供牌已支付后失效，不继续收费下一个供牌者：lord-dead'),
        test('benevolence', '激将已宣告后失去技能仍完成本次供牌和用杀'),
      ),
    ],
  },
  {
    id: 'standard:jianxiong',
    description:
      '受到一次伤害后，你可以获得造成此伤害的牌。其全部实体材料须仍在此次用牌的处理区中；没有实体材料的牌无法获得。',
    clauses: [
      clause(
        'once-materials',
        '每次伤害一次；只收取此次来源处理区中完整的非空实体材料，不重复取得群体牌',
        test(
          'commanders',
          '奸雄按一次伤害发动一次，移动后效已能看到取得事实；实牌不再被用牌清理弃置',
        ),
        test('commanders', '奸雄只取得完整虚拟牌实体材料，不把语义牌名写回实体：full'),
        test('commanders', '奸雄只取得完整虚拟牌实体材料，不把语义牌名写回实体：partial'),
        test('commanders', '奸雄只取得完整虚拟牌实体材料，不把语义牌名写回实体：empty'),
        test('commanders', '奸雄不从另一处理区追回材料，即使另一处理区尚未清理'),
        test('commanders', '奸雄取得群体牌后，后续目标依然结算，但不能重复取得已离开处理区的材料'),
      ),
      clause(
        'committed',
        '支付后失去技能不撤销；死亡或材料移走不强取',
        test('commanders', '奸雄支付后效重查材料和存活，失去技能不撤销已宣告效果：lost'),
        test('commanders', '奸雄支付后效重查材料和存活，失去技能不撤销已宣告效果：moved'),
        test('commanders', '奸雄支付后效重查材料和存活，失去技能不撤销已宣告效果：dead'),
      ),
    ],
  },
  {
    id: 'standard:hujia',
    description:
      '主公技。当你需要使用或打出闪时，可以令其他魏势力角色按座次依次选择是否替你打出闪。供牌者支付并结算打出后效，需要使用时再由你使用。',
    clauses: [
      clause(
        'order-and-faction',
        '身份模式仅授予主公，按实际行动序询问当前存活魏角色，不读秘密手牌预筛，也不递归护驾',
        test(
          'commanders',
          '曹操、张辽初始化当前势力，身份模式只为主公授予主公技；非主公仍能查看说明',
        ),
        test(
          'commanders',
          '护驾不读取手牌可用性，按座次先询问无闪魏角色，再由后一人支付；只结算一次打出',
        ),
        test('commanders', '护驾按当前回合角色起算的行动顺序委托，不固定从曹操之后起算'),
        test('commanders', '没有其他存活魏角色时不询问护驾，也不会依静态武将势力猜测'),
        test('commanders', '护驾委托不会再次发动供牌者的护驾；动态势力按每次委托前的当前值判断'),
      ),
      clause(
        'jink-only',
        '联合请求也只代打闪，可由倾国/龙胆/八卦供牌，拒绝或失败仍允许本人闪',
        test('commanders', '原请求允许杀或闪时，护驾委托仍只允许闪，不能误用供牌者的杀'),
        test('commanders', '护驾供牌者复用自己的转换或装备能力：qingguo'),
        test('commanders', '护驾供牌者复用自己的转换或装备能力：longdan'),
        test('commanders', '护驾供牌者复用自己的转换或装备能力：armor'),
        test('commanders', '护驾失败或不发动，仍可自己打闪：cancel'),
        test('commanders', '护驾失败或不发动，仍可自己打闪：none'),
      ),
      clause(
        'purpose-and-unique',
        '队友实际打出与主公实际使用各自校验；群体打出不制造主公使用，多层供牌只收末端一次',
        test('response-purpose', '真实护驾响应 slash：队友打出，只有杀请求还需主公完整使用'),
        test(
          'response-purpose',
          '真实护驾响应 archery_attack：队友打出，只有杀请求还需主公完整使用',
        ),
        test('response-purpose', '委托时主公禁止打出与队友禁止使用不会误伤正确的两种活动'),
        test('response-purpose', '实际代打者禁止打出时委托失败，主公仍可自行使用闪'),
        test('response-purpose', '两层委托仍只有末端 d 打出与原请求者 b 使用，候选不重复收费'),
      ),
      clause(
        'live-commit',
        '主公禁止使用时不诱导供牌；发动后重查，已完成供牌材料及完整使用不回滚',
        test('response-purpose', '主公禁止使用闪时不诱导护驾供牌或收取发动费用'),
        test('response-purpose', '护驾已发动后主公被禁止使用闪，供牌前再次检查并保留队友牌'),
        test(
          'response-purpose',
          '供牌完成后 prohibit 使主公不能继续使用：实际打出保留，材料不追回',
        ),
        test('response-purpose', '主公实际使用完成后死亡不撤销已提交使用与供牌结果，不重开请求'),
        test('commanders', '护驾支付后不重复检查技能持有，但重查本人和供牌者当前资格：lost'),
        test('commanders', '护驾支付后不重复检查技能持有，但重查本人和供牌者当前资格：faction'),
      ),
    ],
  },
  {
    id: 'standard:tuxi',
    description:
      '摸牌阶段开始时，你可以放弃默认摸牌，改为获得至多两名其他角色的各一张手牌。选择一至两人，按座次结算；这不是跳过摸牌阶段。',
    clauses: [
      clause(
        'replacement',
        '一至二名其他有手牌者，行动序暗选取得，不经摸牌或跳过阶段；取消/无目标正常摸牌',
        test(
          'commanders',
          '突袭选一至两名手牌目标，实际结算按座次，暗选不暴露实体身份且不经过摸牌',
        ),
        test('commanders', '突袭取消或无合法目标，正常摸两张：cancel'),
        test('commanders', '突袭取消或无合法目标，正常摸两张：empty'),
        test('commanders', '取牌不混用弃牌权限；无手牌而只有装备的角色不是突袭目标'),
      ),
      clause(
        'committed',
        '支付后替换阶段体不回滚；失去技能、目标空手/死亡或来源死亡不恢复默认摸牌',
        test('commanders', '突袭宣告后目标或来源变化不会恢复默认摸牌：lost'),
        test('commanders', '突袭宣告后目标或来源变化不会恢复默认摸牌：empty'),
        test('commanders', '突袭宣告后目标或来源变化不会恢复默认摸牌：dead-target'),
        test('commanders', '突袭宣告后目标或来源变化不会恢复默认摸牌：dead-source'),
      ),
    ],
  },
  {
    id: 'standard:xiaoji',
    description: '当你失去装备区里的一张牌后，你可以摸两张牌。一次失去多张时，逐张选择是否发动。',
    clauses: [
      clause(
        'occurrences',
        '按每张离场装备独立询问与摸二，可拒绝其中一次；同区重排不触发，失去技能停止后次',
        test('active-skills', '枭姬批量失去两件装备逐件询问，选择 true/true，独立支付与摸牌'),
        test('active-skills', '枭姬批量失去两件装备逐件询问，选择 false/true，独立支付与摸牌'),
        test('active-skills', '枭姬不会把装备区内部重排当作失去，首轮摸牌后失去技能会停止后续询问'),
      ),
      clause(
        'interleave',
        '各次机会可以与同窗连营交错，不封装成不可选顺序的整个循环',
        test('occurrences', '枭姬拒绝第一次后，能先连营再执行第二次；不会把两次发动封进一个循环'),
      ),
    ],
  },
  {
    id: 'standard:mashu',
    description: '锁定技，你计算与其他角色的距离时减一。',
    clauses: [
      clause(
        'distance',
        '只修正本人到他人的距离，与坐骑叠加；同技能多个来源不重复叠加',
        test('intrigue', '马术只修正来源到其他人的距离，与坐骑叠加且不重复授予叠加'),
      ),
    ],
  },
  {
    id: 'standard:tieqi',
    description:
      '当你指定杀的目标后，可以判定。若结果为红色，该角色不能以闪响应这次杀，八卦阵和护驾供闪也不能绕过。',
    clauses: [
      clause(
        'judge',
        '指定杀目标后可拒绝，依改判后的最终颜色；黑/空牌无禁令，宣告后失去技能继续',
        test('intrigue', '铁骑 red 判定只影响本次目标的响应'),
        test('intrigue', '铁骑 black 判定只影响本次目标的响应'),
        test('intrigue', '铁骑 decline 判定只影响本次目标的响应'),
        test('intrigue', '铁骑 empty 判定只影响本次目标的响应'),
        test('intrigue', '铁骑使用鬼才改判后的最终红色，技能失去不撤销已接受的判定效果'),
      ),
      clause(
        'effect-and-name',
        '逐目标独立，不泄漏至旧流离目标；禁止闪优先于无双，也不禁止同效果的其他牌名',
        test('intrigue', '铁骑分别判定多目标，红色禁响应优先于无双的最低次数'),
        test('intrigue', '流离先于铁骑，只对新目标询问判定，旧身份的响应禁令不泄漏'),
        test(
          'named-response-blocks',
          '红判铁骑只禁止本次效果的闪，不拦截作者在同效果下另行请求的杀',
        ),
      ),
    ],
  },
  {
    id: 'standard:yingzi',
    description: '摸牌阶段，你可以多摸一张牌。',
    clauses: [
      clause(
        'draw',
        '仅本人阶段摸牌，可接受/拒绝；增加一次显式计数，不误用普通技能摸牌',
        test('intrigue', '英姿接受=true，只修改这次阶段摸牌'),
        test('intrigue', '英姿接受=false，只修改这次阶段摸牌'),
        test('intrigue', '英姿不把阶段中的普通技能摸牌当作阶段摸牌'),
        test('standard-trigger-baseline', 'yingzi 不响应他人的对应阶段，也不响应本人的其他阶段'),
      ),
      clause(
        'live-count',
        '零张摸牌在英姿增至一后可被同窗裸衣少摸，后续候选读取最新值',
        test('occurrences', '零张阶段摸牌先发动英姿后，裸衣在同一窗口变为合法，角色可少摸这一张'),
      ),
    ],
  },
  {
    id: 'standard:biyue',
    description: '结束阶段，你可以摸一张牌。',
    clauses: [
      clause(
        'finish',
        '仅本人未跳过结束阶段，可接受/拒绝摸一；宣告后失去技能仍完成',
        test('intrigue', '闭月接受=true，结束阶段正常收束'),
        test('intrigue', '闭月接受=false，结束阶段正常收束'),
        test('intrigue', '跳过结束阶段不发动闭月，已接受后失去技能仍摸牌'),
        test('standard-trigger-baseline', 'biyue 不响应他人的对应阶段，也不响应本人的其他阶段'),
      ),
    ],
  },
  {
    id: 'standard:guicai',
    description:
      '一名角色的判定牌生效前，你可以打出一张手牌代替之。任意牌型均可，但须满足打出禁令。',
    clauses: [
      clause(
        'material',
        '仅一张本人手牌，任意牌型只受打出禁令，拒绝装备/他人/多张，取消无宣告',
        test('strategists', '鬼才可打出没有普通响应定义的桃；材料、旧牌、牌面与宣告同次提交'),
        test('strategists', '鬼才只受打出禁令影响，不混用使用或弃置权限：response'),
        test('strategists', '鬼才只受打出禁令影响，不混用使用或弃置权限：use'),
        test('strategists', '鬼才只受打出禁令影响，不混用使用或弃置权限：discard'),
        test('strategists', '鬼才取消不宣告；候选仅限本人手牌，拒绝装备、他人牌与多张材料'),
      ),
      clause(
        'atomic-and-face',
        '替换与宣告原子；多鬼才依判定角色顺序各一次，打出者当前牌面与判定者牌面分别保留',
        test(
          'strategists',
          '多个鬼才按判定角色锚点依次改判，后者看到实时新牌，每人只获得本次窗口的一次候选',
        ),
        test('strategists', '带宣告的底层改判在提交前拒绝失效费用，不留下半改判：lost-skill'),
        test('card-faces', '他人红颜式手牌用于鬼才，打出为红、被判定者无过滤则最终判定仍为黑'),
      ),
      clause(
        'committed',
        '宣告完成后改判者死亡或失去技能不回滚结果',
        test('strategists', '鬼才宣告后改判者死亡或失去技能不回滚新牌面'),
      ),
    ],
  },
  {
    id: 'standard:fankui',
    description:
      '受到一次伤害后，你可以获得伤害来源的一张手牌或装备。若伤害来源是你，只能选择装备。',
    clauses: [
      clause(
        'source-choice',
        '一次伤害一次，暗选来源一手牌/装备不泄漏；自伤只选装备，取牌不借用弃置权限',
        test('strategists', '反馈按一次伤害发动一次，暗选不暴露手牌实体或牌名'),
        test('strategists', '反馈自伤时只能收回装备，不能选择原有手牌；装备也不受弃置禁令阻挡'),
      ),
      clause(
        'availability',
        '无来源/死亡/自伤仅手牌不询问，可拒绝；同窗原不合资格者可随实际移牌变为合法',
        test('strategists', '反馈无来源、来源先死亡或仅有自伤手牌时不制造选择；可正常拒绝'),
        test('occurrences', '遗计给空手伤害来源一张牌后，同一窗口原本不合资格的反馈可以发动'),
      ),
    ],
  },
  {
    id: 'standard:tiandu',
    description: '你的判定结束后，你可以获得仍在处理区中的判定牌。',
    clauses: [
      clause(
        'final-card',
        '本人判定结束后取得最终仍在处理区的牌，不依成功与否；与洛神不重复取得',
        test('strategists', '天妒取得最终改判牌，不受判定是否成功影响，旧判定牌仍弃置'),
        test('strategists', '天妒与洛神共享一次判定，不重复取得同一张牌，结果仍可继续判定'),
      ),
      clause(
        'committed',
        '宣告后失去技能不撤销，但已被取得的牌不追回，本人死亡不继续',
        test('strategists', '天妒宣告后技能失去仍可取得，牌被先取走或本人死亡则不强取'),
      ),
    ],
  },
  {
    id: 'standard:yiji',
    description:
      '每受到 1 点伤害后，你可以观看牌堆顶两张牌，将它们以任意方式交给角色，也可留给自己。它们暂存于仅你可见的牌池，不视为摸牌。',
    clauses: [
      clause(
        'each-damage',
        '按伤害量逐点独立选择，可拒绝任一次并与其他技能交错；护盾吸收不以扣血量代替',
        test('strategists', '遗计每点伤害独立征询，拒绝第一点不取消第二点，可一次分配全部两张牌'),
        test('occurrences', '两点伤害的遗计可以只执行一次后先刚烈，再继续第二次遗计'),
        test('shield', '被护盾全抵消的两点伤害仍提供两次遗计，费用/池与伤害次数不借扣血量计数'),
      ),
      clause(
        'private-pool',
        '顶二暂存私有池，不是摸牌/手牌；可分批给他人或保留，缺牌不制造死锁',
        test(
          'strategists',
          '遗计私有牌池不算手牌、不触发摸牌，只有本人投影和 AI 观察可见；分批交牌与保留余牌',
        ),
        test('strategists', '私有牌池只洗弃牌补足，不借用外层处理区；牌被先取走后按实时余牌选择'),
        test('strategists', '遗计空牌堆或不足两张时正常结束，不制造必选死锁'),
      ),
      clause(
        'cleanup',
        '嵌套池隔离，中止/死亡清理实时余牌不追回已转交；失去技能仅停止未宣告后次',
        test('strategists', '遗计已宣告部分不因失去技能中断，后一个伤害 occurrence 不再发动'),
        test('strategists', '遗计交出部分牌后本人死亡，已交出的牌保留，池中余牌弃置且元数据关闭'),
        test('strategists', '私有牌池嵌套互不混合，子流程中止也清理余牌与可见者状态'),
      ),
    ],
  },
  {
    id: 'standard:jizhi',
    description: '当你使用非转化的普通锦囊牌时，你可以摸一张牌。',
    clauses: [
      clause(
        'owner-category',
        '仅本人普通锦囊，可拒绝/摸一，先于锦囊效果；排除基本/装备/延时和有材料转换',
        test('tacticians', '集智普通锦囊接受=true，在锦囊效果之前摸牌，宣告仅一次'),
        test('tacticians', '集智普通锦囊接受=false，在锦囊效果之前摸牌，宣告仅一次'),
        test('tacticians', '集智不响应 basic'),
        test('tacticians', '集智不响应 equipment'),
        test('tacticians', '集智不响应 delayed'),
        test('tacticians', '集智不响应 generated-material'),
        test('standard-trigger-baseline', '集智不响应他人使用的实体普通锦囊'),
        test('standard-trigger-baseline', '集智不响应奇袭转换的有材料普通锦囊，实际拆牌仍完成'),
      ),
      clause(
        'open-category',
        '零材料虚拟普通锦囊与真实无懈也生效，新作者牌按类别判断无需白名单；失去技能不撤销宣告',
        test('tacticians', '零材料虚拟普通锦囊仍能集智，接受后失去技能不撤销摸牌'),
        test('tacticians', '真实无懈可击也是普通锦囊，集智摸牌发生在反制生效前'),
        test('tacticians', '作者新建锦囊只需声明类别，集智和奇才无需增补牌名表'),
      ),
    ],
  },
  {
    id: 'standard:qicai',
    description: '锁定技，你使用锦囊牌无距离限制；仍须满足其他目标条件。',
    clauses: [
      clause(
        'distance-only',
        '本人锦囊忽略距离，不改实际距离/杀范围，不绕目标禁令、空区域或同名延时限制，支持新作者锦囊',
        test('tacticians', '奇才只豁免锦囊距离，不改变真实距离或杀的范围'),
        test('tacticians', '奇才不绕过目标禁令、空区域和同名延时牌限制'),
        test('tacticians', '作者新建锦囊只需声明类别，集智和奇才无需增补牌名表'),
      ),
    ],
  },
  {
    id: 'standard:wushuang',
    description: '锁定技，你使用杀需要目标连续使用两张闪；与你决斗的角色每次需连续打出两张杀。',
    clauses: [
      clause(
        'slash',
        '本人杀目标需完整连续两闪；零/一张仍受伤，声明后失去技能保留，响应禁令优先',
        test('tacticians', '无双杀连续两闪，实际提供 0 张'),
        test('tacticians', '无双杀连续两闪，实际提供 1 张'),
        test('tacticians', '无双杀连续两闪，实际提供 2 张'),
        test('tacticians', '无双的声明在技能失去后保留，但没有响应机会时不强开两闪'),
      ),
      clause(
        'duel-and-scope',
        '决斗按双方实际技能与响应方要求两杀，不将其他锦囊扩大为两次响应',
        test('tacticians', '无双决斗按响应方记录要求，来源=a'),
        test('tacticians', '无双决斗按响应方记录要求，来源=b'),
        test('tacticians', '无双决斗按响应方记录要求，来源=both'),
        test('standard-trigger-baseline', '无双不会把万箭齐发的一次打出闪扩张为连续两次'),
      ),
    ],
  },
  {
    id: 'standard:ganglie',
    description:
      '受到一次伤害后，你可以判定。若不为红桃，伤害来源须弃置两张手牌，否则受到你造成的 1 点伤害。',
    clauses: [
      clause(
        'judgment',
        '每次伤害一次可拒绝的判定，非红桃才追讨；没有来源仍可判定，濒死未救死亡不发动',
        test('wei-generals', '刚烈在一次两点伤害后只判定一次；少于两张可弃手牌时直接造成一点伤害'),
        test('wei-generals', '刚烈来源可拒绝弃置；没有来源也仍判定，红桃时没有来源选择'),
        test('wei-generals', '拒绝发动刚烈不翻牌，濒死未获救死亡也不再发动受伤技能'),
      ),
      clause(
        'payment-and-commit',
        '来源弃两张可弃手牌否则受一伤；不能弃装备/受保护牌，最终改判生效，失去技能不撤销',
        test(
          'wei-generals',
          '刚烈来源可以支付两张手牌；受保护手牌和装备不进入候选，不产生额外伤害',
        ),
        test(
          'wei-generals',
          '刚烈判定可被改为红桃；已经发动后失去技能仍执行判定，来源死亡则不继续追讨',
        ),
      ),
    ],
  },
  {
    id: 'standard:luoyi',
    description:
      '摸牌阶段，你可以少摸一张牌。若如此做，本回合你使用杀或决斗造成的伤害加 1。已发动的效果不因失去裸衣而消失。',
    clauses: [
      clause(
        'explicit-draw',
        '仅显式本人阶段摸牌且本回合存在、计数大于零；少摸与独立效果原子宣告，可拒绝',
        test(
          'wei-generals',
          '裸衣只减少显式阶段摸牌，内嵌同原因摸牌不继承阶段；声明与回合效果同次提交',
        ),
        test('wei-generals', '拒绝裸衣保留两张摸牌；零摸牌不询问，独立阶段不虚构回合效果'),
      ),
      clause(
        'damage-attribution',
        '只增本回合本人实际使用杀/决斗的直接伤害，失去技能仍在；非牌及他人决斗反打不借用',
        test('chains', '真实转换火杀的裸衣只在直接伤害增伤，传播不再次叠加'),
        test(
          'wei-generals',
          '裸衣少摸后杀增伤，失去技能仍增伤，回合结束自动消失；非牌伤害不会借用裸衣',
        ),
        test('wei-generals', '决斗目标打回伤害仍是实际来源，但不是其本人使用的决斗，不借用裸衣'),
        test('wei-generals', '裸衣对本人使用的 physical 决斗增伤，失去原技能仍保留已宣告回合效果'),
        test('wei-generals', '裸衣对本人使用的 generated 决斗增伤，失去原技能仍保留已宣告回合效果'),
      ),
      clause(
        'turn-lifetime',
        '嵌套回合暂停外层效果，重复发动不叠加，执行前重查，外层结束清理',
        test(
          'wei-generals',
          '嵌套回合暂停外层裸衣，重复摸牌不叠加；开窗后撤销状态必须在执行前重查',
        ),
      ),
    ],
  },
  {
    id: 'standard:luoshen',
    description:
      '准备阶段，你可以判定。若为黑色，你获得此判定牌，并可以继续判定，直到你停止或判定为非黑色。',
    clauses: [
      clause(
        'loop',
        '准备阶段一次宣告后的普通循环，黑牌归手可继续，红牌弃置或本人停止；不是摸牌，空堆正常结束',
        test('wei-generals', '洛神连续黑牌归手、红牌弃置，不发摸牌窗口；一次宣告包含整个循环'),
        test('wei-generals', '洛神可主动停止或完全拒绝，空牌堆也会正常结束'),
      ),
      clause(
        'judgment-result',
        '使用本人最终判定颜色，嵌套同原因不混入；被先取得不追回，失去技能不撤销，死亡停止',
        test('wei-generals', '洛神按最终改判颜色取牌，不沿用首次公开的颜色：黑色 true'),
        test('wei-generals', '洛神按最终改判颜色取牌，不沿用首次公开的颜色：黑色 false'),
        test('wei-generals', '洛神判定后已被别人取走的黑牌不会抢回；失去技能也不截断已宣告的循环'),
        test('wei-generals', '洛神回调只处理自己的判定，嵌套同原因判定不被错误取得'),
        test('wei-generals', '判定后目标死亡时，洛神不取得牌也不再询问'),
      ),
    ],
  },
  {
    id: 'standard:jiuyuan',
    description:
      '主公技，锁定技。其他吴势力角色对你使用桃时，额外回复 1 点体力；按当前势力判断，仍受体力上限限制。',
    clauses: [
      clause(
        'actual-user',
        '仅主公本人受到其他当前吴角色实际使用桃的回复，急救也保留实际使用者；普通技能/自己桃不加成且裁剪上限',
        test('standard-games', '标准二十五将统一初始化：目录字段、主公技能与体力奖励及事实重建'),
        test('wu-generals', '救援按实际桃使用者与当前势力增加回复：wu'),
        test('wu-generals', '救援按实际桃使用者与当前势力增加回复：shu'),
        test('wu-generals', '救援按实际桃使用者与当前势力增加回复：self'),
        test('wu-generals', '救援按实际桃使用者与当前势力增加回复：changed'),
        test('wu-generals', '救援不奖励普通技能回复，也不超过体力上限'),
        test('wu-generals', '救援同样识别急救转换的桃，并保留真实使用者'),
      ),
    ],
  },
  {
    id: 'standard:keji',
    description:
      '弃牌阶段开始前，若你在本回合的出牌阶段没有使用或打出过杀，你可以跳过此弃牌阶段。包括转换、供牌和改判中的真实打出；按阶段与实际角色查询。',
    clauses: [
      clause(
        'skip',
        '弃牌前可选择跳过且与费用原子提交；拒绝正常弃牌，独立阶段无本回合记录也可发动',
        test('wu-generals', '克己无杀时可跳弃牌，支付后效已看到跳过标记'),
        test('wu-generals', '克己可以拒绝；独立弃牌阶段无本回合出牌记录也可发动'),
      ),
      clause(
        'actual-activities',
        '查本回合所有实际出牌阶段本人使用/打出杀，包括转换、获得技能前活动、决斗和鬼才；普通移牌/他人/其他阶段/前回合不计',
        test('wu-generals', '出牌阶段真实使用杀后不能克己，包括获得技能前的活动：physical'),
        test('wu-generals', '出牌阶段真实使用杀后不能克己，包括获得技能前的活动：converted'),
        test('wu-generals', '出牌阶段真实使用杀后不能克己，包括获得技能前的活动：before-grant'),
        test('wu-generals', '克己识别本人出牌阶段鬼才打出的杀，不把改判漏出活动查询'),
        test('wu-generals', '克己识别出牌阶段决斗中的本人普通打出杀'),
        test('wu-generals', '其他阶段打出的杀、他人在本人出牌阶段使用杀不妨碍克己'),
        test('wu-generals', '重复出牌阶段的使用记录都属于本回合，不能只查看最后一段'),
        test('wu-generals', '普通移走杀不算使用或打出，前一回合的杀也不阻止本回合克己'),
      ),
      clause(
        'active-domain',
        '嵌套额外回合/非出牌阶段不继承因果祖先；外层恢复后真实出杀与同回合嵌套真实出牌仍计入',
        test('activity-periods', '外层克己不计入嵌套 a 的额外回合中的真实杀，因果祖先仍保留'),
        test('activity-periods', '出牌阶段开始前由规则使用的杀不计入该出牌阶段，之后仍可克己'),
        test('activity-periods', '外层出牌阶段内嵌的判定阶段中用杀，不算实际出牌阶段活动'),
        test('activity-periods', '出牌阶段生存期已结束后的后效用杀，不再计入已关闭的阶段'),
        test(
          'activity-periods',
          '嵌套回合返回后恢复外层实际出牌阶段，之后真正使用杀仍禁止外层克己',
        ),
        test('activity-periods', '同一回合嵌套的真实出牌阶段仍属于本回合，不能误排除而允许克己'),
      ),
    ],
  },
  {
    id: 'standard:qianxun',
    description: '锁定技，你不能成为顺手牵羊或乐不思蜀的目标。',
    clauses: [
      clause(
        'exact-target',
        '仅禁止本人成为顺手/乐目标，失去技能恢复；其他牌、角色或本人作为来源不受误伤',
        test('wu-generals', '谦逊禁止snatch成为目标，失去技能后恢复合法性'),
        test('wu-generals', '谦逊禁止indulgence成为目标，失去技能后恢复合法性'),
        test(
          'standard-trigger-baseline',
          'qianxun 只禁止本人的指定牌名目标，不扩张到其他牌、其他角色或来源用牌',
        ),
      ),
    ],
  },
  {
    id: 'standard:lianying',
    description:
      '失去最后的手牌后，你可以摸一张牌。一批移出多张手牌只产生一次机会；重新获得手牌再失去时是新的机会。',
    clauses: [
      clause(
        'last-hand-batch',
        '只因一批移出最后手牌发动一次，可拒绝；部分手牌/仅装备不触发，重新得牌再失去为新机会',
        test('wu-generals', '连营一次失去多张最后手牌只询问一次，并且记录发生于原牌效果之前'),
        test('wu-generals', '连营不会因部分手牌或仅装备离场发动，拒绝发动不产生摸牌'),
        test('wu-generals', '连营重新得到手牌再失去，会得到新的独立发动机会'),
      ),
      clause(
        'committed',
        '支付后收到手牌或失去技能仍摸一；死亡不摸也不向死者询问，费用内嵌摸牌不重建原材料',
        test('wu-generals', '连营宣告后收到手牌仍摸一张，失去技能也不撤销已宣告效果'),
        test('wu-generals', '连营支付后死亡不再摸牌，批量埋葬也不向死亡角色询问'),
        test('wu-generals', '连营嵌在最后手牌用牌费用中，摸牌不会追回或重建原用牌材料'),
      ),
    ],
  },
];

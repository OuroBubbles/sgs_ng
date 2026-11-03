// 人工审阅的标准牌条件；共用机制仍绑定具体牌的实际断言，不由实现推导规则。
const test = (file, name) => ({ file: `tests/scenarios/${file}.test.ts`, name });
const clause = (id, requirement, ...evidence) => ({ id, requirement, evidence });
const range = (id, value) =>
  clause(
    'range-lifecycle',
    `攻击范围 ${value} 只随当前装备持有者提供，失效/作为材料不借用，转移后归新角色`,
    test('standard-card-baseline', `${id} 的范围 ${value} 随实际装备归属、失效与材料实时变化`),
  );
const armor = (id) =>
  clause(
    'installation',
    '实际使用自动安装到本人防具槽，拒绝指定他人，普通转移后能力跟随实体',
    test('standard-card-baseline', `${id} 真实使用仅安装到本人防具槽，普通转移后能力归属跟随实体`),
  );

export default [
  {
    id: 'standard:slash',
    description:
      '出牌阶段限一次，对攻击范围内一名其他角色使用。其须使用闪抵消，否则受到你造成的 1 点伤害。',
    clauses: [
      clause(
        'targets-and-usage',
        '范围内其他角色，拒绝重复/非法目标；宣告才计阶段额度，额外阶段独立',
        test('use-card', '攻击距离、重复目标和不可主动使用的牌均在支付前拒绝'),
        test('use-card', '出牌阶段杀次数只在宣告时记录，每次额外阶段有独立次数'),
        test(
          'standard-authoring-baseline',
          'wusheng 实际授予后保留杀的距离/自身目标/完整闪使用，阶段额度按该技能分别生效',
        ),
      ),
      clause(
        'jink-use',
        '闪以完整使用抵消本次杀，取消/不足则受伤；禁止打出不误伤使用',
        test('response-purpose', '抵消杀的闪是完整使用，提交使用事实和完成时点，不伪造打出'),
        test('response-purpose', '禁止打出闪不禁止抵消杀时使用闪'),
        test('use-card', '取消闪响应后正常受伤，不支付未打出的闪'),
        test('use-card', '需要两张闪时，第一张已经支付但不足以防止伤害'),
      ),
      clause(
        'damage-and-materials',
        '伤害关联真实用牌；来源宣告后死亡不吞效果，多材料只善后实时余牌',
        test('use-card', '杀宣告支付、伤害关联、收束与处理区善后完整结束'),
        test('use-card', '来源在宣告后死亡，已产生的牌效果仍结算'),
        test('use-card', '多材料中的一张被伤害后技能获得，结尾只清理余牌'),
      ),
    ],
  },
  {
    id: 'standard:jink',
    description:
      '响应杀时使用，抵消一次杀的效果；万箭齐发要求打出时可以打出。不能在出牌阶段主动使用。',
    clauses: [
      clause(
        'purposes',
        '抵消杀为使用，万箭为打出；各自禁令分开，无活跃机会不能主动使用',
        test('response-purpose', '抵消杀的闪是完整使用，提交使用事实和完成时点，不伪造打出'),
        test('response-purpose', '禁止使用闪不禁止万箭齐发要求的打出，实际完成类型仍为打出'),
        test('response-purpose', '禁止打出闪时万箭齐发未获得响应，普通闪与八卦均不绕过'),
        test('response-purpose', '闪有使用定义也不能在没有响应机会的 effect 用途主动使用'),
        test('response-purpose', '闪有使用定义也不能在没有响应机会的 play 用途主动使用'),
      ),
      clause(
        'request-identity',
        '本人取消不支付，回复不重复接纳；双闪分开身份，真实完成后再返回上层',
        test('use-card', '闪响应只防止当前效果，回复关联稳定 UseId/EffectId，重复回复不再次支付'),
        test('response-purpose', '本人取消使用闪不支付，杀正常命中且请求关闭'),
        test('response-purpose', '连续两闪各有独立使用身份、完成和处理区，不合并为一次使用或打出'),
        test('use-card', '响应中使用闪的后效与处理区关闭完成后，上层用牌才返回'),
      ),
    ],
  },
  {
    id: 'standard:peach',
    description: '出牌阶段回复自己 1 点体力；救援时可对濒死角色使用，使其回复 1 点体力。',
    clauses: [
      clause(
        'healing-target',
        '普通使用治疗本人一血，满体力不支付；救援只能治疗本次指定的濒死者，可为自己',
        test('use-card', '桃只回复合法目标，满体力时不支付'),
        test(
          'response-boundaries',
          '救援 b 时，受伤的 a 不能把这次桃改用于自己；合法救援仍经真实濒死流程',
        ),
        test('response-boundaries', '救援桃仍可治疗濒死的自己，救援装配使用的是真实用牌而非打出'),
      ),
      clause(
        'rescue-order',
        '濒死求桃真实使用且先于受伤后效，负血可连续救援，终局停止新求桃并清理材料',
        test('life', '濒死救援在受伤后之前完整结算；桃产生 card.used 而不是 card.responded'),
        test('life', '负体力允许同一救援者连续用桃，放弃后按座次交给下一人'),
        test('life', '濒死中确定终局后不再求桃/死亡/伤害后效，仍完整收束用牌处理区'),
      ),
    ],
  },
  {
    id: 'standard:ex_nihilo',
    description: '出牌阶段对自己使用，摸两张牌。',
    clauses: [
      clause(
        'self-and-draw',
        '只对本人摸二，拒绝他人且不支付；真实摸牌与材料善后完成，洗牌后死亡/终局不继续取牌',
        test('standard-card-baseline', '无中生有仅以本人为目标，实际摸两张并完成材料善后'),
        test(
          'deck-boundaries',
          '真实无中生有在洗牌后 dead 不摸牌，已支付实体仍完成用牌和处理区善后',
        ),
        test(
          'deck-boundaries',
          '真实无中生有在洗牌后 finished 不摸牌，已支付实体仍完成用牌和处理区善后',
        ),
      ),
      clause(
        'counterable',
        '普通锦囊可被真实无懈链反制，嵌套材料与最终效果分别完成',
        test(
          'standard-card-baseline',
          '无中生有被 1 层真实无懈反制：奇数不摸、偶数摸两张，材料独立善后',
        ),
        test(
          'standard-card-baseline',
          '无中生有被 2 层真实无懈反制：奇数不摸、偶数摸两张，材料独立善后',
        ),
      ),
    ],
  },
  {
    id: 'standard:duel',
    description: '对一名其他角色使用。从目标开始轮流打出杀，首先未打出者受到对方造成的 1 点伤害。',
    clauses: [
      clause(
        'responses',
        '目标先轮流真实打出杀，不消耗阶段用杀额度；无杀/主动放弃受对方伤害，无双按响应方计数',
        test('use-card', '决斗轮流响应杀，不消耗出牌阶段杀次数'),
        test('response-boundaries', '决斗正常的无可用杀仍是未响应，不被当作中止'),
        test('response-boundaries', '决斗正常的主动放弃仍是未响应，不被当作中止'),
        test('tacticians', '无双决斗按响应方记录要求，来源=a'),
        test('tacticians', '无双决斗按响应方记录要求，来源=b'),
      ),
      clause(
        'abort-and-attribution',
        '局部中止不是响应失败，已打出保留；反打伤害来源是实际对手而不是锦囊使用者',
        test(
          'response-boundaries',
          '决斗第 1 次响应局部中止：不伪造响应失败伤害，已提交打出不撤销',
        ),
        test(
          'response-boundaries',
          '无双决斗要求 b 连续两杀：第二张流程中止不变成失败，第一张已打出保留',
        ),
        test('wei-generals', '决斗目标打回伤害仍是实际来源，但不是其本人使用的决斗，不借用裸衣'),
      ),
      clause(
        'target-recheck',
        '空城限制目标，实际反制中新增目标禁令使机会收束；来源死亡本身不取消决斗',
        test('astrology', '空城只禁止空手角色成为杀/决斗目标，装备、私有池和响应资格分别处理'),
        test(
          'counter-effect-eligibility',
          'duel 的第 1 层反制中 prohibited，停止无效征询且保留已用无懈',
        ),
        test(
          'counter-effect-eligibility',
          '决斗反制中 source-dead 不属于该牌失效条件，不误伤正常无懈',
        ),
      ),
    ],
  },
  {
    id: 'standard:nullification',
    description:
      '在锦囊效果即将生效时使用，抵消该效果；也可以反制一张无懈可击。反制按目标效果分别结算。',
    clauses: [
      clause(
        'nested-use',
        '每层为真正用牌，各自处理区，奇偶结论关联原效果；每个目标独立',
        test('counter', '1 层无懈嵌套为真正用牌：顺序、处理区和结算结果独立'),
        test('counter', '2 层无懈嵌套为真正用牌：顺序、处理区和结算结果独立'),
        test('counter', '3 层无懈嵌套为真正用牌：顺序、处理区和结算结果独立'),
        test('tricks', '无懈只取消南蛮当前目标，之后的目标继续响应或受伤'),
        test('counter', '反制提交记录明确关联原效果与每层用牌，结果不包含生命周期闭包'),
      ),
      clause(
        'opportunity',
        '只在活跃机会可用；按行动序放弃后继续，旧机会/其他局不可复用，转换来源失去不撤销已宣告',
        test('counter', '无懈不能主动打出，过期机会或同文本 ID 的其他局也不能复用'),
        test('counter', '拒绝无懈后按座次继续；下一层可以重新参加，不能伪造规则生成牌'),
        test('counter', '转换无懈走同一用牌管线，失去来源不吞掉已经宣告的反制'),
      ),
      clause(
        'live-meaning',
        '父效果失去意义时整个嵌套链停止新征询；已用材料/归属保留，封口后后效不改原结论',
        test('counter', '目标效果在主组取消后不再征询无懈；机会中失去意义也不额外支付'),
        test('counter-boundaries', '无懈已经宣告后原机会 dead，内外层均如实返回失效且保留用牌归属'),
        test(
          'counter-effect-eligibility',
          'god_salvation 的第 1 层反制中 healed，停止无效征询且保留已用无懈',
        ),
        test(
          'counter-effect-eligibility',
          '反制结论封口后的公共后效治满桃园目标，不倒改已完成的反制与材料事实',
        ),
      ),
    ],
  },
  {
    id: 'standard:savage_assault',
    description: '对所有其他角色使用，各目标须打出杀，否则受到你造成的 1 点伤害。',
    clauses: [
      clause(
        'all-others',
        '自动指定全部其他合法角色，不能手选子集；各自打出杀或受一伤，单个反制不取消整牌，后续死亡跳过',
        test('tricks', 'savage_assault 自动宣告完整目标，各目标独立响应，不能手工选择子集'),
        test('tricks', '无懈只取消南蛮当前目标，之后的目标继续响应或受伤'),
        test('tricks', '自动目标在宣告时固定，前一目标效果中死亡的后续角色直接跳过'),
      ),
    ],
  },
  {
    id: 'standard:archery_attack',
    description: '对所有其他角色使用，各目标须打出闪，否则受到你造成的 1 点伤害。',
    clauses: [
      clause(
        'all-others-response',
        '自动指定全部其他合法角色，各自打出闪或受一伤；打出用途与杀的使用闪分开，无双/斧不误触发',
        test('tricks', 'archery_attack 自动宣告完整目标，各目标独立响应，不能手工选择子集'),
        test('response-purpose', '禁止使用闪不禁止万箭齐发要求的打出，实际完成类型仍为打出'),
        test('response-purpose', '禁止打出闪时万箭齐发未获得响应，普通闪与八卦均不绕过'),
        test('standard-trigger-baseline', '无双不会把万箭齐发的一次打出闪扩张为连续两次'),
        test('weapons', '万箭的闪不激活贯石斧；防具直接取消杀也不冒充闪避'),
      ),
    ],
  },
  {
    id: 'standard:god_salvation',
    description: '对所有角色使用，各目标回复 1 点体力。未受伤者跳过效果。',
    clauses: [
      clause(
        'wounded-only',
        '声明全部角色但只治疗受伤者一血；满体力跳过且不耗无懈，反制中治满收束，条件恢复可继续',
        test('tricks', '桃园保留全部目标，未受伤者在效果前跳过，不提前消费无懈'),
        test(
          'counter-effect-eligibility',
          'god_salvation 的第 0 层反制中 healed，停止无效征询且保留已用无懈',
        ),
        test(
          'counter-effect-eligibility',
          '同一候选中桃园目标先治满再失去体力，不把中途的假值缓存为永久失效',
        ),
      ),
    ],
  },
  {
    id: 'standard:amazing_grace',
    description: '按目标数展示牌堆顶牌，各目标依次选择一张获得。未被获得的余牌置入弃牌堆。',
    clauses: [
      clause(
        'public-pool',
        '按目标数展示共享公开池，目标依次得一；被无懈不取，余牌与用牌材料分开善后，不算摸牌',
        test('tricks', '五谷共享公开牌池，某目标被无懈后不取牌；余牌与用牌材料各自善后'),
        test('tricks', '公开牌池牌不足时洗入弃牌，仍不足则只展示实有牌，绝不借走用牌材料'),
      ),
      clause(
        'nested-cleanup',
        '嵌套池互不覆盖，实时余牌可供其他规则取得/转换，不重复善后',
        test('tricks', '嵌套五谷的两个共享牌池由各自闭包拥有，内层不覆盖外层候选'),
        test('tricks', '公开处理区的牌可被后效取走，善后只处置实时余牌'),
        test('tricks', '作者转换可借用五谷公开牌池材料反制当前目标，两个处理区不会重复弃置'),
      ),
    ],
  },
  {
    id: 'standard:snatch',
    description: '对距离为 1 的一名其他角色使用，获得其手牌、装备或判定区的一张牌。手牌只能暗选。',
    clauses: [
      clause(
        'range-and-selection',
        '其他角色距离一且有可选区域；手牌仅不透明选项，取得不借用弃置权限，延时牌按逻辑身份整体取得',
        test('tricks', '顺手暗选不给出隐藏牌 ID/牌名，实体 ID 不能冒充选项，实际移牌仍有明确身份'),
        test('tricks', '顺手受距离限制，拆桥可选远处公开装备和判定牌，但不碰私有特殊区'),
        test('discard', '所有牌都禁止被弃置时拆桥正常空结算；顺手获得不受弃置禁止影响'),
        test('delayed', '0 材料转化延时牌保持语义身份；顺手按一张逻辑牌选择并整体取得材料'),
        test('delayed', '2 材料转化延时牌保持语义身份；顺手按一张逻辑牌选择并整体取得材料'),
      ),
      clause(
        'live-target',
        '目标空牌或来源死亡时不再征询无效无懈，已支付材料保留',
        test(
          'counter-effect-eligibility',
          'snatch 的第 1 层反制中 last-card-gone，停止无效征询且保留已用无懈',
        ),
        test(
          'counter-effect-eligibility',
          'snatch 的第 1 层反制中 source-dead，停止无效征询且保留已用无懈',
        ),
      ),
    ],
  },
  {
    id: 'standard:dismantlement',
    description: '对一名有牌的其他角色使用，弃置其手牌、装备或判定区的一张牌。手牌只能暗选。',
    clauses: [
      clause(
        'selection-discard',
        '其他有牌者不受距离限制；手牌不透明，装备/判定公开可选，私有特殊区不在标准范围，弃置权限实时生效',
        test('tricks', '顺手受距离限制，拆桥可选远处公开装备和判定牌，但不碰私有特殊区'),
        test('discard', '拆桥只给合法的不透明手牌选项，真实牌 ID 无法代答；保护牌仍留在目标手里'),
        test('discard', '所有牌都禁止被弃置时拆桥正常空结算；顺手获得不受弃置禁止影响'),
      ),
      clause(
        'live-target',
        '确认后目标空牌或来源死亡跳过，不制造空选择；嵌套反制也重查真实条件',
        test('tricks', '目标在确认中失去全部可选牌，拆桥不再弹出空选择；来源死亡也不再要求选牌'),
        test(
          'counter-effect-eligibility',
          'dismantlement 的第 1 层反制中 last-card-gone，停止无效征询且保留已用无懈',
        ),
        test(
          'counter-effect-eligibility',
          'dismantlement 的第 1 层反制中 source-dead，停止无效征询且保留已用无懈',
        ),
      ),
    ],
  },
  {
    id: 'standard:collateral',
    description:
      '选择一名有武器的其他角色，再指定其攻击范围内一个合法杀目标。前者对后者使用一张杀，否则你获得其武器。',
    clauses: [
      clause(
        'prepared-victim',
        '真正锦囊目标仅持武器他人，附属受害者是合法杀目标，可为借刀者；附属选择先于支付且取消不支付',
        test('collateral', '附属选择先于宣告；锦囊只以持武器者为目标，随后完整使用杀'),
        test('collateral', '取消附属选择不支付、不开放反制，且没有遗留处理区'),
        test('collateral', '受害者可以是借刀者；禁止锦囊指定受害者不冒充禁止指定真正目标'),
        test('collateral', '没有任何合法杀目标或持武器者被禁止时，借刀不可用'),
      ),
      clause(
        'actual-use',
        '真实额外用杀可转换且不消耗阶段次数；杀被防具抵消也履行，不交武器',
        test('collateral', '被要求的杀可用转换配方，仍是用牌而非打出响应'),
        test('collateral', '借刀额外用杀不受出牌阶段限次影响，也不消耗新的阶段次数'),
        test('collateral', '杀被仁王盾抵消仍已履行用杀，不再交武器'),
      ),
      clause(
        'current-weapon',
        '无法/拒绝用杀取得此刻武器；死亡边界分别判断，借刀者死亡不吞已宣告杀',
        test('collateral', '没有杀自动获得武器；选择拒绝用杀时同样获得，装备能力随实体离场'),
        test('collateral', '拒绝用杀时只取结算当前的武器：替换 true'),
        test('collateral', '持武器者死亡则跳过；受害者死亡导致无法出杀时执行交武器分支'),
        test('collateral', '借刀者死亡不吞掉已宣告效果，但不会获得武器：杀数量 1'),
      ),
      clause(
        'effect-identity',
        '无懈只反制真正锦囊目标；转移/重复保留已声明受害者，调用者后改参数不改结果',
        test('collateral', '无懈只反制持武器者上的借刀效果，不向附属目标再开一份锦囊效果'),
        test('collateral', '转移真正目标保留已声明受害者，重复效果各自完整用杀'),
        test('collateral', '外部修改预填参数不改变已宣告受害者'),
      ),
    ],
  },
  {
    id: 'standard:indulgence',
    description:
      '放入一名其他角色的判定区。其判定阶段进行判定，若不为红桃，跳过本回合下一个出牌阶段；生效时可被无懈。',
    clauses: [
      clause(
        'installation',
        '只安装到其他角色判定区，拒绝本人/同名；使用不提前判定或反制，跳过判定阶段不消耗实例',
        test(
          'standard-card-baseline',
          'indulgence 安装前拒绝错误本人/他人目标，安装后拒绝同名且不提前判定',
        ),
        test('delayed', '延时牌使用只安装，不提前判定或反制；同名牌不能重复放到同一角色'),
        test('delayed', '跳过判定阶段不消耗判定区实例，下一回合仍可结算'),
      ),
      clause(
        'judgment',
        '最终红桃不跳，其余跳本回合下一个出牌阶段；生效时无懈不判定/不跳，终局不再新增跳过',
        test('delayed', '乐不思蜀判定 heart，只影响本回合下一个出牌阶段，之后实例消失'),
        test('delayed', '乐不思蜀判定 spade，只影响本回合下一个出牌阶段，之后实例消失'),
        test('delayed', '延时牌到生效时才进入反制，乐不思蜀被无懈后不判定也不跳阶段'),
        test('delayed', '判定完成后效结束整局，乐不思蜀不再产生新的阶段跳过意图'),
      ),
      clause(
        'logical-materials',
        '转换来源失去或原使用者死亡不吞持久语义；零/多材料可整体移动与死亡善后',
        test('delayed', '转化来源在宣告后消失仍保留延时牌名，原使用者死亡也不吞掉目标判定'),
        test('delayed', '0 材料转化延时牌保持语义身份；顺手按一张逻辑牌选择并整体取得材料'),
        test('delayed', '2 材料转化延时牌保持语义身份；顺手按一张逻辑牌选择并整体取得材料'),
        test('delayed', '死亡埋葬会关闭 0 材料延时牌，零材料也不留下挂起身份'),
      ),
    ],
  },
  {
    id: 'standard:lightning',
    description:
      '放入自己的判定区。判定黑桃 2–9 时受到无来源的 3 点雷电伤害；否则或被无懈时传给下一名合法角色。',
    clauses: [
      clause(
        'self',
        '使用只放本人且不重复同名，不提前判定；判定区后放先结算，本次仅处理已有实例',
        test(
          'standard-card-baseline',
          'lightning 安装前拒绝错误本人/他人目标，安装后拒绝同名且不提前判定',
        ),
        test('delayed', '判定区后放先结算，只快照已有实例，新安装的牌留到下一次'),
      ),
      clause(
        'spade-rank',
        '仅黑桃二至九造成无来源三点雷电；边界一/十与其他三种花色传递且保留宣告身份',
        ...[2, 9, 1, 10].map((rank) =>
          test('delayed', `闪电黑桃 ${rank}：2–9 为无来源雷电伤害，其余传给下一合法角色`),
        ),
        ...['heart', 'diamond', 'club'].map((suit) =>
          test(
            'standard-card-baseline',
            `闪电判定 ${suit} 5 不造成雷电伤害，实体与原宣告传至下一角色`,
          ),
        ),
      ),
      clause(
        'pass',
        '被无懈不判定仍传递，跳过重复/禁止目标；可回本人但同阶段不再次处理',
        test('delayed', '闪电被无懈后仍向下传递，不能当成普通锦囊直接丢弃'),
        test('delayed', '闪电传递跳过重复与禁止目标，回到自己也不会在同一判定阶段再次结算'),
      ),
    ],
  },
  {
    id: 'standard:crossbow',
    description: '武器，攻击范围 1。你的出牌阶段使用杀没有次数限制。作为杀的材料时不能借用此能力。',
    clauses: [
      range('crossbow', 1),
      clause(
        'usage',
        '阶段内无限杀但仍累计次数，卸下后按已累计次数恢复限制；作为材料不能借用无限次数',
        test('equipment', '诸葛连弩允许阶段内连续用杀，卸下立即恢复已累计的次数限制'),
        test('equipment', '把连弩当第二张杀的材料，不能借用即将失去的无限次数'),
      ),
    ],
  },
  {
    id: 'standard:spear',
    description: '武器，攻击范围 3。你可将两张手牌当杀使用或打出。',
    clauses: [
      range('spear', 3),
      clause(
        'recipe',
        '恰好两张本人手牌，拒绝重复/他人/装备/数量错误；交出材料后旧选择失效，使用/打出分别校验',
        test('standard-card-baseline', '丈八 use 配方只接受恰好两张本人手牌，交出后旧选择立即失效'),
        test(
          'standard-card-baseline',
          '丈八 response 配方只接受恰好两张本人手牌，交出后旧选择立即失效',
        ),
      ),
      clause(
        'face-and-response',
        '真实杀保留全部材料，同红/同黑/混色颜色独立于花色；响应共用管线，装备失效关闭转换与范围',
        test('equipment', '丈八两张 heart/diamond 手牌可作为一次完整杀，颜色为 red'),
        test('equipment', '丈八两张 club/spade 手牌可作为一次完整杀，颜色为 black'),
        test('equipment', '丈八两张 heart/club 手牌可作为一次完整杀，颜色为 none'),
        test('equipment', '丈八复用同一响应管线，装备失效后转换与范围一起关闭，到期一起恢复'),
      ),
    ],
  },
  {
    id: 'standard:eight_diagram',
    description:
      '防具。当你需要使用或打出闪时，可进行判定。若结果为红色，视为按当前用途使用或打出一张闪。',
    clauses: [
      armor('eight_diagram'),
      clause(
        'judge-and-purpose',
        '可拒绝，红判零材料提供闪且按实际用途完成；黑判回普通选择，多闪每次独立机会',
        test(
          'armor-response',
          '八卦阵无手牌也能判定供闪，抵消杀时零材料走一次使用与完成，历史可重建',
        ),
        test('armor-response', '八卦不发动或黑判后回到普通闪选择：发动 false'),
        test('armor-response', '八卦不发动或黑判后回到普通闪选择：发动 true'),
        test(
          'armor-response',
          '装备失效生存期关闭后恢复；多闪需求分别打开机会，不把一次判定算作两闪',
        ),
        test('response-purpose', '禁止打出闪时万箭齐发未获得响应，普通闪与八卦均不绕过'),
      ),
      clause(
        'current-request',
        '当前用途禁令不诱导无效判定，判定后再查；防具已宣告后离场不撤销，目标青釭不误伤队友防具',
        test('armor-response', '禁止响应闪时不诱导八卦发动；判定后新禁令也不能绕过最终供牌验证'),
        test('armor-response', '八卦已经发动，判定期间失去防具不撤销本次技能；以后不再发动'),
        test('armor-response', '青釭剑作用于目标防具，受委托队友仍可发动自己的八卦阵'),
      ),
    ],
  },
  {
    id: 'standard:nioh_shield',
    description: '防具。黑色杀对你无效。',
    clauses: [
      armor('nioh_shield'),
      clause(
        'semantic-color',
        '只取消当前黑色杀效果，红杀正常；按宣告颜色不重读处理区印刷牌，青釭可忽略',
        test('armor-response', '仁王盾按语义颜色防杀：spade'),
        test('armor-response', '仁王盾按语义颜色防杀：heart'),
        test('card-faces', '已宣告红色杀在费用后失去映绯仍绕过仁王盾，快照不从处理区印刷牌重建'),
        test('armor-response', '青釭剑只声明当前杀忽略 nioh_shield，宣告后丢剑不撤销'),
      ),
    ],
  },
  {
    id: 'standard:qinggang_sword',
    description: '武器，攻击范围 2。你使用杀时，此杀的目标防具失效。',
    clauses: [
      range('qinggang_sword', 2),
      clause(
        'effect-only',
        '忽略只属于已声明目标的当前杀效果；失去剑不撤销，嵌套/后来新增身份/队友防具不自动继承',
        test('armor-response', '青釭剑只声明当前杀忽略 nioh_shield，宣告后丢剑不撤销'),
        test('armor-response', '青釭剑只声明当前杀忽略 eight_diagram，宣告后丢剑不撤销'),
        test('armor-response', '青釭剑不污染同一目标上的嵌套杀；效果快照关闭后不能再改'),
        test('armor-response', '青釭剑声明只属于已指定身份，失去武器后追加和重复目标不自动继承'),
        test('armor-response', '青釭剑作用于目标防具，受委托队友仍可发动自己的八卦阵'),
        test('chains', '青釭剑的原效果忽略防具不传给连环角色，每个目标按自己的防具限伤'),
      ),
    ],
  },
  {
    id: 'standard:blade',
    description:
      '武器，攻击范围 3。你的杀被闪抵消后，可对原目标再使用一张杀，忽略距离与出牌阶段次数。',
    clauses: [
      range('blade', 3),
      clause(
        'follow-up',
        '被闪抵消后真实额外杀具有独立身份/处理区，原杀仍防御；可连续追杀，忽略变化距离但受目标禁令',
        test('weapons', '青龙追加杀具有独立身份与处理区，原杀仍是已防御'),
        test('weapons', '青龙连续追杀依次嵌套，每次仍能闪避与选择继续'),
        test('weapons', '青龙忽略变化后的距离，但仍受目标禁令约束：禁止 false'),
        test('weapons', '青龙忽略变化后的距离，但仍受目标禁令约束：禁止 true'),
      ),
      clause(
        'current-source',
        '可拒绝或因发动前武器离场不追杀；允许武圣以刀自身付材料，之后不能继续借用',
        test('weapons', '青龙在发动前离场不再追杀；主动拒绝追杀也不消耗杀'),
        test('weapons', '青龙允许武圣以刀本身追杀，宣告离场后不再继续追杀'),
      ),
    ],
  },
  {
    id: 'standard:axe',
    description: '武器，攻击范围 3。你的杀被闪抵消后，可弃置两张其他手牌或装备，使此杀仍造成伤害。',
    clauses: [
      range('axe', 3),
      clause(
        'payment',
        '仅杀被完整闪抵消后可弃两张其他可弃牌，排除斧自身；不足/取消不支付，万箭/防具取消不触发',
        test('weapons', '贯石斧恢复原效果，保持闪已支付，并让伤害走统一防止管线：false'),
        test('weapons', '贯石斧材料不足或取消不收费：其他牌 1'),
        test('weapons', '贯石斧材料不足或取消不收费：其他牌 2'),
        test('weapons', '防御结果在全部闪满足后才开放；部分成功不会激活贯石斧'),
        test('weapons', '万箭的闪不激活贯石斧；防具直接取消杀也不冒充闪避'),
        test('discard', '贯石斧无法用禁止弃置的牌付费用，闪仍抵消原杀'),
      ),
      clause(
        'committed',
        '突破原杀保留已用闪，伤害仍受防止；宣告后斧离场/来源死亡不撤销',
        test('weapons', '贯石斧恢复原效果，保持闪已支付，并让伤害走统一防止管线：true'),
        test('weapons', '贯石斧已支付后来源 lost，已宣告突破仍生效'),
        test('weapons', '贯石斧已支付后来源 dead，已宣告突破仍生效'),
      ),
    ],
  },
  {
    id: 'standard:halberd',
    description:
      '武器，攻击范围 4。使用杀的材料包含全部手牌时，可额外选择至多两个目标；零材料且空手不满足条件。',
    clauses: [
      range('halberd', 4),
      clause(
        'last-hand',
        '材料用尽非空手牌可多至二目标，支持多材料；仍有其他手牌/空手零材料不额外，武器作材料或失效不借用',
        test('weapons', '方天最后手牌杀的目标数量与最终验证一致，支付后不丢失已声明目标'),
        test('weapons', '方天有其他手牌时仍限一目标；空手零材料杀也不凭空增加目标'),
        test('weapons', '方天支持多材料用尽手牌；武器作材料或来源失效则不提供范围和额外目标'),
      ),
    ],
  },
  {
    id: 'standard:kylin_bow',
    description: '武器，攻击范围 5。你的杀造成伤害时，可弃置受伤角色的一张坐骑。',
    clauses: [
      range('kylin_bow', 5),
      clause(
        'direct-damage',
        '本人杀直接伤害的来源阶段可弃目标一坐骑，拒绝不弃；无牌/已防止不触发，连环传播不重复',
        test('weapons', '麒麟弓只展示坐骑，选择一张后丢弃并继续原伤害'),
        test('weapons', '麒麟弓拒绝发动不丢坐骑；伤害前发动后才被防止时保留已完成的弃置'),
        test('weapons', '麒麟弓不处理无牌伤害或已经防止的伤害'),
        test('chains', '真实火杀的 kylin_bow 不因传播对其他角色重复发动'),
      ),
      clause(
        'live-permission',
        '实际弃置重查坐骑位置与权限，宣告后弓离场/来源死亡不以来源资格重做权限检查',
        test('weapons', '麒麟弓发动后 horse 离场，重查选中坐骑位置并保留已发动效果'),
        test('weapons', '麒麟弓发动后 bow 离场，重查选中坐骑位置并保留已发动效果'),
        test('discard', '寒冰剑目标没有可弃牌时不提供防伤替代；麒麟弓宣告后新增保护会阻止实际弃置'),
        test(
          'discard',
          '麒麟弓已完成选择与宣告后来源死亡，后续弃置仍可继续，存活资格不被权限查询重复代判',
        ),
      ),
    ],
  },
  {
    id: 'standard:double_swords',
    description:
      '武器，攻击范围 2。使用杀指定异性目标时，可令其弃置一张手牌，否则你摸一张牌。双性与有性别角色可构成异性，无性别不构成异性。',
    clauses: [
      range('double_swords', 2),
      clause(
        'gender-and-choice',
        '杀指定后按当前异性判断，双性与无性别有明确规则；来源可拒绝，目标仅弃一手牌否则来源摸一',
        test('swords', '性别为独立权威规则状态，双性/无性别比较明确，死亡后仍保留'),
        test('swords', '雌雄由来源确认目标发动，对方只可交手牌，弃置后仍执行原杀'),
        test('swords', '雌雄无手牌或拒绝弃手牌时来源摸一张：手牌 0'),
        test('swords', '雌雄无手牌或拒绝弃手牌时来源摸一张：手牌 1'),
        test('swords', '雌雄不发动或不构成异性时没有弃牌/摸牌分支'),
      ),
      clause(
        'target-identity',
        '确认前取消不发动；重复身份各次判断，已发动后武器/来源离场不撤销目标选择',
        test('swords', '目标确认前被取消，不再发动后续的雌雄剑指定后技能'),
        test('swords', '重复目标各自指定与发动；确认前改变性别使用当前属性'),
        test('swords', '雌雄已发动后 weapon 离场，不撤销对方已承受的选择'),
        test('swords', '雌雄已发动后 source 离场，不撤销对方已承受的选择'),
      ),
    ],
  },
  {
    id: 'standard:ice_sword',
    description:
      '武器，攻击范围 2。你的杀将造成伤害时，可防止该伤害，依次弃置目标至多两张手牌或装备。每次选择都按当前区域重新生成。',
    clauses: [
      range('ice_sword', 2),
      clause(
        'replacement',
        '本人杀直接伤害可选防止并顺序弃至多二张手牌/装备；无可弃牌/零伤/已防止不触发，拒绝正常伤害',
        test('swords', '寒冰在来源快照之后替代伤害，连续两次暗选并停止目标伤害处理'),
        test('swords', '寒冰目标无牌不发动，只有一张则只弃一张：0'),
        test('swords', '寒冰目标无牌不发动，只有一张则只弃一张：1'),
        test('swords', '寒冰不发动则正常伤害，不触碰目标手牌'),
        test('swords', '来源阶段已经 zero 不开放伤害替代'),
        test('swords', '来源阶段已经 prevented 不开放伤害替代'),
        test('discard', '寒冰剑目标没有可弃牌时不提供防伤替代；麒麟弓宣告后新增保护会阻止实际弃置'),
        test('chains', '真实火杀的 ice_sword 不因传播对其他角色重复发动'),
      ),
      clause(
        'sequential-live',
        '每次按实时区域重新选择；失去武器不撤销，来源/目标死亡停止后次；支付后其他防止不覆盖原因或继续弃牌',
        test('swords', '寒冰第二次重新生成选项，包括第一次移牌后效获得的新牌'),
        test('swords', '寒冰第一张弃置后 weapon 离场，持续效果与停止条件明确'),
        test('swords', '寒冰第一张弃置后 source 离场，持续效果与停止条件明确'),
        test('swords', '寒冰第一张弃置后 target 离场，持续效果与停止条件明确'),
        test('swords', '寒冰发动支付后出现其他防止时不覆盖原因，也不继续弃牌'),
      ),
    ],
  },
  ...[
    ['chitu', '进攻坐骑。你计算与其他角色的距离时减 1，至少为 1。', false],
    ['dayuan', '进攻坐骑。你计算与其他角色的距离时减 1，至少为 1。', false],
    ['zixing', '进攻坐骑。你计算与其他角色的距离时减 1，至少为 1。', false],
    ['jueying', '防御坐骑。其他角色计算与你的距离时加 1。', true],
    ['dilu', '防御坐骑。其他角色计算与你的距离时加 1。', true],
    ['zhuahuangfeidian', '防御坐骑。其他角色计算与你的距离时加 1。', true],
  ].map(([id, description, defensive]) => ({
    id: `standard:${id}`,
    description,
    clauses: [
      clause(
        'direction-and-lifecycle',
        `${defensive ? '别人到本人距离加一' : '本人到别人距离减一且至少一'}，自己距离零；实际槽位/材料排除/失效与卸下各自生效，正负槽独立替换`,
        test('standard-card-baseline', `${id} 实际安装后只修正对应方向，材料/失效/卸下不借用距离`),
        test('equipment', '正负马按来源相加，两个马槽独立替换，距离至少为一且自己为零'),
      ),
    ],
  })),
];

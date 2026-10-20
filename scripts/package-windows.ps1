# 只打包已实际验证的 Release，不构建，也不把构建成功当作原生运行证明。
$ErrorActionPreference = 'Stop'
$packageRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$releaseExe = Join-Path $packageRoot 'src-tauri/target/release/sgs-ng.exe'
$proofPath = Join-Path $packageRoot '.artifacts/ui/native-smoke-release.json'
$proof = Get-Content -LiteralPath $proofPath -Raw | ConvertFrom-Json
$restartProof = Get-Content -LiteralPath (Join-Path $packageRoot '.artifacts/ui/native-content-restart-release.json') -Raw | ConvertFrom-Json
$profileProof = Get-Content -LiteralPath (Join-Path $packageRoot '.artifacts/ui/native-profile-release.json') -Raw | ConvertFrom-Json
$releaseHash = (Get-FileHash -LiteralPath $releaseExe -Algorithm SHA256).Hash.ToLowerInvariant()
$modulePath = Join-Path $packageRoot '.artifacts/content/harbor.sgs.mjs'
$moduleHash = (Get-FileHash -LiteralPath $modulePath -Algorithm SHA256).Hash.ToLowerInvariant()
$resourcePath = Join-Path $packageRoot '.artifacts/content/gallery.sgs'
$resourceHash = (Get-FileHash -LiteralPath $resourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($proof.externalResourceBundle.sha256 -ne $resourceHash -or $restartProof.resourceBundleSha256 -ne $resourceHash -or
  !$restartProof.restoredResourceBlob -or !$restartProof.resourceGuestRealHostSkillAndPortrait) {
  throw 'Binary resource bundle has no matching real native restart proof.'
}
if ($proof.buildKind -ne 'release' -or $proof.executable -ne $releaseExe -or
  $proof.executableSha256 -ne $releaseHash -or $proof.consoleErrors.Count -ne 0) {
  throw 'Release proof does not match this executable.'
}
if ($proof.externalModule.file -ne '.artifacts/content/harbor.sgs.mjs' -or $proof.externalModule.sha256 -ne $moduleHash) {
  throw 'Content module differs from the native import proof.'
}
if ($restartProof.executableSha256 -ne $releaseHash -or $restartProof.moduleSha256 -ne $moduleHash -or
  $restartProof.initialProcessId -ne $proof.processId -or $restartProof.initialProcessId -eq $restartProof.restoredProcessId -or
  !$restartProof.restoredWithoutFileSelection -or !$restartProof.realHostSkillAndMaterials -or !$restartProof.clearedAfterReload -or $restartProof.consoleErrors.Count -ne 0) {
  throw 'Release process restart proof is missing or stale.'
}
if (!$profileProof.isolated -or $profileProof.checks.Count -ne 2 -or $profileProof.directory -ne $proof.verificationProfile -or
  $profileProof.directory -ne $restartProof.verificationProfile -or $profileProof.checks[0].processId -ne $proof.processId -or
  $profileProof.checks[1].processId -ne $restartProof.restoredProcessId) { throw 'Native verification did not use one isolated profile across both processes.' }

$buildRoot = Join-Path $packageRoot '.artifacts/builds'
$stageRoot = Join-Path $buildRoot 'local-client-windows'
New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null
Copy-Item -LiteralPath $releaseExe -Destination (Join-Path $stageRoot 'sgs-ng.exe') -Force
Copy-Item -LiteralPath $modulePath -Destination (Join-Path $stageRoot 'harbor.sgs.mjs') -Force
Copy-Item -LiteralPath $resourcePath -Destination (Join-Path $stageRoot 'gallery.sgs') -Force
Copy-Item -LiteralPath (Join-Path $packageRoot 'public/spine/LICENSE') -Destination (Join-Path $stageRoot 'Spine-LICENSE.txt') -Force
@'
弈 · 三国杀新章 / 本地练习版

解压后运行 sgs-ng.exe，需要 Windows WebView2 Runtime。
选择席位、牌组与种子，开始单机对局。你固定控制甲席，其他角色由基础 AI 自动行动。
暂停或切到后台会隐藏手牌并等待明确继续；手动演练（内容调试）可切回多席操作。
默认使用标准＋EX 的 108 张实体牌，共 32 种基本牌、锦囊与装备。
可选机制练习牌组为 288 张测试配比，用于快速体验全部牌型。
开局勾选“作者演武”可启用演武客、闻策、整备和 44 张演武牌组；这是普通 TypeScript 源码包的可运行示例，默认关闭。
复现示例：演武客、两人、AI 关羽、作者演武牌组、种子 2。甲席首回合使用整备，发动闻策，再选择摸两张牌。
遗玉示例：启用作者演武，演武客、两人、AI 关羽、遗玉演练牌组、种子 10。先装备遗玉，再装备起手八卦阵；遗玉离场后可以选择玉碎摸一张牌，也可以拒绝。
分筹示例：启用作者演武，筹策客、两人、AI 关羽、标准＋EX 牌组、种子 4。准备阶段发动分筹，可将黑牌交给乙席，每名其他角色至多一张，红牌只能交给受伤的其他角色，其余归自己。超额时可移回调整，确认后才一起移牌；暂停会隐藏私有面板，恢复时重新分配。
连环示例：启用作者演武，关羽、两人、AI 关羽、连环演练牌组、种子 4。先用起手缚阵连接甲乙双方，再用引焰指定乙席；双方各受到一次火焰伤害并解除连环。标记为公开状态，日志区分传播伤害。
护盾示例：启用作者演武，关羽、两人、AI 关羽、护盾与转移牌组、种子 4。先对自己凝障，再缚阵双方、引焰乙席；甲席体力不变，护盾 2→1，双方解链。
转移示例：同一牌组和种子，改选守阵客、AI 关羽。首回合结束出牌并完成弃牌，等待 AI 直接伤害，选择代受的一张手牌费用和乙席接收方；也可以取消，不支付费用。代受是自定义演示技能，不是完整天香实现。
牌面示例：启用作者演武，选绯衣客、两人、AI 关羽、牌面演练（40 张）、种子 2。实体牌印刷均为黑桃，但本人手牌和判定牌受映绯视为红桃；起手黑桃 K 闪可通过武圣作为红桃杀使用。当前界面、规则与基础 AI 使用同一牌面查询，已宣告牌面在离手后保持快照。这是自定义技能示例，不代表完整小乔或风包已完成。
学习示例：启用作者演武，选问道客、两人、AI 关羽、护盾与转移（48 张）、种子 4。结束首个出牌阶段并完成弃牌，等待 AI 伤害。拾慧获得余响并将新实例显式加入本次受伤时点，首次伤害即可选择发动余响摸一张牌；也可拒绝。后续伤害按普通技能结算，不重复学习。默认固定人类甲席，无设备交接。
可选择关羽、黄盖、孙尚香、赵云、张飞、甘宁、夏侯惇、许褚、甄姬、司马懿、郭嘉、曹操、张辽、刘备、华佗、孙权、吕蒙、陆逊、黄月英、吕布、大乔、马超、周瑜、貂蝉、诸葛亮，共二十五名武将。
诸葛亮观星可调整牌顶/牌底及各组顺序，暂停隐藏私有内容，确认后真实影响后续摸牌；空手时空城禁止成为杀或决斗目标。
选将页可指定全部 AI 席位使用的武将，默认保留原预设；人类始终控制甲席。
马超马术减距离，铁骑红判定禁止本次杀的响应；周瑜英姿阶段多摸一张，反间令目标猜花色并暗选公开获得手牌；貂蝉离间按选中顺序发起不可无懈的决斗，结束阶段可闭月摸牌。
黄月英集智可在使用非转化普通锦囊时摸牌，奇才豁免锦囊距离；吕布无双要求连续两闪或每次两杀；大乔可国色转换方块牌为乐，或弃牌流离转移杀。
孙权制衡可弃手牌/装备换等量牌；主公救援令其他吴角色的桃多回复一点。吕蒙克己按本回合出牌阶段真实活动决定是否跳过弃牌。陆逊谦逊禁止顺手/乐，连营可在失去最后手牌后补牌。
刘备仁德可分批交牌，累计两张首次回血；主公可激将请求蜀角色供杀。华佗青囊弃牌治疗，急救在本人回合外将红牌当桃使用。
曹操可用奸雄取得伤害牌；身份模式仅主公获得护驾，其他魏角色可实际供闪。张辽可用突袭替代普通摸牌，暗取一至两人的手牌。
鬼才可改判，遗计每点伤害独立询问，牌池仅本人可见，可分批交牌，取消选择后保留余牌。枭姬每张离场装备独立询问；多次发动可与同一时点的其他技能交错。
手牌区可查看技能说明；费用和效果弃牌统一检查权限。
手动演练保留原机制角色、交替性别与甲席武圣；标准二十五将已接入，标准包系统语义审计与完整离线版验收仍待完成。
已接入反制链、公开牌池、私有暗选、装备替换、丈八转换、判定与延时锦囊。
八卦阵可判定供闪，青釭剑使此杀忽略防具，仁王盾抵消黑色杀。
借刀杀人在宣告前选择杀目标，可要求另一角色出杀或交出当前武器。
青龙可追加杀，贯石斧可突破闪，方天支持最后手牌杀多目标，麒麟弓可弃坐骑。
雌雄双股剑可令异性目标弃手牌或令来源摸牌，寒冰剑可防止伤害并依次弃置两张牌。
本人位于右下、手牌位于左下，确认在手牌上方，记录从左下工具打开。
二十五名标准武将已接入静态立绘；渡口模块自带渡客图片，导入和重启恢复均无需额外选择资源。图片加载失败时保留轮廓，不阻塞对局。图片为用户提供的本地 noname 参考素材，来源和原始字节哈希保存在源码资源清单中。
基础 AI 只使用本人手牌和公开信息，尚无高级搜索或联机；完整武将与复杂技能仍在开发。
本包 exe 已通过实际 Windows WebView2 运行验证；SHA-256 与原生记录核对。
本地模块：开局页点“导入内容包”，选择本包附带的 harbor.sgs.mjs；自动启用渡口、新将渡客和 40 张演练。选渡客、两人、AI 关羽、渡口演练、种子 2，使用起手备航并发动潮声，手牌净增两张。成功导入后保存模块源码与启用状态，重启会自动恢复；停用/移除会连同依赖它的包一起保存。出现保存或恢复错误时可重载或明确清空，本地源文件不会被修改。
Spineboy 为官方运行时验证样本，其许可见 Spine-LICENSE.txt。
独立资源示例：同时导入 harbor.sgs.mjs 和 gallery.sgs，启用画阁，选择画阁客。gallery.sgs 是普通 ZIP，内含独立原始图片与模块，保存的图片为 Blob，重启自动恢复。画阁客复用渡口的潮声与标准武圣；用渡口演练、两人、AI 关羽、种子 2，可使用备航并发动潮声。移除画阁只移除该扩展，不修改本地源文件。
'@ | Set-Content -LiteralPath (Join-Path $stageRoot 'RUNNING.txt') -Encoding utf8

$version = (Get-Content -LiteralPath (Join-Path $packageRoot 'package.json') -Raw | ConvertFrom-Json).version
$archivePath = Join-Path $buildRoot "sgs-ng-$version-local-client-windows-x64.zip"
$members = @('sgs-ng.exe', 'Spine-LICENSE.txt', 'RUNNING.txt', 'harbor.sgs.mjs', 'gallery.sgs')
$memberPaths = $members | ForEach-Object { Join-Path $stageRoot $_ }
Compress-Archive -LiteralPath $memberPaths -DestinationPath $archivePath -Force

# 校验真正写入 ZIP 的字节及精确成员，不能只比较暂存目录或清单。
$zip = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
try {
  $archiveMembers = @($zip.Entries.FullName)
  if (Compare-Object ($members | Sort-Object) ($archiveMembers | Sort-Object)) {
    throw 'Unexpected archive members.'
  }
  $exeStream = $zip.GetEntry('sgs-ng.exe').Open()
  try {
    $archivedHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($exeStream)).ToLowerInvariant()
  } finally { $exeStream.Dispose() }
  if ($archivedHash -ne $releaseHash) { throw 'Archived executable differs from native proof.' }
  $moduleStream = $zip.GetEntry('harbor.sgs.mjs').Open()
  try { $archivedModuleHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($moduleStream)).ToLowerInvariant() } finally { $moduleStream.Dispose() }
  if ($archivedModuleHash -ne $moduleHash) { throw 'Archived content module differs from native proof.' }
  $resourceStream = $zip.GetEntry('gallery.sgs').Open()
  try { $archivedResourceHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($resourceStream)).ToLowerInvariant() } finally { $resourceStream.Dispose() }
  if ($archivedResourceHash -ne $resourceHash) { throw 'Archived resource bundle differs from native proof.' }
} finally { $zip.Dispose() }

$manifest = [ordered]@{
  capturedAt = (Get-Date).ToUniversalTime().ToString('o')
  stage = 'local-client-practice'
  archive = $archivePath
  bytes = (Get-Item -LiteralPath $archivePath).Length
  archiveSha256 = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  executableSha256 = $releaseHash
  moduleSha256 = $moduleHash
  resourceBundleSha256 = $resourceHash
  members = $members
  nativeProof = '.artifacts/ui/native-smoke-release.json'
  contentRestartProof = '.artifacts/ui/native-content-restart-release.json'
  contentProfileProof = '.artifacts/ui/native-profile-release.json'
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $buildRoot 'local-client-manifest.json') -Encoding utf8
$manifest | ConvertTo-Json -Depth 4

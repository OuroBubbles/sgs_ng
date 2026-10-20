/** 二分分配：先满足组下限，再增广剩余物品。只读兼容矩阵，不认识牌或角色。
 * 返回每件物品的组索引；null 表示确实无解，不用逐个枚举所有分组方案。
 */
export function assignGroups(
  allowed: readonly (readonly boolean[])[],
  limits: readonly { readonly min: number; readonly max: number }[],
): readonly number[] | null {
  if (
    limits.reduce((n, group) => n + group.min, 0) > allowed.length ||
    limits.reduce((n, group) => n + group.max, 0) < allowed.length
  )
    return null;
  const owners = Array<number>(allowed.length).fill(-1);
  // 某组缺一个下限名额时，允许将已分配物品换到此组，并递归补回原组。
  const fill = (group: number, seen: Set<number>): boolean => {
    for (const [item, choices] of allowed.entries()) {
      if (!seen.has(item) && choices[group] && owners[item] === -1) {
        owners[item] = group;
        return true;
      }
    }
    for (const [item, choices] of allowed.entries()) {
      if (seen.has(item) || !choices[group] || owners[item] === group) continue;
      seen.add(item);
      if (fill(owners[item]!, seen)) {
        owners[item] = group;
        return true;
      }
    }
    return false;
  };
  for (const [group, limit] of limits.entries())
    for (let slot = 0; slot < limit.min; slot++) if (!fill(group, new Set())) return null;

  const members = (group: number) =>
    owners.flatMap((owner, item) => (owner === group ? [item] : []));
  const place = (item: number, seen: Set<number>): boolean => {
    for (const [group, limit] of limits.entries()) {
      if (!seen.has(group) && allowed[item]![group] && members(group).length < limit.max) {
        owners[item] = group;
        return true;
      }
    }
    for (const [group] of limits.entries()) {
      if (seen.has(group) || !allowed[item]![group]) continue;
      seen.add(group);
      for (const previous of members(group)) {
        if (place(previous, seen)) {
          owners[item] = group;
          return true;
        }
      }
    }
    return false;
  };
  for (const [item, owner] of owners.entries())
    if (owner === -1 && !place(item, new Set())) return null;
  return owners;
}

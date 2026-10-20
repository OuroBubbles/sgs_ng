export interface SeatRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
/** 区域用左上角定位，席位用中心定位；绘制与 DOM 共用同一份布局。 */
export interface TableRegion {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}
export interface TableLayout {
  readonly width: number;
  readonly height: number;
  readonly compact: boolean;
  readonly focus: number;
  readonly arena: TableRegion;
  readonly hand: TableRegion;
  readonly decision: TableRegion;
  readonly skills: TableRegion;
  readonly choices: TableRegion;
  readonly equipment: readonly TableRegion[];
  readonly seats: readonly SeatRect[];
}

/** 临时牌池优先居中；需要选角色时，给目标中心保留真实点击位置。空白容器不截获指针。 */
export function cardPoolCenter(
  layout: TableLayout,
  count: number,
  cardHeight: number,
  privatePool: boolean,
  targets: readonly SeatRect[],
): number {
  const center = layout.width / 2;
  if (!count) return center;
  const top = layout.arena.height / 2 - cardHeight / 2 + (privatePool ? 9 : 0);
  const blocking = targets.filter((seat) => seat.y >= top && seat.y <= top + cardHeight);
  if (!blocking.length) return center;
  const cardWidth = cardHeight * 0.72;
  const total = count * cardWidth + (count - 1) * 8;
  const margin = total / 2 + 8;
  if (margin * 2 >= layout.width) return center;
  const score = (x: number): number => {
    const distance = Math.min(
      ...blocking.map((seat) =>
        Math.min(
          ...Array.from({ length: count }, (_, index) => {
            const left = x - total / 2 + index * (cardWidth + 8);
            return Math.max(left - seat.x, seat.x - left - cardWidth);
          }),
        ),
      ),
    );
    // 达到 12px 净空后优先靠近桌心，避免为了更大距离把牌池推向边缘。
    return Math.min(12, distance) - Math.abs(x - center) * 0.002;
  };
  let best = center;
  let bestScore = score(best);
  for (let step = 0; step <= 64; step++) {
    const candidate = margin + ((layout.width - margin * 2) * step) / 64;
    const candidateScore = score(candidate);
    if (candidateScore > bestScore) {
      best = candidate;
      bestScore = candidateScore;
    }
  }
  return best;
}

/** 本人固定右下，手牌在左下，确认区在手牌上方；其余席位围绕桌面。 */
export function layoutTable(
  width: number,
  height: number,
  count = 4,
  focus = count - 1,
): TableLayout {
  const compact = height < 420 || width < 650;
  const portrait = width < 600;
  const short = height < 380;
  const pad = 8;
  const gap = 8;
  const selfWidth = portrait ? 86 : short ? 90 : Math.min(158, width * 0.14);
  const selfHeight = portrait ? 162 : short ? 138 : 226;
  const skillWidth = portrait ? 64 : short ? 78 : 104;
  const handHeight = short ? 98 : portrait ? 146 : 188;
  const decisionHeight = portrait ? 98 : short ? 54 : 76;
  const handLeft = portrait ? 39 : 52;
  const selfLeft = width - selfWidth - pad;
  const skillLeft = selfLeft - skillWidth - gap;
  const handTop = height - handHeight - pad;
  const decisionTop = handTop - decisionHeight - gap;
  const arenaHeight = Math.max(80, decisionTop - gap);
  const oneRow = short && count > 4;
  const sideCount = oneRow ? 0 : Math.ceil(Math.max(0, count - 4) / 2);
  const topCount = oneRow ? count - 1 : count < 5 ? Math.max(1, count - 2) : Math.min(3, count - 3);
  const cardWidth = Math.min(portrait ? 82 : 142, width / (topCount + (oneRow ? 0.6 : 2.8)));
  const gearHeight = compact ? 25 : 34;
  const counterHeight = 26;
  const cardHeight = Math.max(
    38,
    Math.min(
      compact ? 110 : 190,
      (arenaHeight - pad * 2 - counterHeight) / Math.max(1, sideCount) - gearHeight - gap,
    ),
  );
  const rightCount = oneRow ? 0 : count <= 4 ? (count === 2 ? 0 : 1) : sideCount;
  const leftCount = count - 1 - topCount - rightCount;
  const slots: SeatRect[] = [];
  const seat = (x: number, y: number): SeatRect => ({
    x: Math.max(cardWidth / 2 + pad, Math.min(width - cardWidth / 2 - pad, x)),
    y: Math.max(
      cardHeight / 2 + pad + counterHeight,
      Math.min(arenaHeight - cardHeight / 2 - gearHeight, y),
    ),
    width: cardWidth,
    height: cardHeight,
  });
  for (let i = 0; i < rightCount; i++)
    slots.push(
      seat(
        width - pad - cardWidth / 2,
        rightCount === 1
          ? arenaHeight * 0.58
          : pad + cardHeight / 2 + i * (arenaHeight - pad * 2 - cardHeight - gearHeight),
      ),
    );
  for (let i = 0; i < topCount; i++) {
    const from = oneRow
      ? cardWidth / 2 + pad
      : count <= 4
        ? cardWidth / 2 + pad + width * 0.08
        : cardWidth * 1.5 + pad + gap;
    const to = oneRow
      ? width - cardWidth / 2 - pad
      : count <= 4
        ? width * 0.56
        : width - cardWidth * 1.5 - pad - gap;
    slots.push(
      seat(
        topCount === 1 ? width * 0.3 : from + ((to - from) * i) / (topCount - 1),
        pad + counterHeight + cardHeight / 2,
      ),
    );
  }
  for (let i = 0; i < leftCount; i++)
    slots.push(
      seat(
        pad + cardWidth / 2,
        leftCount === 1
          ? arenaHeight * 0.62
          : pad + cardHeight / 2 + i * (arenaHeight - pad * 2 - cardHeight - gearHeight),
      ),
    );
  const seats = Array.from(
    { length: count },
    (_, index): SeatRect =>
      index === focus
        ? {
            x: selfLeft + selfWidth / 2,
            y: height - selfHeight / 2 - pad,
            width: selfWidth,
            height: selfHeight,
          }
        : slots[(index - focus - 1 + count) % count]!,
  );
  return {
    width,
    height,
    compact,
    focus,
    arena: { left: 0, top: 0, width, height: arenaHeight },
    hand: {
      left: handLeft,
      top: handTop,
      width: Math.max(80, skillLeft - handLeft - gap),
      height: handHeight,
    },
    decision: {
      left: handLeft,
      top: decisionTop,
      width: selfLeft - handLeft - gap,
      height: decisionHeight,
    },
    skills: { left: skillLeft, top: height - 58 - pad, width: skillWidth, height: 58 },
    choices: {
      left: width * 0.22,
      top: arenaHeight * 0.43,
      width: width * 0.56,
      height: Math.min(150, arenaHeight * 0.48),
    },
    equipment: seats.map((item, index) =>
      index === focus
        ? {
            left: skillLeft,
            top: height - selfHeight - pad,
            width: skillWidth,
            height: selfHeight - 68,
          }
        : {
            left: item.x - item.width / 2,
            top: item.y + item.height / 2 + 3,
            width: item.width,
            height: gearHeight,
          },
    ),
    seats,
  };
}

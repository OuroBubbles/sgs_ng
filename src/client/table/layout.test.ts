import { describe, expect, it } from 'vitest';
import { layoutTable, cardPoolCenter } from './layout';

describe('战场绘制与输入共用布局', () => {
  it('私有双牌池保持在结算区，并给各席位的目标中心留出点击位置', () => {
    for (const [width, height] of [
      [1100, 690],
      [366, 680],
      [865, 286],
      [700, 260],
    ])
      for (const count of [2, 4, 6, 8]) {
        const layout = layoutTable(width!, height!, count, 0);
        const cardHeight = Math.max(32, Math.min(122, layout.arena.height - 28));
        const x = cardPoolCenter(layout, 2, cardHeight, true, layout.seats);
        const cardWidth = cardHeight * 0.72;
        const total = cardWidth * 2 + 8;
        const top = layout.arena.height / 2 - cardHeight / 2 + 9;
        expect(top + cardHeight).toBeLessThan(layout.decision.top);
        expect(x - total / 2).toBeGreaterThanOrEqual(0);
        expect(x + total / 2).toBeLessThanOrEqual(width!);
        for (const seat of layout.seats.filter(
          (seat) => seat.y >= top && seat.y <= top + cardHeight,
        ))
          for (const left of [x - total / 2, x + 4])
            expect(seat.x <= left || seat.x >= left + cardWidth).toBe(true);
      }
  });
  it.each([
    [1100, 690],
    [366, 680],
    [865, 286],
    [700, 260],
  ])('%s × %s 的席位完整位于战场内', (width, height) => {
    for (const count of [2, 4, 6, 8])
      for (let focus = 0; focus < count; focus++)
        for (const seat of layoutTable(width, height, count, focus).seats) {
          expect(seat.x - seat.width / 2).toBeGreaterThanOrEqual(0);
          expect(seat.x + seat.width / 2).toBeLessThanOrEqual(width);
          expect(seat.y - seat.height / 2).toBeGreaterThanOrEqual(0);
          expect(seat.y + seat.height / 2).toBeLessThanOrEqual(height);
        }
  });
  it('本人在右下、手牌在左下，确认位于手牌上方，技能紧邻本人', () => {
    for (const [width, height] of [
      [1100, 690],
      [366, 680],
      [865, 286],
    ]) {
      const layout = layoutTable(width!, height!, 4, 2);
      const self = layout.seats[2]!;
      expect(self.x).toBeGreaterThan(layout.width * 0.7);
      expect(self.y).toBeGreaterThan(layout.height * 0.65);
      expect(layout.hand.left + layout.hand.width).toBeLessThan(self.x - self.width / 2);
      expect(layout.decision.top + layout.decision.height).toBeLessThan(layout.hand.top);
      expect(layout.skills.left + layout.skills.width).toBeLessThan(self.x - self.width / 2);
    }
  });
  it('所有席位互不覆盖，装备区和操作区均在完整牌桌内', () => {
    for (const [width, height] of [
      [1100, 690],
      [366, 680],
      [865, 286],
      [700, 260],
    ])
      for (const count of [2, 4, 6, 8]) {
        const layout = layoutTable(width!, height!, count, 0);
        for (let i = 0; i < layout.seats.length; i++)
          for (let j = i + 1; j < layout.seats.length; j++) {
            const a = layout.seats[i]!;
            const b = layout.seats[j]!;
            expect(
              Math.abs(a.x - b.x) >= (a.width + b.width) / 2 ||
                Math.abs(a.y - b.y) >= (a.height + b.height) / 2,
            ).toBe(true);
          }
        for (const region of [layout.hand, layout.decision, layout.skills, ...layout.equipment]) {
          expect(region.left).toBeGreaterThanOrEqual(0);
          expect(region.top).toBeGreaterThanOrEqual(0);
          expect(region.left + region.width).toBeLessThanOrEqual(layout.width);
          expect(region.top + region.height).toBeLessThanOrEqual(layout.height);
        }
      }
  });
});

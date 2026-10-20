/** 每局独立的 xorshift32；不读取时间，整数抽取用拒绝采样避免模偏差。 */
export class Random {
  #state: number;
  constructor(seed: number) {
    if (!Number.isInteger(seed) || seed < 1 || seed > 0xffffffff)
      throw new Error('Seed must be a nonzero uint32.');
    this.#state = seed;
  }

  integer(bound: number): number {
    if (!Number.isSafeInteger(bound) || bound < 1 || bound > 0x100000000)
      throw new Error('Invalid random bound.');
    // xorshift32 的周期不包含零，映射到 [0, 2^32-2] 后再做无偏采样。
    const range = 0xffffffff;
    if (bound > range) throw new Error('Bound exceeds the generator range.');
    const limit = range - (range % bound);
    let sample: number;
    do {
      let x = this.#state;
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      this.#state = x >>> 0;
      sample = this.#state - 1;
    } while (sample >= limit);
    return sample % bound;
  }
}

import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { GenerateAldepDto, ClosenessLetter } from './dto/aldep.dto';

type Weights = {
  A: number;
  E: number;
  I: number;
  O: number;
  U: number;
  X: number;
  blank: number;
};
type Dept = {
  idx: number;
  name: string;
  area: number;
  fixed: boolean;
};
type Rect = {
  name: string;
  idx: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

const LETTER_ORDER: ClosenessLetter[] = ['A', 'E', 'I', 'O', 'U', 'X', ''];
const SIDE_DIRS = [
  { dx: 1, dy: 0, w: 1 },
  { dx: -1, dy: 0, w: 1 },
  { dx: 0, dy: 1, w: 1 },
  { dx: 0, dy: -1, w: 1 },
];
const CORN_DIRS = [
  { dx: 1, dy: 1, w: 0.5 },
  { dx: 1, dy: -1, w: 0.5 },
  { dx: -1, dy: 1, w: 0.5 },
  { dx: -1, dy: -1, w: 0.5 },
];

function rng(seed: number) {
  // Mulberry32
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

@Injectable()
export class AldepService {
  constructor(private prisma: DatabaseService) {}

  private w(letter: string, W: Weights) {
    const L = (letter || '').toUpperCase() as keyof Weights | '';
    return L === '' ? (W.blank ?? 0) : (W[L] ?? 0);
  }

  private weightPair(i: number, j: number, letters: string[][], W: Weights) {
    const lij = (letters?.[i]?.[j] ?? '').toString().toUpperCase() as
      | keyof Weights
      | '';
    const lji = (letters?.[j]?.[i] ?? '').toString().toUpperCase() as
      | keyof Weights
      | '';
    const wij = lij === '' ? (W.blank ?? 0) : (W[lij] ?? 0);
    const wji = lji === '' ? (W.blank ?? 0) : (W[lji] ?? 0);
    return Math.max(wij, wji);
  }

  private letterRank(letter: ClosenessLetter) {
    const k = LETTER_ORDER.indexOf(letter ?? '');
    return k < 0 ? LETTER_ORDER.length : k;
  }

  private fits(
    owner: number[][],
    W: number,
    H: number,
    x: number,
    y: number,
    w: number,
    h: number,
  ) {
    if (x < 0 || y < 0 || x + w > W || y + h > H) return false;
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) if (owner[yy][xx] !== -1) return false;
    return true;
  }

  private mark(
    owner: number[][],
    x: number,
    y: number,
    w: number,
    h: number,
    idx: number,
  ) {
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) owner[yy][xx] = idx;
  }

  private factorPairs(n: number, maxW: number, maxH: number) {
    const out: Array<{ w: number; h: number }> = [];
    for (let w = 1; w <= Math.min(n, maxW); w++) {
      if (n % w) continue;
      const h = n / w;
      if (h <= maxH) out.push({ w, h });
    }
    out.sort((a, b) => Math.abs(a.w - a.h) - Math.abs(b.w - b.h));
    return out;
  }

  /** “กวาดเป็นแถบคอลัมน์” ซ้าย→ขวา ทีละแถบความกว้าง = stripWidth จากบนลงล่าง */
  private sweepCellsByStrip(W: number, H: number, stripWidth: number) {
    const sw = Math.max(1, Math.min(stripWidth | 0 || 1, W));
    const coords: Array<{ x: number; y: number }> = [];
    for (let sx = 0; sx < W; sx += sw) {
      const ex = Math.min(W, sx + sw);
      for (let y = 0; y < H; y++) {
        for (let x = sx; x < ex; x++) coords.push({ x, y });
      }
    }
    return coords;
  }

  /** เลือกลำดับ ALDEP: เริ่มจากสุ่มหนึ่งแผนก → เลือกถัดไปที่สัมพันธ์กับชุดที่วางแล้ว โดยต้อง ≥ lowerBound */
  private buildOrder(
    depts: Dept[],
    letters: string[][],
    lowerBound: ClosenessLetter,
    R: () => number,
  ) {
    const n = depts.length;
    const order: number[] = [];
    const placed = new Set<number>();
    const idxs = depts.map((d) => d.idx);

    // random seed dept
    const first = idxs[Math.floor(R() * idxs.length)];
    order.push(first);
    placed.add(first);

    const lbRank = this.letterRank(lowerBound ?? 'A');

    while (placed.size < n) {
      // หา candidates ที่มีความสัมพันธ์กับ “ใดๆใน placed” โดย rank(letter) <= rank(lowerBound)
      const cand: number[] = [];
      for (const i of idxs) {
        if (placed.has(i)) continue;
        let ok = false;
        placed.forEach((j) => {
          const lij = (letters[i]?.[j] ?? '').toUpperCase() as ClosenessLetter;
          const lji = (letters[j]?.[i] ?? '').toUpperCase() as ClosenessLetter;
          const r1 = this.letterRank(lij),
            r2 = this.letterRank(lji);
          if (Math.min(r1, r2) <= lbRank) ok = true;
        });
        if (ok) cand.push(i);
      }

      if (cand.length) {
        // break tie แบบ heuristic: ให้คะแนน “max weight กับชุด placed”
        let best = cand[0],
          bestScore = -Infinity;
        for (const i of cand) {
          let s = 0;
          placed.forEach((j) => {
            const lij = (letters[i]?.[j] ?? '').toUpperCase();
            const lji = (letters[j]?.[i] ?? '').toUpperCase();
            // ยิ่งตัวอักษรสำคัญ (A>E>...) ยิ่งดี
            const rank = Math.min(
              this.letterRank(lij as any),
              this.letterRank(lji as any),
            );
            s += LETTER_ORDER.length - rank;
          });
          // เติม noise นิดเพื่อแตกคะแนนที่เท่ากัน
          s += 1e-6 * R();
          if (s > bestScore) {
            bestScore = s;
            best = i;
          }
        }
        order.push(best);
        placed.add(best);
      } else {
        // ไม่เจอใครผ่าน lowerBound → เลือกแบบสุ่มจากที่เหลือ
        const rest = idxs.filter((i) => !placed.has(i));
        const rnd = rest[Math.floor(R() * rest.length)];
        order.push(rnd);
        placed.add(rnd);
      }
    }
    return order;
  }

  /** วางผังตาม strip sweep + แตกชิ้น (optional) */
  private placeBySweep(
    order: number[],
    depts: Dept[],
    W: number,
    H: number,
    allowSplitting: boolean,
    maxFragments: number,
    stripWidth: number,
  ) {
    const owner = Array.from({ length: H }, () => Array(W).fill(-1));
    const placements: Rect[] = [];
    const byIdx = new Map<number, Dept>(depts.map((d) => [d.idx, d]));
    const starts = this.sweepCellsByStrip(W, H, stripWidth);

    for (const i of order) {
      const d = byIdx.get(i)!;
      let remain = Math.max(0, Math.floor(d.area));

      // ลองวางเต็มก้อนก่อน
      const fp = this.factorPairs(remain, W, H);
      let doneWhole = false;
      for (const { w, h } of fp) {
        for (const { x, y } of starts) {
          if (this.fits(owner, W, H, x, y, w, h)) {
            this.mark(owner, x, y, w, h, i);
            placements.push({
              name: d.name,
              idx: i,
              x,
              y,
              width: w,
              height: h,
            });
            remain = 0;
            doneWhole = true;
            break;
          }
        }
        if (doneWhole) break;
      }

      // แตกชิ้น
      if (remain > 0 && allowSplitting) {
        let frag = 0;
        outer: for (const { x, y } of starts) {
          if (owner[y][x] !== -1) continue;
          let best: { x: number; y: number; w: number; h: number } | null =
            null;
          const maxA = Math.min(8, remain);
          for (let a = maxA; a >= 1; a--) {
            for (let w = 1; w <= a; w++) {
              if (a % w) continue;
              const h = a / w;
              if (this.fits(owner, W, H, x, y, w, h)) {
                best = { x, y, w, h };
                break;
              }
            }
            if (best) break;
          }
          if (!best) continue;
          this.mark(owner, best.x, best.y, best.w, best.h, i);
          placements.push({
            name: d.name,
            idx: i,
            x: best.x,
            y: best.y,
            width: best.w,
            height: best.h,
          });
          remain -= best.w * best.h;
          frag++;
          if (remain <= 0 || frag >= Math.max(1, maxFragments)) break outer;
        }
        for (const { x, y } of starts) {
          if (remain <= 0) break;
          if (owner[y][x] === -1) {
            owner[y][x] = i;
            placements.push({
              name: d.name,
              idx: i,
              x,
              y,
              width: 1,
              height: 1,
            });
            remain--;
          }
        }
      }

      // ไม่อนุญาตแตก → ปู 1x1
      if (remain > 0 && !allowSplitting) {
        for (const { x, y } of starts) {
          if (remain <= 0) break;
          if (owner[y][x] === -1) {
            owner[y][x] = i;
            placements.push({
              name: d.name,
              idx: i,
              x,
              y,
              width: 1,
              height: 1,
            });
            remain--;
          }
        }
      }
    }
    return { owner, placements };
  }

  /** คำนวณคะแนน PR-like ของผัง (เพื่อนบ้าน 8 ทิศ) */
  private scorePR(
    placements: Rect[],
    owner: number[][],
    letters: string[][],
    Wmap: Weights,
  ) {
    let total = 0;
    const H = owner.length,
      W = owner[0]?.length ?? 0;
    for (const r of placements) {
      for (const d of SIDE_DIRS.concat(CORN_DIRS)) {
        const nx = r.x + d.dx,
          ny = r.y + d.dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H) {
          const nb = owner[ny][nx];
          if (nb >= 0 && nb !== r.idx) {
            total += d.w * this.weightPair(r.idx, nb, letters, Wmap);
          }
        }
      }
    }
    return total;
  }

  async generate(dto: GenerateAldepDto) {
    const Wmap: Weights = {
      A: dto.closenessWeights?.A ?? 10,
      E: dto.closenessWeights?.E ?? 8,
      I: dto.closenessWeights?.I ?? 6,
      O: dto.closenessWeights?.O ?? 4,
      U: dto.closenessWeights?.U ?? 2,
      X: dto.closenessWeights?.X ?? 0,
      blank: dto.closenessWeights?.blank ?? 0,
    };

    const gridW = dto.gridWidth,
      gridH = dto.gridHeight;
    const lowerBound = dto.lowerBound ?? 'A';
    const stripWidth = Math.max(1, dto.stripWidth ?? 1);
    const seeds = Math.max(1, dto.seeds ?? 8);
    const allowSplitting = dto.allowSplitting ?? true;
    const maxFragments = Math.max(1, dto.maxFragmentsPerDept ?? 3);

    const letters = dto.closenessMatrix;
    const depts: Dept[] = (dto.departments || [])
      .filter((d) => (d?.area ?? 0) > 0)
      .map((d, i) => ({
        idx: i,
        name: d.name,
        area: Math.floor(d.area ?? 0),
        fixed: !!d.fixed,
      }));

    // wide sweep
    let best: any = null;
    let bestScore = -Infinity;
    const baseSeed = (dto.randomSeed ?? Date.now()) | 0;

    for (let s = 0; s < seeds; s++) {
      const R = rng(baseSeed + s * 9973);
      const order = this.buildOrder(depts, letters, lowerBound, R);
      const { owner, placements } = this.placeBySweep(
        order,
        depts,
        gridW,
        gridH,
        allowSplitting,
        maxFragments,
        stripWidth,
      );
      const score = this.scorePR(placements, owner, letters, Wmap);
      if (score > bestScore) {
        bestScore = score;
        best = { order, owner, placements, score };
      }
    }

    const result = {
      mode: 'ALDEP',
      params: {
        lowerBound,
        stripWidth,
        seeds,
        allowSplitting,
        maxFragmentsPerDept: maxFragments,
      },
      score: { total: bestScore },
      order: best.order.map((i: number) => depts[i].name),
      placements: best.placements,
      ownerGrid: best.owner,
      grid: {
        width: gridW,
        height: gridH,
        cellSizeMeters: dto.cellSizeMeters ?? null,
      },
    };

    const saved = await this.prisma.aldepRun.create({
      data: {
        projectId: dto.projectId,
        name: dto.name ?? `ALDEP ${new Date().toLocaleString()}`,
        gridWidth: gridW,
        gridHeight: gridH,
        lowerBound,
        stripWidth,
        seeds,
        cellSizeMeters: dto.cellSizeMeters ?? null,
        inputJson: dto as any,
        resultJson: result as any,
      },
      select: { id: true },
    });

    return { runId: saved.id, ...result };
  }

  async getRun(id: string) {
    const run = await this.prisma.aldepRun.findUnique({ where: { id } });
    if (!run) return { error: 'not_found' };
    return run;
  }
}

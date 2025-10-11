import { Injectable } from '@nestjs/common';
import { CreateCorelapDto } from './dto/corelap.dto';

type Weights = {
  A: number;
  E: number;
  I: number;
  O: number;
  U: number;
  X: number;
  blank: number;
};

type Letter = '' | 'A' | 'E' | 'I' | 'O' | 'U' | 'X';
const TIER_ORDER: Letter[] = ['A', 'E', 'I', 'O', 'U'];

type DeptNode = {
  idx: number;
  name: string;
  cells: number; // total requested cells
  remaining: number; // cells not yet placed
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

type GenerateOptions = {
  allowSplitting: boolean;
  maxFragmentsPerDept: number; // default 3
  cellSizeMeters: number; // informational
};

@Injectable()
export class CorelapService {
  // map closeness letter -> weight; '' maps to W.blank
  private w(letter: string, W: Weights) {
    const raw = (letter || '').toUpperCase() as Letter;
    const key = (raw === '' ? 'blank' : raw) as keyof Weights;
    return (W[key] ?? 0) as number;
  }

  // build symmetric weight matrix W* = W + W^T (diagonal = 0)
  private numericMatrixSym(letters: string[][], W: Weights): number[][] {
    const n = letters.length;
    const M = Array.from({ length: n }, () => Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const lij = (letters?.[i]?.[j] ?? '').toString();
        const lji = (letters?.[j]?.[i] ?? '').toString();
        M[i][j] = this.w(lij, W) + this.w(lji, W);
      }
      M[i][i] = 0;
    }
    return M;
  }

  // classic TCR from symmetric matrix
  private tcr(i: number, Msym: number[][]) {
    let s = 0;
    for (let j = 0; j < Msym.length; j++) s += Msym[i][j];
    return s;
  }

  // total shared-wall length between rectangles (no corner-touch credit)
  private sharedEdgeLen(a: Rect, b: Rect): number {
    const touchLR = a.x + a.width === b.x || b.x + b.width === a.x;
    const yOverlap = Math.max(
      0,
      Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
    );
    const touchTB = a.y + a.height === b.y || b.y + b.height === a.y;
    const xOverlap = Math.max(
      0,
      Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    );
    const verticalShare = touchLR ? yOverlap : 0;
    const horizontalShare = touchTB ? xOverlap : 0;
    return verticalShare + horizontalShare;
  }

  private fits(
    occ: boolean[][],
    W: number,
    H: number,
    x: number,
    y: number,
    w: number,
    h: number,
  ) {
    if (x < 0 || y < 0 || x + w > W || y + h > H) return false;
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (occ[yy][xx]) return false;
      }
    }
    return true;
  }

  private mark(
    occ: boolean[][],
    x: number,
    y: number,
    w: number,
    h: number,
    v: boolean,
  ) {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        occ[yy][xx] = v;
      }
    }
  }

  // factor pairs (w,h) where w*h = n and bounds-checked
  private factorPairs(
    n: number,
    maxW: number,
    maxH: number,
  ): Array<{ w: number; h: number }> {
    const out: Array<{ w: number; h: number }> = [];
    for (let w = 1; w <= Math.min(n, maxW); w++) {
      if (n % w !== 0) continue;
      const h = n / w;
      if (h <= maxH) out.push({ w, h });
    }
    // prefer near-square shapes
    out.sort((a, b) => Math.abs(a.w - a.h) - Math.abs(b.w - b.h));
    return out;
  }

  // choose best rectangle position by PR = sum(sharedEdge × Msym)
  private bestPlacementForPiece(
    pieceCells: number,
    deptIdx: number,
    occ: boolean[][],
    placedRects: Rect[],
    Msym: number[][],
    W: number,
    H: number,
  ): Rect | null {
    const candidates = this.factorPairs(pieceCells, W, H);
    if (!candidates.length) return null;

    let best: { score: number; rect: Rect } | null = null;

    for (const { w, h } of candidates) {
      for (let y = 0; y + h <= H; y++) {
        for (let x = 0; x + w <= W; x++) {
          if (!this.fits(occ, W, H, x, y, w, h)) continue;

          const candidate: Rect = { name: '', idx: deptIdx, x, y, width: w, height: h };

          // placement rating (PR) against all already placed rects
          let pr = 0;
          for (const r of placedRects) {
            const len = this.sharedEdgeLen(candidate, r);
            if (len > 0) pr += len * Msym[deptIdx][r.idx];
          }

          // small bias to stick to the cluster
          const touchBonus = placedRects.some(
            (r) => this.sharedEdgeLen(candidate, r) > 0,
          )
            ? 0.1
            : 0;
          const score = pr + touchBonus;

          if (!best || score > best.score) best = { score, rect: candidate };
        }
      }
    }
    return best ? best.rect : null;
  }

  // Tier-first (A>E>I>O>U) selection then tie-break by TCR (classic CORELAP pick)
  private pickNextByTier(
    letters: string[][],
    placed: Set<number>,
    tcrs: number[],
    nodes: { idx: number; remaining: number }[],
  ): number {
    const unplaced = nodes.filter((n) => n.remaining > 0).map((n) => n.idx);
    if (unplaced.length === 0) return -1;

    for (const tier of TIER_ORDER) {
      const bucket: number[] = [];
      for (const i of unplaced) {
        let ok = false;
        placed.forEach((j) => {
          const lij = (letters[i]?.[j] ?? '').toUpperCase();
          const lji = (letters[j]?.[i] ?? '').toUpperCase();
          if (lij === tier || lji === tier) ok = true;
        });
        if (ok) bucket.push(i);
      }
      if (bucket.length) {
        // pick highest TCR within this tier
        let best = bucket[0];
        for (const i of bucket) if (tcrs[i] > tcrs[best]) best = i;
        return best;
      }
    }

    // fallback: no tier relation with placed → pick highest TCR overall
    let best = unplaced[0];
    for (const i of unplaced) if (tcrs[i] > tcrs[best]) best = i;
    return best;
  }

  generate(dto: CreateCorelapDto, opts: GenerateOptions) {
    const W: Weights = {
      A: dto.closenessWeights?.A ?? 10,
      E: dto.closenessWeights?.E ?? 8,
      I: dto.closenessWeights?.I ?? 6,
      O: dto.closenessWeights?.O ?? 4,
      U: dto.closenessWeights?.U ?? 2,
      X: dto.closenessWeights?.X ?? 0,
      blank: dto.closenessWeights?.blank ?? 0,
    };

    const gridW = dto.gridWidth;
    const gridH = dto.gridHeight;

    const nodes: DeptNode[] = (dto.departments || []).map((d, i) => ({
      idx: i,
      name: d.name,
      cells: Math.max(0, Math.floor(d.area ?? 0)),
      remaining: Math.max(0, Math.floor(d.area ?? 0)),
      fixed: !!d.fixed,
    }));

    // capacity check
    const capacity = gridW * gridH;
    const required = nodes.reduce((s, n) => s + n.cells, 0);
    if (required > capacity) {
      return {
        error: `Cells required (${required}) exceed grid capacity (${capacity})`,
        grid: { width: gridW, height: gridH, cellSizeMeters: opts.cellSizeMeters },
      };
    }

    const letters = dto.closenessMatrix as string[][];
    const Msym = this.numericMatrixSym(letters, W); // use symmetric weights for TCR & PR

    // seed by max TCR (tie -> larger area)
    const tcrs = nodes.map((n) => this.tcr(n.idx, Msym));
    let seedIdx = nodes[0]?.idx ?? 0;
    let maxTCR = -Infinity;
    nodes.forEach((n) => {
      if (tcrs[n.idx] > maxTCR) {
        maxTCR = tcrs[n.idx];
        seedIdx = n.idx;
      } else if (tcrs[n.idx] === maxTCR && n.cells > nodes[seedIdx].cells) {
        seedIdx = n.idx;
      }
    });

    // occupancy map
    const occ: boolean[][] = Array.from({ length: gridH }, () => Array<boolean>(gridW).fill(false));
    const placements: Rect[] = [];
    const placedSet = new Set<number>();
    const fragmentsCount = new Map<number, number>();

    // place seed (try full piece, then split if allowed)
    const placeSeed = () => {
      const target = nodes[seedIdx];
      const maxFrag = Math.max(1, opts.maxFragmentsPerDept || 1);
      const tryCells = (cells: number) =>
        this.bestPlacementForPiece(cells, seedIdx, occ, placements, Msym, gridW, gridH);

      let rect = tryCells(target.remaining);
      if (!rect && opts.allowSplitting) {
        const chunk = Math.max(1, Math.ceil(target.cells / maxFrag));
        let cells = Math.min(chunk, target.remaining);
        while (!rect && cells > 0) {
          rect = tryCells(cells);
          if (!rect) cells--;
        }
      }
      if (!rect) {
        for (let y = 0; y < gridH; y++) {
          for (let x = 0; x < gridW; x++) {
            if (!occ[y][x]) {
              rect = { name: target.name, idx: seedIdx, x, y, width: 1, height: 1 };
              break;
            }
          }
          if (rect) break;
        }
      }
      if (!rect) return false;

      this.mark(occ, rect.x, rect.y, rect.width, rect.height, true);
      rect.name = target.name;
      placements.push(rect);
      target.remaining -= rect.width * rect.height;
      placedSet.add(seedIdx);
      fragmentsCount.set(seedIdx, 1);
      return true;
    };

    if (!placeSeed()) {
      return {
        error: 'Cannot place seed department',
        tcrs,
        grid: { width: gridW, height: gridH },
      };
    }

    const departmentOrder: string[] = [nodes[seedIdx].name];

    // main loop: Tier-first selection, PR-based placement, allow splitting
    while (nodes.some((n) => n.remaining > 0)) {
      const nextIdx = this.pickNextByTier(letters, placedSet, tcrs, nodes);
      if (nextIdx === -1) break;

      const target = nodes[nextIdx];
      if (!target || target.remaining <= 0) {
        placedSet.add(nextIdx);
        continue;
      }

      const maxFrag = Math.max(1, opts.maxFragmentsPerDept || 1);
      const already = fragmentsCount.get(nextIdx) ?? 0;
      const fragsLeft = Math.max(1, maxFrag - already);
      const chunk = opts.allowSplitting
        ? Math.max(1, Math.ceil(target.remaining / fragsLeft))
        : target.remaining;

      let rect = this.bestPlacementForPiece(
        Math.min(chunk, target.remaining),
        nextIdx,
        occ,
        placements,
        Msym,
        gridW,
        gridH,
      );

      let tryCells = Math.min(chunk, target.remaining);
      while (!rect && tryCells > 0) {
        tryCells--;
        rect = this.bestPlacementForPiece(tryCells, nextIdx, occ, placements, Msym, gridW, gridH);
      }

      if (!rect) {
        outer: for (let y = 0; y < gridH; y++) {
          for (let x = 0; x < gridW; x++) {
            if (!occ[y][x]) {
              rect = { name: target.name, idx: nextIdx, x, y, width: 1, height: 1 };
              break outer;
            }
          }
        }
      }

      if (!rect) break;

      this.mark(occ, rect.x, rect.y, rect.width, rect.height, true);
      rect.name = target.name;
      placements.push(rect);
      target.remaining -= rect.width * rect.height;
      fragmentsCount.set(nextIdx, (fragmentsCount.get(nextIdx) ?? 0) + 1);

      if (!placedSet.has(nextIdx)) {
        placedSet.add(nextIdx);
        departmentOrder.push(target.name);
      }
    }

    // score by symmetric weights
    let closenessScore = 0;
    for (let i = 0; i < placements.length; i++) {
      for (let j = i + 1; j < placements.length; j++) {
        const a = placements[i], b = placements[j];
        if (a.idx === b.idx) continue;
        const len = this.sharedEdgeLen(a, b);
        if (len > 0) closenessScore += len * Msym[a.idx][b.idx];
      }
    }
    const total = closenessScore;

    return {
      grid: { width: gridW, height: gridH, cellSizeMeters: opts.cellSizeMeters },
      tcr: nodes.map((n) => ({ name: n.name, tcr: tcrs[n.idx] })),
      seed: nodes[seedIdx].name,
      order: departmentOrder,
      score: { total, closeness: closenessScore },
      placements: placements.map((r, k) => ({
        name: r.name,
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        part: k,
      })),
    };
  }
}

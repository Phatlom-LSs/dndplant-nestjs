// src/CORELAP/corelap.service.ts
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
  cells: number;      // total requested cells
  remaining: number;  // cells not yet placed
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
  cellSizeMeters: number;      // informational
};

const CENTER_PULL = 0.06;
const EDGE_PADDING = 0.03;
const TOUCH_BONUS = 0.1;
const JITTER = 1e-3;

type PlacementMeta = {
  pr: number;
  score: number;
  touching: boolean;
  edges: Array<{ with: number; weight: number; count: number; side: 'L'|'R'|'T'|'B' }>;
  corners: Array<{ with: number; weight: number; corner: 'TL'|'TR'|'BL'|'BR' }>;
};

type PlacementStep = {
  step: number;
  name: string;
  idx: number;
  x: number;
  y: number;
  width: number;
  height: number;
  pr: number;
  score: number;
  tier?: Letter | 'none';
  tcr: number;
};

function clusterCentroid(placed: Rect[]) {
  if (!placed.length) return null;
  let ax = 0, ay = 0, a = 0;
  for (const r of placed) {
    const area = r.width * r.height;
    ax += (r.x + r.width / 2) * area;
    ay += (r.y + r.height / 2) * area;
    a += area;
  }
  return { cx: ax / a, cy: ay / a };
}

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

  // TCR (classic) from symmetric matrix
  private tcr(i: number, Msym: number[][]) {
    let s = 0;
    for (let j = 0; j < Msym.length; j++) s += Msym[i][j];
    return s;
  }

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
    owner: number[][],
    x: number,
    y: number,
    w: number,
    h: number,
    v: boolean,
    deptIdx: number,
  ) {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        occ[yy][xx] = v;
        owner[yy][xx] = v ? deptIdx : -1;
      }
    }
  }

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
    out.sort((a, b) => Math.abs(a.w - a.h) - Math.abs(b.w - b.h));
    return out;
  }

  private weightFromLetters(
    i: number,
    j: number,
    letters: string[][],
    W: Weights,
  ) {
    const lij = (letters?.[i]?.[j] ?? '').toString().toUpperCase() as keyof Weights | '';
    const lji = (letters?.[j]?.[i] ?? '').toString().toUpperCase() as keyof Weights | '';
    const wij = lij === '' ? (W.blank ?? 0) : (W[lij] ?? 0);
    const wji = lji === '' ? (W.blank ?? 0) : (W[lji] ?? 0);
    return Math.max(wij, wji);
  }

  // ---- NEW: evaluate PR/score for a candidate rect (and collect meta)
  private evaluatePlacement(
    rect: Rect,
    occ: boolean[][],
    owner: number[][],
    letters: string[][],
    Wmap: Weights,
    gridW: number,
    gridH: number,
    targetX: number,
    targetY: number,
  ): PlacementMeta {
    let pr = 0;
    let touching = false;
    const edges: PlacementMeta['edges'] = [];
    const corners: PlacementMeta['corners'] = [];

    // Top/Bottom edges
    for (let xx = rect.x; xx < rect.x + rect.width; xx++) {
      // top
      if (rect.y - 1 >= 0 && occ[rect.y - 1][xx]) {
        touching = true;
        const nb = owner[rect.y - 1][xx];
        if (nb >= 0) {
          const w = this.weightFromLetters(rect.idx, nb, letters, Wmap);
          pr += 1.0 * w;
          edges.push({ with: nb, weight: w, count: 1, side: 'T' });
        }
      }
      // bottom
      if (rect.y + rect.height < gridH && occ[rect.y + rect.height][xx]) {
        touching = true;
        const nb = owner[rect.y + rect.height][xx];
        if (nb >= 0) {
          const w = this.weightFromLetters(rect.idx, nb, letters, Wmap);
          pr += 1.0 * w;
          edges.push({ with: nb, weight: w, count: 1, side: 'B' });
        }
      }
    }

    // Left/Right edges
    for (let yy = rect.y; yy < rect.y + rect.height; yy++) {
      // left
      if (rect.x - 1 >= 0 && occ[yy][rect.x - 1]) {
        touching = true;
        const nb = owner[yy][rect.x - 1];
        if (nb >= 0) {
          const w = this.weightFromLetters(rect.idx, nb, letters, Wmap);
          pr += 1.0 * w;
          edges.push({ with: nb, weight: w, count: 1, side: 'L' });
        }
      }
      // right
      if (rect.x + rect.width < gridW && occ[yy][rect.x + rect.width]) {
        touching = true;
        const nb = owner[yy][rect.x + rect.width];
        if (nb >= 0) {
          const w = this.weightFromLetters(rect.idx, nb, letters, Wmap);
          pr += 1.0 * w;
          edges.push({ with: nb, weight: w, count: 1, side: 'R' });
        }
      }
    }

    // Corners (0.5 × weight)
    const cs = [
      { px: rect.x - 1, py: rect.y - 1, tag: 'TL' as const },
      { px: rect.x + rect.width, py: rect.y - 1, tag: 'TR' as const },
      { px: rect.x - 1, py: rect.y + rect.height, tag: 'BL' as const },
      { px: rect.x + rect.width, py: rect.y + rect.height, tag: 'BR' as const },
    ];
    for (const c of cs) {
      if (c.px >= 0 && c.py >= 0 && c.px < gridW && c.py < gridH && occ[c.py][c.px]) {
        touching = true;
        const nb = owner[c.py][c.px];
        if (nb >= 0) {
          const w = this.weightFromLetters(rect.idx, nb, letters, Wmap);
          pr += 0.5 * w;
          corners.push({ with: nb, weight: w, corner: c.tag });
        }
      }
    }

    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const centerGain = -(Math.abs(cx - targetX) + Math.abs(cy - targetY));
    const pad = Math.min(
      rect.x,
      rect.y,
      gridW - (rect.x + rect.width),
      gridH - (rect.y + rect.height),
    );

    const score =
      pr +
      CENTER_PULL * centerGain +
      EDGE_PADDING * pad +
      TOUCH_BONUS +
      JITTER * Math.random();

    return { pr, score, touching, edges, corners };
  }

  // choose best rectangle position by PR (+ small biases) and RETURN meta
  private bestPlacementForPiece(
    pieceCells: number,
    deptIdx: number,
    occ: boolean[][],
    owner: number[][],
    placedRects: Rect[],
    letters: string[][],
    Wmap: Weights,
    W: number,
    H: number,
  ): { rect: Rect; meta: PlacementMeta } | null {
    const candidates = this.factorPairs(pieceCells, W, H);
    if (!candidates.length) return null;

    const cl = clusterCentroid(placedRects);
    const tx = cl ? cl.cx : W / 2;
    const ty = cl ? cl.cy : H / 2;

    let best: { score: number; rect: Rect; meta: PlacementMeta } | null = null;

    for (const { w, h } of candidates) {
      const coords: Array<{ x: number; y: number; d: number }> = [];
      for (let y = 0; y + h <= H; y++) {
        for (let x = 0; x + w <= W; x++) {
          const cx = x + w / 2;
          const cy = y + h / 2;
          const d = Math.abs(cx - tx) + Math.abs(cy - ty);
          coords.push({ x, y, d });
        }
      }
      coords.sort((a, b) => a.d - b.d);

      for (const c of coords) {
        if (!this.fits(occ, W, H, c.x, c.y, w, h)) continue;

        const rect: Rect = { name: '', idx: deptIdx, x: c.x, y: c.y, width: w, height: h };
        const meta = this.evaluatePlacement(rect, occ, owner, letters, Wmap, W, H, tx, ty);

        // ต้องแตะอะไรสักอย่าง (ตามข้อกำหนด)
        if (!meta.touching) continue;

        if (!best || meta.score > best.score) {
          best = { score: meta.score, rect, meta };
        }
      }
    }
    return best ? { rect: best.rect, meta: best.meta } : null;
  }

  private pickNextByTier(
    letters: string[][],
    placed: Set<number>,
    tcrs: number[],
    nodes: { idx: number; remaining: number }[],
  ): { idx: number; tier: Letter | 'none' } {
    const unplaced = nodes.filter((n) => n.remaining > 0).map((n) => n.idx);
    if (unplaced.length === 0) return { idx: -1, tier: 'none' };

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
        let best = bucket[0];
        for (const i of bucket) if (tcrs[i] > tcrs[best]) best = i;
        return { idx: best, tier };
      }
    }

    // fallback: highest TCR
    let best = unplaced[0];
    for (const i of unplaced) if (tcrs[i] > tcrs[best]) best = i;
    return { idx: best, tier: 'none' };
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
    const Msym = this.numericMatrixSym(letters, W);

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

    const occ: boolean[][] = Array.from({ length: gridH }, () => Array<boolean>(gridW).fill(false));
    const owner: number[][] = Array.from({ length: gridH }, () => Array(gridW).fill(-1));
    const placements: Rect[] = [];
    const placedSet = new Set<number>();
    const fragmentsCount = new Map<number, number>();
    const departmentOrder: string[] = [];
    const steps: PlacementStep[] = [];
    let stepNo = 0;

    // place seed near center first
    const placeSeed = () => {
      const target = nodes[seedIdx];
      const maxFrag = Math.max(1, opts.maxFragmentsPerDept || 1);

      const tryCenterFit = (cells: number) => {
        const pairs = this.factorPairs(cells, gridW, gridH);
        if (!pairs.length) return null;
        const gcx = gridW / 2, gcy = gridH / 2;

        let best: { score: number; rect: Rect } | null = null;

        for (const { w, h } of pairs) {
          const coords: Array<{ x: number; y: number; d: number }> = [];
          for (let y = 0; y + h <= gridH; y++) {
            for (let x = 0; x + w <= gridW; x++) {
              const cx = x + w / 2, cy = y + h / 2;
              coords.push({ x, y, d: Math.abs(cx - gcx) + Math.abs(cy - gcy) });
            }
          }
          coords.sort((a, b) => a.d - b.d);

          for (const c of coords) {
            if (!this.fits(occ, gridW, gridH, c.x, c.y, w, h)) continue;
            const rect: Rect = { name: target.name, idx: seedIdx, x: c.x, y: c.y, width: w, height: h };
            const pad = Math.min(rect.x, rect.y, gridW - (rect.x + rect.width), gridH - (rect.y + rect.height));
            const score = EDGE_PADDING * pad + JITTER * Math.random();
            if (!best || score > best.score) best = { score, rect };
            break;
          }
        }
        return best?.rect ?? null;
      };

      let rect = tryCenterFit(target.remaining);
      if (!rect && opts.allowSplitting) {
        const chunk = Math.max(1, Math.ceil(target.cells / maxFrag));
        let cells = Math.min(chunk, target.remaining);
        while (!rect && cells > 0) {
          rect = tryCenterFit(cells);
          if (!rect) cells--;
        }
      }
      if (!rect) {
        outer: for (let y = 0; y < gridH; y++) for (let x = 0; x < gridW; x++) {
          if (!occ[y][x]) { rect = { name: target.name, idx: seedIdx, x, y, width: 1, height: 1 }; break outer; }
        }
      }
      if (!rect) return false;

      this.mark(occ, owner, rect.x, rect.y, rect.width, rect.height, true, rect.idx);
      placements.push(rect);
      target.remaining -= rect.width * rect.height;
      placedSet.add(seedIdx);
      fragmentsCount.set(seedIdx, 1);
      departmentOrder.push(target.name);

      steps.push({
        step: ++stepNo,
        name: target.name,
        idx: seedIdx,
        x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        pr: 0, score: 0, tier: 'none', tcr: tcrs[seedIdx],
      });

      return true;
    };

    if (!placeSeed()) {
      return {
        error: 'Cannot place seed department',
        tcrs,
        grid: { width: gridW, height: gridH },
      };
    }

    // main loop
    while (nodes.some((n) => n.remaining > 0)) {
      const pick = this.pickNextByTier(letters, placedSet, tcrs, nodes);
      const nextIdx = pick.idx;
      if (nextIdx === -1) break;

      const target = nodes[nextIdx];
      if (!target || target.remaining <= 0) { placedSet.add(nextIdx); continue; }

      const maxFrag = Math.max(1, opts.maxFragmentsPerDept || 1);
      const already = fragmentsCount.get(nextIdx) ?? 0;
      const fragsLeft = Math.max(1, maxFrag - already);
      const chunk = opts.allowSplitting ? Math.max(1, Math.ceil(target.remaining / fragsLeft)) : target.remaining;

      let best = this.bestPlacementForPiece(
        Math.min(chunk, target.remaining),
        nextIdx,
        occ, owner,
        placements,
        letters, W,
        gridW, gridH,
      );

      let tryCells = Math.min(chunk, target.remaining);
      while (!best && tryCells > 0) {
        tryCells--;
        best = this.bestPlacementForPiece(
          tryCells,
          nextIdx,
          occ, owner,
          placements,
          letters, W,
          gridW, gridH,
        );
      }

      if (!best) {
        // fallback: first-fit single cell
        outer: for (let y = 0; y < gridH; y++) {
          for (let x = 0; x < gridW; x++) {
            if (!occ[y][x]) {
              best = {
                rect: { name: target.name, idx: nextIdx, x, y, width: 1, height: 1 },
                meta: { pr: 0, score: 0, touching: false, edges: [], corners: [] },
              };
              break outer;
            }
          }
        }
      }

      if (!best) break;

      const rect = best.rect;
      this.mark(occ, owner, rect.x, rect.y, rect.width, rect.height, true, rect.idx);
      rect.name = target.name;
      placements.push(rect);
      target.remaining -= rect.width * rect.height;
      fragmentsCount.set(nextIdx, (fragmentsCount.get(nextIdx) ?? 0) + 1);

      if (!placedSet.has(nextIdx)) {
        placedSet.add(nextIdx);
        departmentOrder.push(target.name);
      }

      steps.push({
        step: ++stepNo,
        name: target.name,
        idx: nextIdx,
        x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        pr: best.meta.pr,
        score: best.meta.score,
        tier: pick.tier,
        tcr: tcrs[nextIdx],
      });
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
      order: departmentOrder, // ออเดอร์ "ครั้งแรก" ที่แต่ละแผนกถูกวาง
      steps, // ลำดับละเอียดทุกชิ้น/ทุกการแตกบล็อก
      score: { total, closeness: closenessScore },
      placements: placements.map((r, k) => ({
        name: r.name, x: r.x, y: r.y, width: r.width, height: r.height, part: k, step: steps.find(s => s.x === r.x && s.y === r.y && s.width === r.width && s.height === r.height && s.idx === r.idx)?.step ?? undefined,
      })),
    };
  }
}

// src/CORELAP/corelap.service.ts
import { Injectable } from '@nestjs/common';
import { CreateCorelapDto } from './dto/corelap.dto';

type Weights = {
  A: number; E: number; I: number; O: number; U: number; X: number; blank: number;
};
type Letter = '' | 'A' | 'E' | 'I' | 'O' | 'U' | 'X';
const TIER_ORDER: Letter[] = ['A','E','I','O','U'];

type DeptNode = { idx: number; name: string; fixed: boolean };

type Rect = { name: string; idx: number; x: number; y: number; width: number; height: number };

type GenerateOptions = {
  allowSplitting: boolean;            // <— ไม่ใช้ในโหมดนี้
  maxFragmentsPerDept: number;        // <— ไม่ใช้ในโหมดนี้
  cellSizeMeters: number;             // info only
};

const CENTER_PULL = 0.06;
const EDGE_PADDING = 0.03;
const JITTER = 1e-3;

@Injectable()
export class CorelapService {
  private w(letter: string, W: Weights) {
    const raw = (letter || '').toUpperCase() as Letter;
    const key = (raw === '' ? 'blank' : raw) as keyof Weights;
    return (W[key] ?? 0) as number;
  }

  // สร้าง Msym = w_ij + w_ji (ใช้หา TCR/seed)
  private numericMatrixSym(letters: string[][], W: Weights) {
    const n = letters.length;
    const M = Array.from({ length: n }, () => Array(n).fill(0));
    for (let i=0;i<n;i++){
      for (let j=0;j<n;j++){
        const lij = (letters?.[i]?.[j] ?? '');
        const lji = (letters?.[j]?.[i] ?? '');
        M[i][j] = this.w(lij, W) + this.w(lji, W);
      }
      M[i][i] = 0;
    }
    return M;
  }

  private tcr(i: number, Msym: number[][]) {
    let s = 0;
    for (let j=0;j<Msym.length;j++) s += Msym[i][j];
    return s;
  }

  // น้ำหนักที่ใช้ “วาง/ให้คะแนนเพื่อนบ้าน” = max(w_ij, w_ji)
  private pairWeight(i: number, j: number, letters: string[][], W: Weights) {
    const lij = (letters?.[i]?.[j] ?? '');
    const lji = (letters?.[j]?.[i] ?? '');
    return Math.max(this.w(lij, W), this.w(lji, W));
  }

  // หา seed (TCR สูงสุด; เสมอ -> เลือก index ต่ำกว่า)
  private pickSeed(tcrs: number[]) {
    let best = 0, bestVal = -Infinity;
    for (let i=0;i<tcrs.length;i++){
      if (tcrs[i] > bestVal) { bestVal = tcrs[i]; best = i; }
    }
    return best;
  }

  // เลือกแผนกถัดไป: Tier A>E>I>O>U (ดูสัมพันธ์กับชุดที่วางแล้ว) เสมอ -> TCR สูงสุด
  private pickNextByTier(
    letters: string[][],
    placed: Set<number>,
    tcrs: number[],
    allIdx: number[],
  ) {
    const unplaced = allIdx.filter(i => !placed.has(i));
    if (!unplaced.length) return -1;
    for (const tier of TIER_ORDER) {
      const candidates: number[] = [];
      for (const i of unplaced) {
        let ok = false;
        placed.forEach(j => {
          const lij = (letters[i]?.[j] ?? '').toUpperCase();
          const lji = (letters[j]?.[i] ?? '').toUpperCase();
          if (lij === tier || lji === tier) ok = true;
        });
        if (ok) candidates.push(i);
      }
      if (candidates.length){
        let best = candidates[0];
        for (const i of candidates) if (tcrs[i] > tcrs[best]) best = i;
        return best;
      }
    }
    // ไม่มี tier กับที่วางแล้ว → ใช้ TCR สูงสุด
    let best = unplaced[0];
    for (const i of unplaced) if (tcrs[i] > tcrs[best]) best = i;
    return best;
  }

  // ให้คะแนนตำแหน่ง (x,y) แบบ 1×1 block จากเพื่อนบ้านรอบ ๆ:
  // side: 1×weight, corner: 0.5×weight + bias เข้าหาศูนย์ + padding ขอบ
  private scoreCell(
    x: number, y: number,
    deptIdx: number,
    occ: boolean[][],
    owner: number[][],
    W: number, H: number,
    letters: string[][], Wmap: Weights,
    tx: number, ty: number
  ) {
    let pr = 0;
    let touching = false;

    // 4 ด้าน (factor 1.0)
    const sides = [
      { xx: x-1, yy: y   },
      { xx: x+1, yy: y   },
      { xx: x  , yy: y-1 },
      { xx: x  , yy: y+1 },
    ];
    for (const p of sides) {
      if (p.xx>=0 && p.yy>=0 && p.xx<W && p.yy<H && occ[p.yy][p.xx]) {
        touching = true;
        const nb = owner[p.yy][p.xx];
        if (nb >= 0) pr += 1.0 * this.pairWeight(deptIdx, nb, letters, Wmap);
      }
    }

    // 4 มุม (factor 0.5)
    const corners = [
      { xx: x-1, yy: y-1 },
      { xx: x+1, yy: y-1 },
      { xx: x-1, yy: y+1 },
      { xx: x+1, yy: y+1 },
    ];
    for (const p of corners) {
      if (p.xx>=0 && p.yy>=0 && p.xx<W && p.yy<H && occ[p.yy][p.xx]) {
        touching = true;
        const nb = owner[p.yy][p.xx];
        if (nb >= 0) pr += 0.5 * this.pairWeight(deptIdx, nb, letters, Wmap);
      }
    }

    if (!touching) return -Infinity; // ต้องติด cluster เสมอ

    // center/edge bias เล็กน้อย
    const centerGain = -(Math.abs(x - tx) + Math.abs(y - ty));
    const pad = Math.min(x, y, W - 1 - x, H - 1 - y);

    return pr + CENTER_PULL*centerGain + EDGE_PADDING*pad + JITTER*Math.random();
  }

  generate(dto: CreateCorelapDto, opts: GenerateOptions) {
    const Wmap: Weights = {
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

    // ใช้แค่ชื่อ (หนึ่งบล็อกต่อแผนก)
    const nodes: DeptNode[] = (dto.departments || []).map((d, i) => ({
      idx: i, name: d.name, fixed: !!d.fixed,
    }));
    const N = nodes.length;

    // ความจุ: ต้องมี cell ว่างอย่างน้อยเท่าจำนวนแผนก
    if (N > gridW * gridH) {
      return {
        error: `Not enough cells: need ${N}, capacity ${gridW*gridH}`,
        grid: { width: gridW, height: gridH, cellSizeMeters: opts.cellSizeMeters },
      };
    }

    const letters = dto.closenessMatrix as string[][];
    const Msym = this.numericMatrixSym(letters, Wmap);
    const tcrs = nodes.map(n => this.tcr(n.idx, Msym));
    const seedIdx = this.pickSeed(tcrs);

    // แผนที่การครอบครอง
    const occ: boolean[][] = Array.from({ length: gridH }, () => Array<boolean>(gridW).fill(false));
    const owner: number[][] = Array.from({ length: gridH }, () => Array<number>(gridW).fill(-1));
    const placements: Rect[] = [];
    const placedSet = new Set<number>();
    const allIdx = nodes.map(n => n.idx);

    // วาง seed: เลือกจุดที่ใกล้ center ที่สุด
    const gcx = Math.floor(gridW/2), gcy = Math.floor(gridH/2);
    let sx = -1, sy = -1, bestD = +Infinity;
    for (let y=0;y<gridH;y++){
      for (let x=0;x<gridW;x++){
        if (occ[y][x]) continue;
        const d = Math.abs(x-gcx)+Math.abs(y-gcy);
        if (d < bestD){ bestD = d; sx = x; sy = y; }
      }
    }
    occ[sy][sx] = true; owner[sy][sx] = seedIdx;
    placements.push({ name: nodes[seedIdx].name, idx: seedIdx, x: sx, y: sy, width: 1, height: 1 });
    placedSet.add(seedIdx);

    // main loop: วางทีละแผนก เป็น 1×1 เสมอ
    while (placedSet.size < N) {
      const nextIdx = this.pickNextByTier(letters, placedSet, tcrs, allIdx);
      if (nextIdx === -1) break;

      // centroid ของ cluster เพื่อ bias เล็กน้อย
      let ax=0, ay=0, count=0;
      for (let y=0;y<gridH;y++) for (let x=0;x<gridW;x++){
        if (occ[y][x]) { ax+=x; ay+=y; count++; }
      }
      const tx = count ? ax/count : gcx;
      const ty = count ? ay/count : gcy;

      // สแกนทุก cell ว่าง หา score สูงสุด
      let bx=-1, by=-1, bscore=-Infinity;
      for (let y=0;y<gridH;y++){
        for (let x=0;x<gridW;x++){
          if (occ[y][x]) continue;
          const sc = this.scoreCell(x, y, nextIdx, occ, owner, gridW, gridH, letters, Wmap, tx, ty);
          if (sc > bscore){ bscore = sc; bx = x; by = y; }
        }
      }

      // ถ้ายังไม่มีที่ไหนแต้มได้เลย (เช่นยังไม่ติด cluster) ให้วางจุดใกล้ center ที่สุด
      if (bx < 0 || by < 0){
        let bestX=-1,bestY=-1,bestDist=+Infinity;
        for (let y=0;y<gridH;y++){
          for (let x=0;x<gridW;x++){
            if (occ[y][x]) continue;
            const d = Math.abs(x-gcx)+Math.abs(y-gcy);
            if (d < bestDist){ bestDist = d; bestX=x; bestY=y; }
          }
        }
        bx = bestX; by = bestY;
      }

      // วาง
      occ[by][bx] = true; owner[by][bx] = nextIdx;
      placements.push({ name: nodes[nextIdx].name, idx: nextIdx, x: bx, y: by, width: 1, height: 1 });
      placedSet.add(nextIdx);
    }

    // ให้คะแนนผลลัพธ์รวมด้วยกติกาเดียวกับ PR (side=1, corner=0.5) โดยเลี่ยงนับซ้ำ:
    // นับเฉพาะขวา/ลง (side) และ ขวาล่าง/ซ้ายล่าง (corner)
    let closenessScore = 0;
    for (let y=0;y<gridH;y++){
      for (let x=0;x<gridW;x++){
        const a = owner[y][x];
        if (a < 0) continue;

        // ด้านขวา
        if (x+1<gridW && owner[y][x+1] >= 0 && owner[y][x+1] !== a) {
          const b = owner[y][x+1];
          closenessScore += 1.0 * this.pairWeight(a, b, letters, Wmap);
        }
        // ด้านล่าง
        if (y+1<gridH && owner[y+1][x] >= 0 && owner[y+1][x] !== a) {
          const b = owner[y+1][x];
          closenessScore += 1.0 * this.pairWeight(a, b, letters, Wmap);
        }
        // มุมขวาล่าง
        if (x+1<gridW && y+1<gridH && owner[y+1][x+1] >= 0 && owner[y+1][x+1] !== a) {
          const b = owner[y+1][x+1];
          closenessScore += 0.5 * this.pairWeight(a, b, letters, Wmap);
        }
        // มุมซ้ายล่าง
        if (x-1>=0 && y+1<gridH && owner[y+1][x-1] >= 0 && owner[y+1][x-1] !== a) {
          const b = owner[y+1][x-1];
          closenessScore += 0.5 * this.pairWeight(a, b, letters, Wmap);
        }
      }
    }

    return {
      grid: { width: gridW, height: gridH, cellSizeMeters: opts.cellSizeMeters },
      tcr: nodes.map(n => ({ name: n.name, tcr: tcrs[n.idx] })),
      seed: nodes[seedIdx].name,
      order: placements.map(p => p.name),  // ตามลำดับการวางจริง
      score: { total: closenessScore, closeness: closenessScore },
      placements, // ทุกแผนกเป็น 1×1
    };
  }
}

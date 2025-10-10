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
type DeptNode = {
  idx: number;
  name: string;
  cells: number; // จำนวนช่องทั้งหมดของแผนก
  remaining: number; // ช่องที่ยังไม่ได้วาง
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
  // แปลงตัวอักษร closeness เป็นน้ำหนัก
  private w(letter: string, W: Weights) {
    const k = (letter || '').toUpperCase() as keyof Weights;
    return (W[k] ?? 0) as number;
  }

  private numericMatrix(letters: string[][], W: Weights): number[][] {
    const n = letters.length;
    const M = Array.from({ length: n }, () => Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const v = (letters?.[i]?.[j] ?? '').toString().trim().toUpperCase();
        M[i][j] = this.w(v as any, W);
      }
      // บังคับเส้นทแยงเป็น X
      M[i][i] = this.w('X', W);
    }
    return M;
  }

  private tcr(i: number, M: number[][]) {
    // TCR แบบ classic = sum ของแถว (หรือแถว+คอลัมน์ถ้าไม่สมมาตร)
    let s = 0;
    for (let j = 0; j < M.length; j++) s += M[i][j];
    return s;
  }

  private ccr(i: number, placed: Set<number>, M: number[][]) {
    let s = 0;
    placed.forEach((j) => (s += M[i][j]));
    return s;
  }

  // ผลรวมความยาวผนังที่สัมผัสกัน (เฉพาะติดขอบ ไม่คิด corner)
  private sharedEdgeLen(a: Rect, b: Rect): number {
    // ถ้าชนด้านซ้าย/ขวา
    const touchLR = a.x + a.width === b.x || b.x + b.width === a.x;
    const yOverlap = Math.max(
      0,
      Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
    );

    // ถ้าชนด้านบน/ล่าง
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

  private factorPairs(
    n: number,
    maxW: number,
    maxH: number,
  ): Array<{ w: number; h: number }> {
    // คืนคู่ (w,h) ที่ w*h = n และไม่เกินขนาดกริด
    const out: Array<{ w: number; h: number }> = [];
    for (let w = 1; w <= Math.min(n, maxW); w++) {
      if (n % w !== 0) continue;
      const h = n / w;
      if (h <= maxH) out.push({ w, h });
    }
    // ใกล้จัตุรัสมาก่อน
    out.sort((a, b) => Math.abs(a.w - a.h) - Math.abs(b.w - b.h));
    return out;
  }

  private bestPlacementForPiece(
    pieceCells: number,
    deptIdx: number,
    occ: boolean[][],
    placedRects: Rect[],
    M: number[][],
    W: number,
    H: number,
  ): Rect | null {
    const candidates = this.factorPairs(pieceCells, W, H);
    if (!candidates.length) return null;

    let best: { score: number; rect: Rect } | null = null;

    for (const { w, h } of candidates) {
      // สแกนทั้งกริด (ง่ายและเสถียร) – ถ้ากริดใหญ่มากค่อย optimize ภายหลัง
      for (let y = 0; y + h <= H; y++) {
        for (let x = 0; x + w <= W; x++) {
          if (!this.fits(occ, W, H, x, y, w, h)) continue;

          const candidate: Rect = {
            name: '',
            idx: deptIdx,
            x,
            y,
            width: w,
            height: h,
          };
          // PR = ผลรวม (sharedEdgeLen * weight)
          let pr = 0;
          for (const r of placedRects) {
            const len = this.sharedEdgeLen(candidate, r);
            if (len > 0) pr += len * M[deptIdx][r.idx];
          }

          // ผูกบางอย่างให้ติด cluster (เล็ก ๆ) – ให้โบนัสถ้าติดอย่างน้อยหนึ่งชิ้น
          const touchBonus = placedRects.some(
            (r) => this.sharedEdgeLen(candidate, r) > 0,
          )
            ? 0.1
            : 0;

          const score = pr + touchBonus;

          if (!best || score > best.score) {
            best = { score, rect: candidate };
          }
        }
      }
    }
    return best ? best.rect : null;
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

    // เตรียม dept list
    const nodes: DeptNode[] = (dto.departments || []).map((d, i) => ({
      idx: i,
      name: d.name,
      cells: Math.max(0, Math.floor(d.area ?? 0)),
      remaining: Math.max(0, Math.floor(d.area ?? 0)),
      fixed: !!d.fixed,
    }));

    // ตรวจความจุ
    const capacity = gridW * gridH;
    const required = nodes.reduce((s, n) => s + n.cells, 0);
    if (required > capacity) {
      return {
        error: `Cells required (${required}) exceed grid capacity (${capacity})`,
        grid: {
          width: gridW,
          height: gridH,
          cellSizeMeters: opts.cellSizeMeters,
        },
      };
    }

    const names = nodes.map((n) => n.name);
    // สร้าง matrix น้ำหนัก
    const M = this.numericMatrix(dto.closenessMatrix as any, W);

    // --- ขั้น TCR + seed
    const tcrs = nodes.map((n) => this.tcr(n.idx, M));
    let seedIdx = 0;
    let maxTCR = -Infinity;
    nodes.forEach((n) => {
      if (tcrs[n.idx] > maxTCR) {
        maxTCR = tcrs[n.idx];
        seedIdx = n.idx;
      } else if (tcrs[n.idx] === maxTCR) {
        // tie-break: ใคร cells มากกว่า
        if (n.cells > nodes[seedIdx].cells) seedIdx = n.idx;
      }
    });

    // occupancy
    const occ: boolean[][] = Array.from({ length: gridH }, () =>
      Array<boolean>(gridW).fill(false),
    );
    const placements: Rect[] = [];
    const placedSet = new Set<number>();
    const fragmentsCount = new Map<number, number>(); // deptIdx -> จำนวนชิ้นที่วางแล้ว

    // วาง seed: เริ่มพยายามวางเป็นก้อนเดียวก่อน ถ้าฟิตไม่ได้ค่อยแตก
    const placeSeed = () => {
      const target = nodes[seedIdx];
      const maxFrag = Math.max(1, opts.maxFragmentsPerDept || 1);
      const tryCells = (cells: number) =>
        this.bestPlacementForPiece(
          cells,
          seedIdx,
          occ,
          placements,
          M,
          gridW,
          gridH,
        );

      // พยายามวางเต็มก้อนก่อน
      let rect = tryCells(target.remaining);
      if (!rect && opts.allowSplitting) {
        // แตกเป็นชิ้นเล็กลงเรื่อย ๆ
        const chunk = Math.max(1, Math.ceil(target.cells / maxFrag));
        let cells = Math.min(chunk, target.remaining);
        while (!rect && cells > 0) {
          rect = tryCells(cells);
          if (!rect) cells--; // ลดลงทีละ 1 จนกว่าจะฟิต
        }
      }
      if (!rect) {
        // fallback: วาง 1 ช่องที่แรกที่เจอ
        for (let y = 0; y < gridH; y++) {
          for (let x = 0; x < gridW; x++) {
            if (!occ[y][x]) {
              rect = {
                name: target.name,
                idx: seedIdx,
                x,
                y,
                width: 1,
                height: 1,
              };
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

    // --- ไล่ตาม CCR + split ได้
    // วนจนทุกแผนกวางครบทุก cells
    const departmentOrder: string[] = [nodes[seedIdx].name];

    while (nodes.some((n) => n.remaining > 0)) {
      // เลือก dept ถัดไป: CCR สูงสุดกับชุดที่วางแล้ว
      let nextIdx = -1;
      let bestCcr = -Infinity;
      for (const n of nodes) {
        if (n.remaining <= 0) continue;
        const c = this.ccr(n.idx, placedSet, M);
        if (c > bestCcr) {
          bestCcr = c;
          nextIdx = n.idx;
        } else if (c === bestCcr) {
          // tie-break: TCR, แล้วค่อย area
          if (tcrs[n.idx] > tcrs[nextIdx]) nextIdx = n.idx;
          else if (
            tcrs[n.idx] === tcrs[nextIdx] &&
            n.cells > nodes[nextIdx].cells
          )
            nextIdx = n.idx;
        }
      }

      const target = nodes[nextIdx];
      if (nextIdx === -1 || !target) break;

      // ขนาด chunk ต่อชิ้นถ้า split ได้
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
        M,
        gridW,
        gridH,
      );

      // ถ้าไม่ฟิต ลดลงทีละ 1 cell จนวางได้
      let tryCells = Math.min(chunk, target.remaining);
      while (!rect && tryCells > 0) {
        tryCells--;
        rect = this.bestPlacementForPiece(
          tryCells,
          nextIdx,
          occ,
          placements,
          M,
          gridW,
          gridH,
        );
      }

      // ถ้ายังไม่ได้ ให้หา first-fit 1 ช่อง
      if (!rect) {
        outer: for (let y = 0; y < gridH; y++) {
          for (let x = 0; x < gridW; x++) {
            if (!occ[y][x]) {
              rect = {
                name: target.name,
                idx: nextIdx,
                x,
                y,
                width: 1,
                height: 1,
              };
              break outer;
            }
          }
        }
      }

      if (!rect) {
        // กริดเต็มหรือวางไม่ได้แล้ว
        break;
      }

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

    // คำนวณคะแนน closeness จริงจากผลวาง
    let closenessScore = 0;
    for (let i = 0; i < placements.length; i++) {
      for (let j = i + 1; j < placements.length; j++) {
        const a = placements[i],
          b = placements[j];
        if (a.idx === b.idx) continue;
        const len = this.sharedEdgeLen(a, b);
        if (len > 0) closenessScore += len * M[a.idx][b.idx];
      }
    }

    const total = closenessScore; // ตอนนี้ใช้คะแนนเดียว (เพิ่ม penalty/compactness ได้ภายหลัง)

    return {
      grid: {
        width: gridW,
        height: gridH,
        cellSizeMeters: opts.cellSizeMeters,
      },
      tcr: nodes.map((n) => ({ name: n.name, tcr: tcrs[n.idx] })),
      seed: nodes[seedIdx].name,
      order: departmentOrder,
      score: { total, closeness: closenessScore },
      // อนุญาตหลายก้อนต่อแผนก: คืน placements เป็น array ของสี่เหลี่ยมย่อย
      placements: placements.map((r, k) => ({
        name: r.name,
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        part: k, // เผื่อใช้อ้างอิงบน FE
      })),
    };
  }
}

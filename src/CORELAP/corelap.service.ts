import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CreateCorelapDto,
  DepartmentKind,
  ClosenessRating,
  ClosenessWeightsDto,
} from './dto/corelap.dto';

type Placement = { name: string; x: number; y: number; width: number; height: number };

@Injectable()
export class CorelapService {
  async generate(dto: CreateCorelapDto) {
    // 1) keep only real departments for matrix sizing
    const realDepts = dto.departments.filter((d) => d.type === DepartmentKind.DEPT);
    const n = realDepts.length;

    // 2) validate matrix size (NxN over DEPT only)
    this.assertSquareMatrix(dto.closenessMatrix, n);

    // 3) weights
    const W = this.normalizeWeights(dto.closenessWeights);

    // 4) derive sizes (width/height) from area if missing
    const sized = realDepts.map((d, idx) => {
      const { width, height } = this.ensureSize(d.width, d.height, d.area);
      return { name: d.name, width, height, fixed: !!d.fixed, x: d.x, y: d.y, idx };
    });

    // 5) trivial/seeding rule (stub) – you can replace with real CORELAP
    const order = this.seedOrder(dto.closenessMatrix, dto.seedRule, sized);

    // 6) place on grid (naive row-packer; respects grid bounds)
    const placements = this.rowPack(order, dto.gridWidth, dto.gridHeight);

    // 7) score (very rough): sum(weight(letter) / (1 + manhattan distance between centers))
    const closenessScore = this.scoreCloseness(
      placements,
      dto.closenessMatrix,
      W,
    );

    const result = {
      candidates: [
        {
          placements,
          score: { total: closenessScore, closeness: closenessScore },
        },
      ],
    };
    return result;
  }

  private assertSquareMatrix(matrix: ClosenessRating[][], n: number) {
    if (!Array.isArray(matrix) || matrix.length !== n) {
      throw new BadRequestException(`closenessMatrix must be ${n}x${n}`);
    }
    for (let i = 0; i < n; i++) {
      if (!Array.isArray(matrix[i]) || matrix[i].length !== n) {
        throw new BadRequestException(`closenessMatrix row ${i} must have length ${n}`);
      }
    }
  }

  private normalizeWeights(w?: ClosenessWeightsDto): Record<string, number> {
    const def = new ClosenessWeightsDto();
    return {
      A: w?.A ?? def.A,
      E: w?.E ?? def.E,
      I: w?.I ?? def.I,
      O: w?.O ?? def.O,
      U: w?.U ?? def.U,
      X: w?.X ?? def.X,
      blank: w?.blank ?? def.blank,
    };
  }

  private ensureSize(
    width?: number,
    height?: number,
    area?: number,
  ): { width: number; height: number } {
    if (width && height) return { width, height };
    const a = Math.max(1, area ?? 9);
    const w = Math.ceil(Math.sqrt(a));
    const h = Math.ceil(a / w);
    return { width: w, height: h };
  }

  private seedOrder(
    closeness: ClosenessRating[][],
    seedRule: 'maxDegree' | 'maxArea' | 'random' | undefined,
    sized: { name: string; width: number; height: number; idx: number }[],
  ) {
    const n = sized.length;
    const degree = (i: number) =>
      Array.from({ length: n }).reduce((acc, _, j) => {
        const c = (closeness[i]?.[j] as string) || '';
        return acc + (c ? 1 : 0);
      }, 0);

    if (seedRule === 'maxArea') {
      return [...sized].sort(
        (a, b) => b.width * b.height - a.width * a.height,
      );
    }
    if (seedRule === 'random') {
      return [...sized].sort(() => Math.random() - 0.5);
    }
    // default: maxDegree
    return [...sized].sort((a, b) => degree(b.idx) - degree(a.idx));
  }

  private rowPack(
    items: { name: string; width: number; height: number; x?: number; y?: number; fixed?: boolean }[],
    gridW: number,
    gridH: number,
  ): Placement[] {
    const out: Placement[] = [];
    let x = 0, y = 0, rowH = 0;

    for (const it of items) {
      // respect fixed position if provided and within grid
      if (it.fixed && it.x !== undefined && it.y !== undefined) {
        if (it.x + it.width > gridW || it.y + it.height > gridH) {
          throw new BadRequestException(`Fixed placement of ${it.name} is out of bounds`);
        }
        out.push({ name: it.name, x: it.x, y: it.y, width: it.width, height: it.height });
        continue;
      }

      // new row if overflow
      if (x + it.width > gridW) {
        x = 0;
        y += rowH;
        rowH = 0;
      }
      if (y + it.height > gridH) {
        throw new BadRequestException(`Grid too small to place ${it.name}`);
      }

      out.push({ name: it.name, x, y, width: it.width, height: it.height });
      x += it.width;
      rowH = Math.max(rowH, it.height);
    }
    return out;
  }

  private center(p: Placement) {
    return { cx: p.x + p.width / 2, cy: p.y + p.height / 2 };
  }

  private scoreCloseness(
    placements: Placement[],
    closeness: ClosenessRating[][],
    W: Record<string, number>,
  ): number {
    const indexByName = new Map(placements.map((p, i) => [p.name, i]));
    let s = 0;
    for (let i = 0; i < placements.length; i++) {
      for (let j = i + 1; j < placements.length; j++) {
        const pi = placements[i];
        const pj = placements[j];
        const ci = indexByName.get(pi.name)!;
        const cj = indexByName.get(pj.name)!;
        const letter = (closeness[ci]?.[cj] as string) || '';
        const w = W[letter] ?? W.blank;
        if (w === 0) continue;
        const { cx: x1, cy: y1 } = this.center(pi);
        const { cx: x2, cy: y2 } = this.center(pj);
        const dist = Math.abs(x1 - x2) + Math.abs(y1 - y2); // manhattan on centers
        s += w / (1 + dist);
      }
    }
    return Math.round(s * 100) / 100;
  }
}

import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import {
  CreateCorelapDto,
  DepartmentKind,
  ClosenessRating,
  ClosenessWeightsDto,
} from './dto/corelap.dto';

type Placement = { name: string; x: number; y: number; width: number; height: number };

@Injectable()
export class CorelapService {
  constructor(private readonly db: DatabaseService) {}

  async generate(dto: CreateCorelapDto) {
    // 1) Ensure project exists
    const proj = await this.db.project.findUnique({
      where: { id: dto.projectId },
      select: { id: true },
    });
    if (!proj) throw new BadRequestException('project not found');

    // 2) Keep only real departments (matrix is over DEPT only)
    const realDepts = dto.departments.filter((d) => d.type === DepartmentKind.DEPT);
    const n = realDepts.length;
    this.assertSquareMatrix(dto.closenessMatrix, n);

    // map original index by name (to read matrix after reordering)
    const originalIndexByName = new Map<string, number>(
      realDepts.map((d, idx) => [d.name, idx]),
    );

    // 3) Normalize weights
    const W = this.normalizeWeights(dto.closenessWeights);

    // 4) Ensure sizes (width/height) from area if missing
    const sized = realDepts.map((d, idx) => {
      const { width, height } = this.ensureSize(
        d.width,
        d.height,
        d.area,
        d.minAspectRatio,
        d.maxAspectRatio,
      );
      return {
        idx, // original index for closeness matrix
        name: d.name,
        width,
        height,
        fixed: !!d.fixed,
        x: d.x,
        y: d.y,
      };
    });

    // 5) Place items on grid (fixed first, then seeded order)
    const placements = this.place(dto, sized);

    // 6) Score result (uses originalIndexByName to read matrix correctly)
    const score = this.scoreCloseness(placements, dto.closenessMatrix, W, originalIndexByName);

    // 7) Return in FE-friendly shape
    return {
      candidates: [
        {
          placements,
          score: { total: score, closeness: score },
        },
      ],
    };
  }

  // --- validations/helpers ----------------------------------------------------

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

  // Try to satisfy area and aspect-ratio (roughly) if width/height missing
  private ensureSize(
    width?: number,
    height?: number,
    area?: number,
    minAR?: number,
    maxAR?: number,
  ): { width: number; height: number } {
    if (width && height) return { width, height };
    const a = Math.max(1, area ?? 9);
    let w = Math.ceil(Math.sqrt(a));
    let h = Math.ceil(a / w);
    const ar = w / h;
    if (minAR && ar < minAR) w = Math.ceil(h * minAR);
    if (maxAR && ar > maxAR) h = Math.ceil(w / (maxAR || 1));
    return { width: w, height: h };
  }

  private place(
    dto: CreateCorelapDto,
    sized: { idx: number; name: string; width: number; height: number; fixed: boolean; x?: number; y?: number }[],
  ): Placement[] {
    const gridW = dto.gridWidth;
    const gridH = dto.gridHeight;

    // occupancy grid
    const occ: boolean[][] = Array.from({ length: gridH }, () => Array<boolean>(gridW).fill(false));

    // mark obstacles
    for (const ob of dto.obstacles ?? []) {
      for (let yy = ob.y; yy < Math.min(gridH, ob.y + ob.height); yy++) {
        for (let xx = ob.x; xx < Math.min(gridW, ob.x + ob.width); xx++) {
          occ[yy][xx] = true;
        }
      }
    }

    const out: Placement[] = [];

    // place fixed first
    for (const d of sized.filter((s) => s.fixed)) {
      if (d.x == null || d.y == null) {
        throw new BadRequestException(`Fixed dept "${d.name}" requires x,y`);
      }
      if (d.x + d.width > gridW || d.y + d.height > gridH) {
        throw new BadRequestException(`Fixed dept "${d.name}" out of bounds`);
      }
      if (!this.fits(occ, d.x, d.y, d.width, d.height)) {
        throw new BadRequestException(`Fixed dept "${d.name}" overlaps obstacle/other`);
      }
      this.mark(occ, d.x, d.y, d.width, d.height, gridW, gridH, true);
      out.push({ name: d.name, x: d.x, y: d.y, width: d.width, height: d.height });
    }

    // order remaining by seed rule
    const order = this.seedOrder(dto.closenessMatrix, dto.seedRule, sized);

    // place non-fixed
    for (const d of order.filter((s) => !s.fixed)) {
      const p = this.firstFit(occ, d.width, d.height, gridW, gridH);
      if (!p) throw new BadRequestException(`Grid too small to place "${d.name}"`);
      this.mark(occ, p.x, p.y, d.width, d.height, gridW, gridH, true);
      out.push({ name: d.name, x: p.x, y: p.y, width: d.width, height: d.height });
    }

    return out;
  }

  private firstFit(occ: boolean[][], w: number, h: number, gridW: number, gridH: number) {
    for (let y = 0; y + h <= gridH; y++) {
      for (let x = 0; x + w <= gridW; x++) {
        if (this.fits(occ, x, y, w, h)) return { x, y };
      }
    }
    return null;
  }

  private fits(occ: boolean[][], x: number, y: number, w: number, h: number) {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (occ[yy]?.[xx]) return false;
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
    gridW: number,
    gridH: number,
    v: boolean,
  ) {
    for (let yy = y; yy < Math.min(gridH, y + h); yy++) {
      for (let xx = x; xx < Math.min(gridW, x + w); xx++) {
        occ[yy][xx] = v;
      }
    }
  }

  // Seeding rule for build order
  private seedOrder(
    closeness: ClosenessRating[][],
    seedRule: 'maxDegree' | 'maxArea' | 'random' | undefined,
    sized: {
      name: string;
      width: number;
      height: number;
      idx: number;
      fixed?: boolean;
      x?: number;
      y?: number;
    }[],
  ) {
    const n = sized.length;

    // Count non-blank closeness entries for row i
    const degree = (i: number): number =>
      Array.from({ length: n }).reduce<number>((acc, _unused, j) => {
        const c = (closeness[i]?.[j] ?? '') as string;
        return acc + (c ? 1 : 0);
      }, 0); // <-- initial 0 + generic fixes TS "unknown"

    if (seedRule === 'maxArea') {
      return [...sized].sort((a, b) => b.width * b.height - a.width * a.height);
    }
    if (seedRule === 'random') {
      return [...sized].sort(() => Math.random() - 0.5);
    }
    // default: maxDegree
    return [...sized].sort((a, b) => degree(b.idx) - degree(a.idx));
  }

  private center(p: Placement) {
    return { cx: p.x + p.width / 2, cy: p.y + p.height / 2 };
  }

  private scoreCloseness(
    placements: Placement[],
    closeness: ClosenessRating[][],
    W: Record<string, number>,
    originalIndexByName: Map<string, number>,
  ): number {
    let s = 0;
    for (let i = 0; i < placements.length; i++) {
      for (let j = i + 1; j < placements.length; j++) {
        const pi = placements[i];
        const pj = placements[j];

        // Map names to *original* closeness indices
        const ci = originalIndexByName.get(pi.name);
        const cj = originalIndexByName.get(pj.name);
        if (ci == null || cj == null) continue;

        const letter = (closeness[ci]?.[cj] as string) || '';
        const w = W[letter] ?? W.blank;
        if (w === 0) continue;

        const { cx: x1, cy: y1 } = this.center(pi);
        const { cx: x2, cy: y2 } = this.center(pj);
        const dist = Math.abs(x1 - x2) + Math.abs(y1 - y2); // Manhattan on centers
        s += w / (1 + dist);
      }
    }
    return Math.round(s * 100) / 100;
  }
}

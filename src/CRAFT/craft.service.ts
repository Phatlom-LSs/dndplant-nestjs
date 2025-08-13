import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { CreateLayoutDto, Metric } from './dto/craft.dto';

type DeptType = 'dept' | 'void';

type Department = {
  name: string;
  width: number;
  height: number;
  x: number;
  y: number;
  type?: DeptType;
  locked?: boolean;
};

type Pos = { x: number; y: number };
type Assignment = (Department & Pos & { type: DeptType; locked: boolean })[];

const LETTER_WEIGHTS: Record<string, number> = {
  A: 10,
  E: 8,
  I: 6,
  O: 4,
  U: 2,
  X: 0,
  B: 9,
  C: 7,
  D: 5,
};

@Injectable()
export class CraftAlgoService {
  constructor(private databaseService: DatabaseService) {}

  async createProject(name: string, userId: number) {
    return this.databaseService.project.create({ data: { name, userId } });
  }

  async createLayoutDepartments(dto: CreateLayoutDto) {
    if (!dto.departments?.length) {
      throw new BadRequestException('departments is required');
    }

    const gridSize = dto.gridSize;

    // normalize dept
    const depts: Department[] = dto.departments.map((d) => ({
      ...d,
      type: (d.type ?? 'dept') as DeptType,
      locked: !!d.locked,
    }));

    // map closeness letters -> numeric
    const costMatrix = this.toNumericCostMatrix(dto.costMatrix, depts);

    // create base layout + children
    const layout = await this.databaseService.layout.create({
      data: {
        name: dto.name,
        gridSize,
        projectId: dto.projectId,
        departments: {
          create: dto.departments.map((dep) => ({
            name: dep.name,
            x: dep.x,
            y: dep.y,
            width: dep.width,
            height: dep.height,
            type: dep.type === 'void' ? 'VOID' : 'DEPT',
            locked: !!dep.locked,
          })),
        },
      },
      include: { departments: true },
    });

    // === ใช้ตัว optimizer ที่รองรับ locked/void ===
    const { assignment, totalCost } = this.optimizeWithLocked(
      depts,
      gridSize,
      costMatrix,
      dto.metric as Metric,
      1200, // max iterations ปรับได้
    );

    // อัปเดตตำแหน่งใน DB (อยากข้าม locked ก็เช็คแล้วค่อยอัปเดต)
    for (const a of assignment) {
      await this.databaseService.department.updateMany({
        where: { layoutId: layout.id, name: a.name },
        data: { x: a.x, y: a.y },
      });
    }

    await this.databaseService.craftResult.create({
      data: {
        layoutId: layout.id,
        totalCost: Math.round(totalCost),
        totalDistance: Math.round(totalCost),
        resultJson: { assignment, totalCost, metric: dto.metric },
      },
    });

    return {
      layoutId: layout.id,
      assignment,
      totalCost,
    };
  }

  async getLatestResult(layoutId: string) {
    return this.databaseService.craftResult.findFirst({
      where: { layoutId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ------- helpers -------
  private toNumericCostMatrix(
    input: (number | string)[][],
    depts: Department[],
  ): number[][] {
    const n = depts.length;
    const out: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const v = input?.[i]?.[j] ?? 0;
        const isVoidPair =
          depts[i]?.type === 'void' || depts[j]?.type === 'void';
        if (isVoidPair) {
          out[i][j] = 0;
        } else if (typeof v === 'number') {
          out[i][j] = v;
        } else {
          const key = String(v).toUpperCase();
          out[i][j] = LETTER_WEIGHTS[key] ?? 0;
        }
      }
    }
    return out;
  }

  private calcCost(
    assignment: Assignment,
    nameToIndex: Map<string, number>,
    flow: number[][],
    metric: Metric,
  ): number {
    let total = 0;
    for (let i = 0; i < assignment.length; i++) {
      for (let j = 0; j < assignment.length; j++) {
        if (i === j) continue;
        const a = assignment[i];
        const b = assignment[j];
        const idxA = nameToIndex.get(a.name)!;
        const idxB = nameToIndex.get(b.name)!;
        const f = flow[idxA][idxB] || 0;
        if (f === 0) continue;

        const dx = Math.abs(a.x - b.x);
        const dy = Math.abs(a.y - b.y);
        const dist =
          metric === 'euclidean' ? Math.sqrt(dx * dx + dy * dy) : dx + dy;
        total += dist * f;
      }
    }
    return total;
  }

  // ----- packing (respect locked) -----
  private packRespectLocked(
    orderMovables: Department[],
    locked: Department[],
    gridSize: number,
  ): Assignment {
    const occ: boolean[][] = Array.from({ length: gridSize }, () =>
      Array<boolean>(gridSize).fill(false),
    );

    const lockPlaced: Assignment = locked.map((d) => {
      this.mark(occ, d.x, d.y, d.width, d.height, gridSize, true);
      return {
        ...d,
        type: (d.type ?? 'dept') as DeptType,
        locked: !!d.locked,
      };
    });

    const moves: Assignment = [];
    for (const d of orderMovables) {
      const p = this.findFirstFit(occ, d.width, d.height, gridSize);
      if (!p) {
        // fallback: วางที่เดิม
        moves.push({
          ...d,
          x: d.x,
          y: d.y,
          type: (d.type ?? 'dept') as DeptType,
          locked: !!d.locked,
        });
      } else {
        this.mark(occ, p.x, p.y, d.width, d.height, gridSize, true);
        moves.push({
          ...d,
          x: p.x,
          y: p.y,
          type: (d.type ?? 'dept') as DeptType,
          locked: !!d.locked,
        });
      }
    }

    return [...lockPlaced, ...moves];
  }

  private findFirstFit(
    occ: boolean[][],
    w: number,
    h: number,
    grid: number,
  ): Pos | null {
    for (let y = 0; y + h <= grid; y++) {
      for (let x = 0; x + w <= grid; x++) {
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
    grid: number,
    v: boolean,
  ) {
    for (let yy = y; yy < Math.min(grid, y + h); yy++) {
      for (let xx = x; xx < Math.min(grid, x + w); xx++) {
        occ[yy][xx] = v;
      }
    }
  }

  // ----- optimizer (random-swap order + pack, respect locked/void) -----
  private optimizeWithLocked(
    depts: Department[],
    gridSize: number,
    flow: number[][],
    metric: Metric,
    maxIter = 1000,
  ): { assignment: Assignment; totalCost: number } {
    const locked = depts.filter((d) => d.locked || d.type === 'void');
    const movables = depts.filter((d) => !d.locked && d.type !== 'void');

    const nameToIndex = new Map<string, number>();
    depts.forEach((d, i) => nameToIndex.set(d.name, i));

    let order = [...movables];

    let bestAssign = this.packRespectLocked(order, locked, gridSize);
    let bestCost = this.calcCost(bestAssign, nameToIndex, flow, metric);

    for (let it = 0; it < maxIter; it++) {
      if (order.length < 2) break;
      const i = Math.floor(Math.random() * order.length);
      let j = Math.floor(Math.random() * order.length);
      if (i === j) j = (j + 1) % order.length;

      const newOrder = [...order];
      [newOrder[i], newOrder[j]] = [newOrder[j], newOrder[i]];

      const assign = this.packRespectLocked(newOrder, locked, gridSize);
      const cost = this.calcCost(assign, nameToIndex, flow, metric);

      if (cost < bestCost) {
        bestCost = cost;
        bestAssign = assign;
        order = newOrder;
      }
    }

    const normalized: Assignment = bestAssign.map((d) => ({
      ...d,
      type: (d.type ?? 'dept') as DeptType,
      locked: !!d.locked,
    }));

    return { assignment: normalized, totalCost: bestCost };
  }
}

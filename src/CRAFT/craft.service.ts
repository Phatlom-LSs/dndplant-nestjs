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
  A: 10, E: 8, I: 6, O: 4, U: 2, X: 0, B: 9, C: 7, D: 5,
};

// ปรับน้ำหนักการผสม closeness -> effectiveFlow = flow + LAMBDA * closeness
const CLOSENESS_LAMBDA = 1.0;

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

    // normalize dept (เก็บ void ด้วยเพื่อใช้ pack/lock)
    const depts: Department[] = dto.departments.map((d) => ({
      ...d,
      type: (d.type ?? 'dept') as DeptType,
      locked: !!d.locked,
    }));

    // ----- ทำ order เฉพาะ dept (เมทริกซ์อิงลำดับนี้) -----
    const orderDept = depts.filter((d) => d.type !== 'void');
    const n = orderDept.length;

    // validate matrix sizes
    const flowOk =
      Array.isArray(dto.flowMatrix) &&
      dto.flowMatrix.length === n &&
      dto.flowMatrix.every((r) => Array.isArray(r) && r.length === n);

    const closeOk =
      Array.isArray(dto.closenessMatrix) &&
      dto.closenessMatrix.length === n &&
      dto.closenessMatrix.every((r) => Array.isArray(r) && r.length === n);

    if (!flowOk || !closeOk) {
      throw new BadRequestException(
        `flowMatrix/closenessMatrix size mismatch: expected ${n}x${n} for dept-only`,
      );
    }

    // closeness letters -> weights
    const closenessWeights = this.toClosenessWeights(dto.closenessMatrix);

    // effective flow = flow + λ * closeness
    const effectiveFlow: number[][] = Array.from({ length: n }, (_, i) =>
      Array.from(
        { length: n },
        (_, j) => (dto.flowMatrix[i][j] || 0) + CLOSENESS_LAMBDA * (closenessWeights[i][j] || 0),
      ),
    );

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

    // === optimizer ที่รองรับ locked/void ===
    const { assignment, totalCost } = this.optimizeWithLocked(
      depts,
      gridSize,
      // ส่ง effectiveFlow และ mapping index ตาม orderDept
      effectiveFlow,
      dto.metric as Metric,
      orderDept.map((d) => d.name),
      1200,
    );

    // อัปเดตตำแหน่งใน DB
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

    return { layoutId: layout.id, assignment, totalCost };
  }

  async getLatestResult(layoutId: string) {
    return this.databaseService.craftResult.findFirst({
      where: { layoutId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ---------- matrix helpers ----------
  private toClosenessWeights(letters: string[][]): number[][] {
    const n = letters.length;
    const out: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const v = (letters?.[i]?.[j] || '').toString().toUpperCase();
        out[i][j] = LETTER_WEIGHTS[v] ?? 0;
      }
    }
    return out;
  }

  private calcCost(
    assignment: Assignment,
    // mapping index เฉพาะ dept-only
    nameToDeptIndex: Map<string, number>,
    flowDeptOnly: number[][],
    metric: Metric,
  ): number {
    let total = 0;
    for (let i = 0; i < assignment.length; i++) {
      for (let j = 0; j < assignment.length; j++) {
        if (i === j) continue;

        const a = assignment[i];
        const b = assignment[j];

        const ia = nameToDeptIndex.get(a.name);
        const ib = nameToDeptIndex.get(b.name);
        // ถ้าเป็น void หรือไม่อยู่ใน dept-only ให้ข้าม
        if (ia == null || ib == null) continue;

        const f = flowDeptOnly[ia][ib] || 0;
        if (f === 0) continue;

        const dx = Math.abs(a.x - b.x);
        const dy = Math.abs(a.y - b.y);
        const dist = metric === 'euclidean' ? Math.sqrt(dx * dx + dy * dy) : dx + dy;

        total += dist * f;
      }
    }
    return total;
  }
  

  // ---------- packing (respect locked) ----------
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
      return { ...d, type: (d.type ?? 'dept') as DeptType, locked: !!d.locked };
    });

    const moves: Assignment = [];
    for (const d of orderMovables) {
      const p = this.findFirstFit(occ, d.width, d.height, gridSize);
      if (!p) {
        moves.push({ ...d, x: d.x, y: d.y, type: (d.type ?? 'dept') as DeptType, locked: !!d.locked });
      } else {
        this.mark(occ, p.x, p.y, d.width, d.height, gridSize, true);
        moves.push({ ...d, x: p.x, y: p.y, type: (d.type ?? 'dept') as DeptType, locked: !!d.locked });
      }
    }

    return [...lockPlaced, ...moves];
  }

  private findFirstFit(occ: boolean[][], w: number, h: number, grid: number): Pos | null {
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
  private mark(occ: boolean[][], x: number, y: number, w: number, h: number, grid: number, v: boolean) {
    for (let yy = y; yy < Math.min(grid, y + h); yy++) {
      for (let xx = x; xx < Math.min(grid, x + w); xx++) {
        occ[yy][xx] = v;
      }
    }
  }

  // ---------- optimizer (respect locked/void + dept-only flow) ----------
  private optimizeWithLocked(
    depts: Department[],
    gridSize: number,
    flowDeptOnly: number[][],
    metric: Metric,
    deptOrderNames: string[], // ลำดับที่เมทริกซ์ใช้ (เฉพาะ dept)
    maxIter = 1000,
  ): { assignment: Assignment; totalCost: number } {
    const locked = depts.filter((d) => d.locked || d.type === 'void');
    const movables = depts.filter((d) => !d.locked && d.type !== 'void');

    // map ชื่อ -> index เฉพาะ dept
    const nameToDeptIndex = new Map<string, number>();
    deptOrderNames.forEach((nm, idx) => nameToDeptIndex.set(nm, idx));

    let order = [...movables];

    let bestAssign = this.packRespectLocked(order, locked, gridSize);
    let bestCost = this.calcCost(bestAssign, nameToDeptIndex, flowDeptOnly, metric);

    for (let it = 0; it < maxIter; it++) {
      if (order.length < 2) break;
      const i = Math.floor(Math.random() * order.length);
      let j = Math.floor(Math.random() * order.length);
      if (i === j) j = (j + 1) % order.length;

      const newOrder = [...order];
      [newOrder[i], newOrder[j]] = [newOrder[j], newOrder[i]];

      const assign = this.packRespectLocked(newOrder, locked, gridSize);
      const cost = this.calcCost(assign, nameToDeptIndex, flowDeptOnly, metric);

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

import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { CreateLayoutDto, Metric } from './dto/craft.dto';

type DeptType = 'dept' | 'void';

type Block = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Department = {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  blocks: Block[];
  type?: DeptType;
  locked?: boolean;
};

type Assignment = (Department & { type: DeptType; locked: boolean })[];
type Point = { x: number; y: number };
type ReshapeAttempt = { assignment: Assignment; cost: number };
type DeptPair = { first: Department; second: Department; areaDiffRatio: number };
type MoveAttempt = ReshapeAttempt & { kind: string };

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

const CLOSENESS_LAMBDA = 1.0;
const MAX_AREA_DIFF_RATIO = 0.35;

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

    const cellSizeMeters = 1;
    const gridWidth = Math.max(1, Math.ceil(dto.plantWidthMeters));
    const gridHeight = Math.max(1, Math.ceil(dto.plantHeightMeters));

    const depts = dto.departments.map((d) => this.normalizeDepartment(d));
    for (const dept of depts) {
      this.validateDepartmentShape(dept, gridWidth, gridHeight);
    }

    if (this.hasOverlap(depts, false)) {
      throw new BadRequestException('Some departments overlap in the initial layout');
    }

    const orderDept = depts.filter((d) => d.type !== 'void');
    const n = orderDept.length;

    const flowOk =
      Array.isArray(dto.flowMatrix) &&
      dto.flowMatrix.length === n &&
      dto.flowMatrix.every((r) => Array.isArray(r) && r.length === n);
    const transportOk =
      Array.isArray(dto.transportCostMatrix) &&
      dto.transportCostMatrix.length === n &&
      dto.transportCostMatrix.every((r) => Array.isArray(r) && r.length === n);
    const closeOk =
      Array.isArray(dto.closenessMatrix) &&
      dto.closenessMatrix.length === n &&
      dto.closenessMatrix.every((r) => Array.isArray(r) && r.length === n);

    if (!flowOk || !transportOk || !closeOk) {
      throw new BadRequestException(
        `flowMatrix/transportCostMatrix/closenessMatrix size mismatch: expected ${n}x${n} for dept-only`,
      );
    }

    const closenessWeights = this.toClosenessWeights(dto.closenessMatrix);
    const transportWeightedFlow: number[][] = Array.from({ length: n }, (_, i) =>
      Array.from(
        { length: n },
        (_, j) =>
          (dto.flowMatrix[i][j] || 0) * (dto.transportCostMatrix[i][j] || 0),
      ),
    );
    const objectiveFlow: number[][] = Array.from({ length: n }, (_, i) =>
      Array.from(
        { length: n },
        (_, j) =>
          (transportWeightedFlow[i][j] || 0) +
          CLOSENESS_LAMBDA * (closenessWeights[i][j] || 0),
      ),
    );

    const layout = await this.databaseService.layout.create({
      data: {
        name: dto.name,
        gridSize: Math.max(gridWidth, gridHeight),
        gridWidth,
        gridHeight,
        projectId: dto.projectId,
        departments: {
          create: depts.map((dep) => ({
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

    const { assignment, objectiveScore } = this.optimizeWithLocked(
      depts,
      gridWidth,
      gridHeight,
      objectiveFlow,
      dto.metric,
      orderDept.map((d) => d.name),
      1200,
    );

    if (this.hasOverlap(assignment, true)) {
      throw new BadRequestException(
        'Optimized layout is invalid because some departments overlap',
      );
    }

    const nameToDeptIndex = new Map<string, number>();
    orderDept.forEach((dept, index) => nameToDeptIndex.set(dept.name, index));
    const totalDistance = this.calcInteractionScore(
      assignment,
      nameToDeptIndex,
      dto.flowMatrix,
      dto.metric,
    );
    const totalCost = this.calcInteractionScore(
      assignment,
      nameToDeptIndex,
      transportWeightedFlow,
      dto.metric,
    );

    for (const a of assignment) {
      await this.databaseService.department.updateMany({
        where: { layoutId: layout.id, name: a.name },
        data: { x: a.x, y: a.y, width: a.width, height: a.height },
      });
    }

    await this.databaseService.craftResult.create({
      data: {
        layoutId: layout.id,
        totalCost: Math.round(totalCost),
        totalDistance: Math.round(totalDistance),
        resultJson: {
          assignment,
          totalCost,
          totalDistance,
          objectiveScore,
          metric: dto.metric,
          gridWidth,
          gridHeight,
          cellSizeMeters,
          plantWidthMeters: dto.plantWidthMeters,
          plantHeightMeters: dto.plantHeightMeters,
          flowMatrix: dto.flowMatrix,
          transportCostMatrix: dto.transportCostMatrix,
          closenessMatrix: dto.closenessMatrix,
        },
      },
    });

    return {
      layoutId: layout.id,
      assignment,
      totalCost,
      totalDistance,
      gridWidth,
      gridHeight,
      cellSizeMeters,
    };
  }

  async getLatestResult(layoutId: string) {
    return this.databaseService.craftResult.findFirst({
      where: { layoutId },
      orderBy: { createdAt: 'desc' },
    });
  }

  private normalizeDepartment(
    dtoDept: CreateLayoutDto['departments'][number],
  ): Department {
    const inputBlocks = dtoDept.blocks?.length
      ? dtoDept.blocks
      : [{ x: dtoDept.x, y: dtoDept.y, width: dtoDept.width, height: dtoDept.height }];
    const bounds = this.getBounds(inputBlocks);
    const relativeBlocks = inputBlocks.map((block) => ({
      x: block.x - bounds.x,
      y: block.y - bounds.y,
      width: block.width,
      height: block.height,
    }));

    return {
      name: dtoDept.name,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      blocks: relativeBlocks,
      type: (dtoDept.type ?? 'dept') as DeptType,
      locked: !!dtoDept.locked,
    };
  }

  private validateDepartmentShape(
    dept: Department,
    gridWidth: number,
    gridHeight: number,
  ) {
    if (dept.width < 1 || dept.height < 1) {
      throw new BadRequestException(`Department "${dept.name}" has invalid size`);
    }

    const occupied = new Set<string>();
    for (const block of dept.blocks) {
      if (block.width < 1 || block.height < 1) {
        throw new BadRequestException(`Department "${dept.name}" has invalid block size`);
      }
      const abs = {
        x: dept.x + block.x,
        y: dept.y + block.y,
        width: block.width,
        height: block.height,
      };
      if (
        abs.x < 0 ||
        abs.y < 0 ||
        abs.x + abs.width > gridWidth ||
        abs.y + abs.height > gridHeight
      ) {
        throw new BadRequestException(
          `Department "${dept.name}" exceeds the computed grid ${gridWidth}x${gridHeight}`,
        );
      }
      for (const cell of this.expandBlock(abs)) {
        const key = `${cell.x},${cell.y}`;
        if (occupied.has(key)) {
          throw new BadRequestException(
            `Department "${dept.name}" contains overlapping blocks`,
          );
        }
        occupied.add(key);
      }
    }

    if (!this.isConnected(Array.from(occupied))) {
      throw new BadRequestException(
        `Department "${dept.name}" must remain connected after shaping`,
      );
    }
  }

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

  private calcInteractionScore(
    assignment: Assignment,
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
        if (ia == null || ib == null) continue;

        const f = flowDeptOnly[ia][ib] || 0;
        if (f === 0) continue;

        const pa = this.getDepartmentCenter(a);
        const pb = this.getDepartmentCenter(b);
        const dx = Math.abs(pa.x - pb.x);
        const dy = Math.abs(pa.y - pb.y);
        const dist =
          metric === 'euclidean' ? Math.sqrt(dx * dx + dy * dy) : dx + dy;

        total += dist * f;
      }
    }
    return total;
  }

  private packRespectLocked(
    orderMovables: Department[],
    locked: Department[],
    gridWidth: number,
    gridHeight: number,
  ): Assignment | null {
    const occ: boolean[][] = Array.from({ length: gridHeight }, () =>
      Array<boolean>(gridWidth).fill(false),
    );

    const lockPlaced: Assignment = [];
    for (const d of locked) {
      if (!this.canPlaceDepartment(occ, d, d.x, d.y, gridWidth, gridHeight)) {
        return null;
      }
      this.paintDepartment(occ, d, d.x, d.y, gridWidth, gridHeight, true);
      lockPlaced.push(this.withPosition(d, d.x, d.y));
    }

    const moves: Assignment = [];
    for (const d of orderMovables) {
      const p = this.findFirstFit(occ, d, gridWidth, gridHeight);
      if (!p) {
        return null;
      }
      this.paintDepartment(occ, d, p.x, p.y, gridWidth, gridHeight, true);
      moves.push(this.withPosition(d, p.x, p.y));
    }

    return [...lockPlaced, ...moves];
  }

  private currentAssignment(
    depts: Department[],
    gridWidth: number,
    gridHeight: number,
  ): Assignment | null {
    const occ: boolean[][] = Array.from({ length: gridHeight }, () =>
      Array<boolean>(gridWidth).fill(false),
    );
    const placed: Assignment = [];
    for (const dept of depts) {
      if (!this.canPlaceDepartment(occ, dept, dept.x, dept.y, gridWidth, gridHeight)) {
        return null;
      }
      this.paintDepartment(occ, dept, dept.x, dept.y, gridWidth, gridHeight, true);
      placed.push(this.withPosition(dept, dept.x, dept.y));
    }
    return placed;
  }

  private relativeDepartmentsFromAssignment(assignment: Assignment): Department[] {
    return assignment.map((dept) => {
      const bounds = this.getBounds(dept.blocks);
      return {
        name: dept.name,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        blocks: dept.blocks.map((block) => ({
          x: block.x - bounds.x,
          y: block.y - bounds.y,
          width: block.width,
          height: block.height,
        })),
        type: dept.type,
        locked: dept.locked,
      };
    });
  }

  private trySwapRelativeDepartments(
    relativeDepts: Department[],
    firstName: string,
    secondName: string,
    gridWidth: number,
    gridHeight: number,
  ): Assignment | null {
    const first = relativeDepts.find((dept) => dept.name === firstName);
    const second = relativeDepts.find((dept) => dept.name === secondName);
    if (!first || !second) return null;

    const swapped = relativeDepts.map((dept) => {
      if (dept.name === firstName) return { ...dept, x: second.x, y: second.y };
      if (dept.name === secondName) return { ...dept, x: first.x, y: first.y };
      return { ...dept };
    });

    return this.currentAssignment(swapped, gridWidth, gridHeight);
  }

  private tryRelocatePairDepartments(
    assignment: Assignment,
    firstName: string,
    secondName: string,
    gridWidth: number,
    gridHeight: number,
    nameToDeptIndex: Map<string, number>,
    flowDeptOnly: number[][],
    metric: Metric,
    currentCost: number,
  ): ReshapeAttempt | null {
    const relativeDepts = this.relativeDepartmentsFromAssignment(assignment);
    const first = relativeDepts.find((dept) => dept.name === firstName);
    const second = relativeDepts.find((dept) => dept.name === secondName);
    if (!first || !second || first.locked || second.locked) return null;

    const fixedAssignment = assignment.filter(
      (dept) => dept.name !== firstName && dept.name !== secondName,
    );
    const fixedOcc = this.buildOccupancyGridFromAssignment(
      fixedAssignment,
      gridWidth,
      gridHeight,
    );

    const firstTarget = this.getDepartmentCenter(
      assignment.find((dept) => dept.name === secondName)!,
    );
    const secondTarget = this.getDepartmentCenter(
      assignment.find((dept) => dept.name === firstName)!,
    );

    const firstCandidates = this.getPlacementCandidates(
      fixedOcc,
      first,
      firstTarget,
      gridWidth,
      gridHeight,
      48,
    );
    const secondCandidatesBase = this.getPlacementCandidates(
      fixedOcc,
      second,
      secondTarget,
      gridWidth,
      gridHeight,
      96,
    );

    let bestAttempt: ReshapeAttempt | null = null;

    for (const firstCandidate of firstCandidates) {
      const occ = fixedOcc.map((row) => [...row]);
      if (
        !this.canPlaceDepartment(
          occ,
          first,
          firstCandidate.x,
          firstCandidate.y,
          gridWidth,
          gridHeight,
        )
      ) {
        continue;
      }
      this.paintDepartment(
        occ,
        first,
        firstCandidate.x,
        firstCandidate.y,
        gridWidth,
        gridHeight,
        true,
      );

      const secondCandidates = this.sortPlacementCandidatesByTarget(
        secondCandidatesBase,
        second,
        secondTarget,
      );

      for (const secondCandidate of secondCandidates.slice(0, 48)) {
        if (
          !this.canPlaceDepartment(
            occ,
            second,
            secondCandidate.x,
            secondCandidate.y,
            gridWidth,
            gridHeight,
          )
        ) {
          continue;
        }

        const placedFirst = this.withPosition(first, firstCandidate.x, firstCandidate.y);
        const placedSecond = this.withPosition(second, secondCandidate.x, secondCandidate.y);
        const candidateAssignment = [
          ...fixedAssignment,
          placedFirst,
          placedSecond,
        ];

        if (this.hasOverlap(candidateAssignment, true)) continue;

        const candidateCost = this.calcInteractionScore(
          candidateAssignment,
          nameToDeptIndex,
          flowDeptOnly,
          metric,
        );

        if (candidateCost + 1e-9 < currentCost) {
          if (!bestAttempt || candidateCost + 1e-9 < bestAttempt.cost) {
            bestAttempt = { assignment: candidateAssignment, cost: candidateCost };
          }
        }
      }
    }

    return bestAttempt;
  }

  private tryRelocateDepartment(
    assignment: Assignment,
    deptName: string,
    gridWidth: number,
    gridHeight: number,
    nameToDeptIndex: Map<string, number>,
    flowDeptOnly: number[][],
    metric: Metric,
    currentCost: number,
  ): ReshapeAttempt | null {
    const target = assignment.find((dept) => dept.name === deptName);
    if (!target || target.locked || target.type === 'void') return null;

    const relativeTarget = this.relativeDepartmentsFromAssignment([target])[0];
    const fixedAssignment = assignment.filter((dept) => dept.name !== deptName);
    const fixedOcc = this.buildOccupancyGridFromAssignment(
      fixedAssignment,
      gridWidth,
      gridHeight,
    );
    const preferredCenter = this.getDepartmentCenter(target);
    const candidates = this.getPlacementCandidates(
      fixedOcc,
      relativeTarget,
      preferredCenter,
      gridWidth,
      gridHeight,
      96,
    );

    let bestAttempt: ReshapeAttempt | null = null;

    for (const candidate of candidates) {
      if (candidate.x === target.x && candidate.y === target.y) continue;

      const placed = this.withPosition(relativeTarget, candidate.x, candidate.y);
      const candidateAssignment = [...fixedAssignment, placed];
      if (this.hasOverlap(candidateAssignment, true)) continue;

      const candidateCost = this.calcInteractionScore(
        candidateAssignment,
        nameToDeptIndex,
        flowDeptOnly,
        metric,
      );

      if (candidateCost + 1e-9 < currentCost) {
        if (!bestAttempt || candidateCost + 1e-9 < bestAttempt.cost) {
          bestAttempt = { assignment: candidateAssignment, cost: candidateCost };
        }
      }
    }

    return bestAttempt;
  }

  private tryReshapeDepartment(
    assignment: Assignment,
    deptName: string,
    gridWidth: number,
    gridHeight: number,
    nameToDeptIndex: Map<string, number>,
    flowDeptOnly: number[][],
    metric: Metric,
    currentCost: number,
  ): ReshapeAttempt | null {
    const target = assignment.find((dept) => dept.name === deptName);
    if (!target || target.locked || target.type === 'void') return null;

    const cellKeys = this.departmentCellKeys(target);
    if (cellKeys.length <= 1) return null;

    const cellSet = new Set(cellKeys);
    const occupiedByOthers = this.assignmentOccupiedKeys(assignment, deptName);
    const boundary = cellKeys.filter((key) => {
      const [x, y] = this.parseKey(key);
      return this.neighborKeys(x, y).some((next) => !cellSet.has(next));
    });

    const frontier = new Set<string>();
    for (const key of cellKeys) {
      const [x, y] = this.parseKey(key);
      for (const next of this.neighborKeys(x, y)) {
        const [nx, ny] = this.parseKey(next);
        if (
          nx < 0 ||
          ny < 0 ||
          nx >= gridWidth ||
          ny >= gridHeight ||
          cellSet.has(next) ||
          occupiedByOthers.has(next)
        ) {
          continue;
        }
        frontier.add(next);
      }
    }

    if (!boundary.length || !frontier.size) return null;

    let bestAttempt: ReshapeAttempt | null = null;
    const frontierList = Array.from(frontier);
    const maxBoundaryChecks = Math.min(boundary.length, 48);
    const maxFrontierChecks = Math.min(frontierList.length, 64);

    for (let i = 0; i < maxBoundaryChecks; i++) {
      const removeKey = boundary[i];
      const remaining = cellKeys.filter((key) => key !== removeKey);
      if (!this.isConnected(remaining)) continue;

      const remainingSet = new Set(remaining);
      for (let j = 0; j < maxFrontierChecks; j++) {
        const addKey = frontierList[j];
        if (remainingSet.has(addKey) || occupiedByOthers.has(addKey)) continue;

        const candidateKeys = [...remaining, addKey];
        if (!this.isConnected(candidateKeys)) continue;

        const reshapedDept = this.departmentFromAbsoluteCells(target, candidateKeys);
        const candidateAssignment = assignment.map((dept) =>
          dept.name === deptName ? reshapedDept : dept,
        );

        if (this.hasOverlap(candidateAssignment, true)) continue;

        const candidateCost = this.calcInteractionScore(
          candidateAssignment,
          nameToDeptIndex,
          flowDeptOnly,
          metric,
        );

        if (candidateCost + 1e-9 < currentCost) {
          if (!bestAttempt || candidateCost + 1e-9 < bestAttempt.cost) {
            bestAttempt = { assignment: candidateAssignment, cost: candidateCost };
          }
        }
      }
    }

    return bestAttempt;
  }

  private findFirstFit(
    occ: boolean[][],
    dept: Department,
    gridWidth: number,
    gridHeight: number,
  ): Point | null {
    for (let y = 0; y + dept.height <= gridHeight; y++) {
      for (let x = 0; x + dept.width <= gridWidth; x++) {
        if (this.canPlaceDepartment(occ, dept, x, y, gridWidth, gridHeight)) {
          return { x, y };
        }
      }
    }
    return null;
  }

  private buildOccupancyGridFromAssignment(
    assignment: Assignment,
    gridWidth: number,
    gridHeight: number,
  ): boolean[][] {
    const occ: boolean[][] = Array.from({ length: gridHeight }, () =>
      Array<boolean>(gridWidth).fill(false),
    );

    for (const dept of assignment) {
      for (const block of dept.blocks) {
        for (let yy = block.y; yy < Math.min(gridHeight, block.y + block.height); yy++) {
          for (let xx = block.x; xx < Math.min(gridWidth, block.x + block.width); xx++) {
            occ[yy][xx] = true;
          }
        }
      }
    }

    return occ;
  }

  private getDepartmentArea(dept: Department): number {
    return dept.blocks.reduce((sum, block) => sum + block.width * block.height, 0);
  }

  private getAreaDiffRatio(a: Department, b: Department): number {
    const areaA = this.getDepartmentArea(a);
    const areaB = this.getDepartmentArea(b);
    return Math.abs(areaA - areaB) / Math.max(areaA, areaB, 1);
  }

  private getCompatiblePairs(departments: Department[]): DeptPair[] {
    const pairs: DeptPair[] = [];
    for (let i = 0; i < departments.length; i++) {
      for (let j = i + 1; j < departments.length; j++) {
        const first = departments[i];
        const second = departments[j];
        const areaDiffRatio = this.getAreaDiffRatio(first, second);
        if (areaDiffRatio > MAX_AREA_DIFF_RATIO) continue;
        pairs.push({ first, second, areaDiffRatio });
      }
    }
    pairs.sort((a, b) => a.areaDiffRatio - b.areaDiffRatio);
    return pairs;
  }

  private getAllPairs(departments: Department[]): DeptPair[] {
    const pairs: DeptPair[] = [];
    for (let i = 0; i < departments.length; i++) {
      for (let j = i + 1; j < departments.length; j++) {
        const first = departments[i];
        const second = departments[j];
        pairs.push({
          first,
          second,
          areaDiffRatio: this.getAreaDiffRatio(first, second),
        });
      }
    }
    pairs.sort((a, b) => a.areaDiffRatio - b.areaDiffRatio);
    return pairs;
  }

  private getPlacementCandidates(
    occ: boolean[][],
    dept: Department,
    preferredCenter: Point,
    gridWidth: number,
    gridHeight: number,
    limit: number,
  ): Point[] {
    const candidates: Array<Point & { score: number }> = [];

    for (let y = 0; y + dept.height <= gridHeight; y++) {
      for (let x = 0; x + dept.width <= gridWidth; x++) {
        if (!this.canPlaceDepartment(occ, dept, x, y, gridWidth, gridHeight)) continue;
        const center = this.getPlacedDepartmentCenter(dept, x, y);
        const dx = Math.abs(center.x - preferredCenter.x);
        const dy = Math.abs(center.y - preferredCenter.y);
        candidates.push({ x, y, score: dx + dy });
      }
    }

    candidates.sort((a, b) => a.score - b.score);
    return candidates.slice(0, limit).map(({ x, y }) => ({ x, y }));
  }

  private sortPlacementCandidatesByTarget(
    candidates: Point[],
    dept: Department,
    preferredCenter: Point,
  ): Point[] {
    return [...candidates].sort((a, b) => {
      const centerA = this.getPlacedDepartmentCenter(dept, a.x, a.y);
      const centerB = this.getPlacedDepartmentCenter(dept, b.x, b.y);
      const distanceA =
        Math.abs(centerA.x - preferredCenter.x) + Math.abs(centerA.y - preferredCenter.y);
      const distanceB =
        Math.abs(centerB.x - preferredCenter.x) + Math.abs(centerB.y - preferredCenter.y);
      return distanceA - distanceB;
    });
  }

  private canPlaceDepartment(
    occ: boolean[][],
    dept: Department,
    anchorX: number,
    anchorY: number,
    gridWidth: number,
    gridHeight: number,
  ) {
    for (const block of dept.blocks) {
      const absX = anchorX + block.x;
      const absY = anchorY + block.y;
      if (
        absX < 0 ||
        absY < 0 ||
        absX + block.width > gridWidth ||
        absY + block.height > gridHeight
      ) {
        return false;
      }
      for (let yy = absY; yy < absY + block.height; yy++) {
        for (let xx = absX; xx < absX + block.width; xx++) {
          if (occ[yy]?.[xx]) return false;
        }
      }
    }
    return true;
  }

  private paintDepartment(
    occ: boolean[][],
    dept: Department,
    anchorX: number,
    anchorY: number,
    gridWidth: number,
    gridHeight: number,
    value: boolean,
  ) {
    for (const block of dept.blocks) {
      const absX = anchorX + block.x;
      const absY = anchorY + block.y;
      for (let yy = absY; yy < Math.min(gridHeight, absY + block.height); yy++) {
        for (let xx = absX; xx < Math.min(gridWidth, absX + block.width); xx++) {
          occ[yy][xx] = value;
        }
      }
    }
  }

  private withPosition(dept: Department, x: number, y: number) {
    const absoluteBlocks = this.absoluteBlocks(dept, x, y);
    const bounds = this.getBounds(absoluteBlocks);
    return {
      ...dept,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      blocks: absoluteBlocks,
      type: (dept.type ?? 'dept') as DeptType,
      locked: !!dept.locked,
    };
  }

  private absoluteBlocks(dept: Department, x: number, y: number): Block[] {
    return dept.blocks.map((block) => ({
      x: x + block.x,
      y: y + block.y,
      width: block.width,
      height: block.height,
    }));
  }

  private hasOverlap(
    assignment: Assignment | Department[],
    blocksAbsolute: boolean,
  ): boolean {
    const occ = new Set<string>();
    for (const dept of assignment) {
      const absBlocks = blocksAbsolute
        ? dept.blocks
        : this.absoluteBlocks(dept, dept.x, dept.y);
      for (const block of absBlocks) {
        for (const cell of this.expandBlock(block)) {
          const key = `${cell.x},${cell.y}`;
          if (occ.has(key)) return true;
          occ.add(key);
        }
      }
    }
    return false;
  }

  private getDepartmentCenter(dept: Department): Point {
    const blocks = dept.blocks;
    let totalArea = 0;
    let sumX = 0;
    let sumY = 0;
    for (const block of blocks) {
      const area = block.width * block.height;
      const cx = block.x + block.width / 2;
      const cy = block.y + block.height / 2;
      totalArea += area;
      sumX += cx * area;
      sumY += cy * area;
    }
    if (totalArea === 0) {
      return { x: dept.x + dept.width / 2, y: dept.y + dept.height / 2 };
    }
    return { x: sumX / totalArea, y: sumY / totalArea };
  }

  private getPlacedDepartmentCenter(dept: Department, x: number, y: number): Point {
    return this.getDepartmentCenter({
      ...dept,
      x,
      y,
      blocks: this.absoluteBlocks(dept, x, y),
    });
  }

  private getBounds(blocks: Block[]) {
    const minX = Math.min(...blocks.map((b) => b.x));
    const minY = Math.min(...blocks.map((b) => b.y));
    const maxX = Math.max(...blocks.map((b) => b.x + b.width));
    const maxY = Math.max(...blocks.map((b) => b.y + b.height));
    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  private expandBlock(block: Block) {
    const cells: Point[] = [];
    for (let y = block.y; y < block.y + block.height; y++) {
      for (let x = block.x; x < block.x + block.width; x++) {
        cells.push({ x, y });
      }
    }
    return cells;
  }

  private isConnected(keys: string[]) {
    if (keys.length <= 1) return true;
    const all = new Set(keys);
    const queue = [keys[0]];
    const visited = new Set<string>();

    while (queue.length) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      const [x, y] = current.split(',').map(Number);
      const neighbors = [
        `${x - 1},${y}`,
        `${x + 1},${y}`,
        `${x},${y - 1}`,
        `${x},${y + 1}`,
      ];
      for (const next of neighbors) {
        if (all.has(next) && !visited.has(next)) {
          queue.push(next);
        }
      }
    }

    return visited.size === all.size;
  }

  private departmentCellKeys(dept: Department): string[] {
    const keys = new Set<string>();
    for (const block of dept.blocks) {
      for (const cell of this.expandBlock(block)) {
        keys.add(`${cell.x},${cell.y}`);
      }
    }
    return Array.from(keys);
  }

  private departmentFromAbsoluteCells(
    template: Department & { type?: DeptType; locked?: boolean },
    keys: string[],
  ): Department & { type: DeptType; locked: boolean } {
    const blocks = Array.from(new Set(keys)).map((key) => {
      const [x, y] = this.parseKey(key);
      return { x, y, width: 1, height: 1 };
    });
    const bounds = this.getBounds(blocks);
    return {
      ...template,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      blocks,
      type: (template.type ?? 'dept') as DeptType,
      locked: !!template.locked,
    };
  }

  private assignmentOccupiedKeys(
    assignment: Assignment,
    excludeDeptName?: string,
  ): Set<string> {
    const occupied = new Set<string>();
    for (const dept of assignment) {
      if (dept.name === excludeDeptName) continue;
      for (const key of this.departmentCellKeys(dept)) {
        occupied.add(key);
      }
    }
    return occupied;
  }

  private neighborKeys(x: number, y: number): string[] {
    return [
      `${x - 1},${y}`,
      `${x + 1},${y}`,
      `${x},${y - 1}`,
      `${x},${y + 1}`,
    ];
  }

  private parseKey(key: string): [number, number] {
    const [x, y] = key.split(',').map(Number);
    return [x, y];
  }

  private optimizeWithLocked(
    depts: Department[],
    gridWidth: number,
    gridHeight: number,
    flowDeptOnly: number[][],
    metric: Metric,
    deptOrderNames: string[],
    maxIter = 1000,
  ): { assignment: Assignment; objectiveScore: number } {
    const locked = depts.filter((d) => d.locked || d.type === 'void');
    const movables = depts.filter((d) => !d.locked && d.type !== 'void');

    const nameToDeptIndex = new Map<string, number>();
    deptOrderNames.forEach((nm, idx) => nameToDeptIndex.set(nm, idx));

    let order = [...movables];
    const currentAssign = this.currentAssignment(depts, gridWidth, gridHeight);
    const packedAssign = this.packRespectLocked(order, locked, gridWidth, gridHeight);
    const initialAssign = currentAssign ?? packedAssign;
    if (!initialAssign) {
      throw new BadRequestException(
        'Departments cannot be packed into the computed grid without overlap',
      );
    }

    let bestAssign = initialAssign;
    let bestRelative = this.relativeDepartmentsFromAssignment(initialAssign);
    let bestCost = this.calcInteractionScore(
      bestAssign,
      nameToDeptIndex,
      flowDeptOnly,
      metric,
    );

    for (let it = 0; it < maxIter; it++) {
      if (order.length < 2) break;
      const i = Math.floor(Math.random() * order.length);
      let j = Math.floor(Math.random() * order.length);
      if (i === j) j = (j + 1) % order.length;

      const newOrder = [...order];
      [newOrder[i], newOrder[j]] = [newOrder[j], newOrder[i]];

      const assign = this.packRespectLocked(
        newOrder,
        locked,
        gridWidth,
        gridHeight,
      );
      if (!assign) continue;

      const cost = this.calcInteractionScore(
        assign,
        nameToDeptIndex,
        flowDeptOnly,
        metric,
      );
      if (cost < bestCost) {
        bestCost = cost;
        bestAssign = assign;
        bestRelative = this.relativeDepartmentsFromAssignment(assign);
        order = newOrder;
      }
    }

    let improved = true;
    while (improved) {
      improved = false;
      const movableCandidates = bestRelative.filter(
        (dept) => !dept.locked && dept.type !== 'void',
      );
      const allPairs = this.getAllPairs(movableCandidates);
      const compatiblePairs = allPairs.filter(
        (pair) => pair.areaDiffRatio <= MAX_AREA_DIFF_RATIO,
      );
      let roundBest: MoveAttempt | null = null;

      for (const pair of allPairs) {
        const swappedAssign = this.trySwapRelativeDepartments(
          bestRelative,
          pair.first.name,
          pair.second.name,
          gridWidth,
          gridHeight,
        );
        if (swappedAssign) {
          const swappedCost = this.calcInteractionScore(
            swappedAssign,
            nameToDeptIndex,
            flowDeptOnly,
            metric,
          );

          if (swappedCost + 1e-9 < bestCost) {
            if (!roundBest || swappedCost + 1e-9 < roundBest.cost) {
              roundBest = {
                assignment: swappedAssign,
                cost: swappedCost,
                kind: 'swap',
              };
            }
          }
        }
      }

      for (const pair of compatiblePairs) {
        const relocated = this.tryRelocatePairDepartments(
          bestAssign,
          pair.first.name,
          pair.second.name,
          gridWidth,
          gridHeight,
          nameToDeptIndex,
          flowDeptOnly,
          metric,
          bestCost,
        );
        if (relocated && relocated.cost + 1e-9 < bestCost) {
          if (!roundBest || relocated.cost + 1e-9 < roundBest.cost) {
            roundBest = { ...relocated, kind: 'pair-relocate' };
          }
        }
      }

      for (const dept of movableCandidates) {
        const relocatedSingle = this.tryRelocateDepartment(
          bestAssign,
          dept.name,
          gridWidth,
          gridHeight,
          nameToDeptIndex,
          flowDeptOnly,
          metric,
          bestCost,
        );
        if (relocatedSingle) {
          if (!roundBest || relocatedSingle.cost + 1e-9 < roundBest.cost) {
            roundBest = { ...relocatedSingle, kind: 'relocate' };
          }
        }

        const reshaped = this.tryReshapeDepartment(
          bestAssign,
          dept.name,
          gridWidth,
          gridHeight,
          nameToDeptIndex,
          flowDeptOnly,
          metric,
          bestCost,
        );
        if (!reshaped) continue;

        if (!roundBest || reshaped.cost + 1e-9 < roundBest.cost) {
          roundBest = { ...reshaped, kind: 'reshape' };
        }
      }

      if (roundBest && roundBest.cost + 1e-9 < bestCost) {
        bestAssign = roundBest.assignment;
        bestCost = roundBest.cost;
        bestRelative = this.relativeDepartmentsFromAssignment(roundBest.assignment);
        improved = true;
      }
    }

    return { assignment: bestAssign, objectiveScore: bestCost };
  }
}

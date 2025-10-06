import { Body, Controller, Post, BadRequestException } from '@nestjs/common';
import { CorelapService } from './corelap.service';
import {
  CreateCorelapDto,
  DepartmentKind,
  ClosenessWeightsDto,
  ClosenessRating,
} from './dto/corelap.dto';

const VALID: Set<ClosenessRating> = new Set(['', 'A', 'E', 'I', 'O', 'U', 'X']);

@Controller('corelap')
export class CorelapController {
  constructor(private readonly service: CorelapService) {}

  @Post('generate')
  async generate(@Body() raw: any) {
    try {
      // --- normalize numerics (in case they are strings)
      const gridWidth  = Number(raw.gridWidth);
      const gridHeight = Number(raw.gridHeight);
      if (!Number.isFinite(gridWidth) || !Number.isFinite(gridHeight) || gridWidth < 1 || gridHeight < 1) {
        throw new BadRequestException('gridWidth/gridHeight required (>=1)');
      }

      // --- normalize departments
      const departments = (raw.departments ?? []).map((d: any) => ({
        type: (d.type ?? DepartmentKind.DEPT) as DepartmentKind,
        fixed: !!d.fixed,
        locked: !!d.locked,
        name: String(d.name ?? ''),
        x: d.x != null ? Number(d.x) : undefined,
        y: d.y != null ? Number(d.y) : undefined,
        width:  d.width  != null ? Number(d.width)  : undefined,
        height: d.height != null ? Number(d.height) : undefined,
        area:   d.area   != null ? Number(d.area)   : undefined,
        minAspectRatio: d.minAspectRatio != null ? Number(d.minAspectRatio) : undefined,
        maxAspectRatio: d.maxAspectRatio != null ? Number(d.maxAspectRatio) : undefined,
      }));

      if (!departments.length) throw new BadRequestException('departments required');

      // --- DEPT-only count for NxN check
      const realDepts = departments.filter((d) => d.type === DepartmentKind.DEPT);
      const n = realDepts.length;

      // --- sanitize closeness matrix to allowed letters and ensure NxN
      const closenessMatrix: ClosenessRating[][] = Array.isArray(raw.closenessMatrix)
        ? raw.closenessMatrix.map((row: any[]) =>
            (row ?? []).map((cell: any) => {
              const v = typeof cell === 'string' ? cell.trim().toUpperCase() : '';
              return (VALID.has(v as ClosenessRating) ? v : '') as ClosenessRating;
            }),
          )
        : [];

      if (
        closenessMatrix.length !== n ||
        closenessMatrix.some((r) => r.length !== n)
      ) {
        throw new BadRequestException(`closenessMatrix must be ${n}x${n} (DEPT only)`);
      }

      // --- capacity check (sum of required cells must fit grid)
      const requiredCells = realDepts.reduce((s, d) => {
        if (d.width && d.height) return s + d.width * d.height;
        if (d.area) return s + d.area;
        return s; // if neither provided, treat as 0; service will size it
      }, 0);
      const capacity = gridWidth * gridHeight;
      if (requiredCells > capacity) {
        throw new BadRequestException(
          `Grid too small: required ${requiredCells} > capacity ${capacity}`,
        );
      }

      // --- weights: accept FE alias "weights"
      const closenessWeights =
        raw.closenessWeights ?? raw.weights ?? new ClosenessWeightsDto();

      // --- build DTO for service
      const dto: CreateCorelapDto = {
        ...raw,
        name: String(raw.name ?? ''),
        projectId: String(raw.projectId ?? ''), // optional validation can be in service
        gridWidth,
        gridHeight,
        departments,
        closenessMatrix,
        closenessWeights,
        seedRule: raw.seedRule ?? undefined,
        obstacles: raw.obstacles ?? undefined,
        adjacencyConstraints: raw.adjacencyConstraints ?? undefined,
        borderPreferences: raw.borderPreferences ?? undefined,
        zoneConstraints: raw.zoneConstraints ?? undefined,
      };

      // --- call service
      const result = await this.service.generate(dto);

      // --- ensure FE always finds placements (root + candidates[0])
      const first = (result as any)?.candidates?.[0] ?? result;
      const placements =
        first?.placements ?? first?.assignment ?? (result as any)?.placements ?? [];

      return {
        ...result,
        placements, // root-level mirror for FE
        score: first?.score ?? (result as any)?.score,
      };
    } catch (e: any) {
      // Return JSON body so FE can show exact reason (instead of generic alert)
      // NOTE: keep 200 if you prefer; here we rethrow as BadRequest to keep semantics.
      throw new BadRequestException(e?.message ?? 'CORELAP generate failed');
      // or: return { error: e?.message ?? 'CORELAP generate failed' };
    }
  }
}

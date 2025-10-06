import { Body, Controller, Post, BadRequestException } from '@nestjs/common';
import { CorelapService } from './corelap.service';
import {
  CreateCorelapDto,
  DepartmentKind,
  ClosenessWeightsDto,
} from './dto/corelap.dto';

@Controller('corelap')
export class CorelapController {
  constructor(private readonly service: CorelapService) {}

  @Post('generate')
  async generate(@Body() raw: any) {
    // --- normalize payload to match your DTO contract
    const dto: CreateCorelapDto = {
      ...raw,
      // accept FE "weights" alias
      closenessWeights:
        raw.closenessWeights ??
        raw.weights ?? // FE sends "weights"
        new ClosenessWeightsDto(),
      departments: (raw.departments || []).map((d) => ({
        type: d.type ?? DepartmentKind.DEPT, // default to DEPT
        fixed: !!d.fixed,
        locked: !!d.locked,
        name: d.name,
        x: d.x, y: d.y,
        width: d.width, height: d.height,
        area: d.area,
        minAspectRatio: d.minAspectRatio,
        maxAspectRatio: d.maxAspectRatio,
      })),
    };

    // basic guards
    if (!Array.isArray(dto.departments) || dto.departments.length === 0) {
      throw new BadRequestException('departments required');
    }
    if (!Array.isArray(dto.closenessMatrix)) {
      throw new BadRequestException('closenessMatrix required');
    }
    if (!dto.gridWidth || !dto.gridHeight) {
      throw new BadRequestException('gridWidth/gridHeight required');
    }

    return this.service.generate(dto);
  }
}

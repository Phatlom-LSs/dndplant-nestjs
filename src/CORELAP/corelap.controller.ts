// src/CORELAP/corelap.controller.ts
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
    const closenessWeights =
      raw.closenessWeights ?? raw.weights ?? new ClosenessWeightsDto();

    const departments = (raw.departments || []).map((d: any) => ({
      name: d.name,
      fixed: !!d.fixed,
      area: Number(d.area ?? 0),
      type: DepartmentKind.DEPT,
      locked: false,
    }));

    const dto: CreateCorelapDto = {
      name: raw.name || 'Generated',
      projectId: raw.projectId,
      gridWidth: Number(raw.gridWidth),
      gridHeight: Number(raw.gridHeight),
      departments,
      closenessMatrix: raw.closenessMatrix,
      closenessWeights,
      // option เฉพาะอัลกอริทึม
      seedRule: 'maxDegree',
      // ไม่บังคับใน DTO เดิม: ส่งต่อไป service ผ่าน raw.settings ก็ได้
    } as any;

    // guard เบื้องต้น
    const n = departments.length;
    if (!n) throw new BadRequestException('departments required');
    if (!Array.isArray(dto.closenessMatrix) || dto.closenessMatrix.length !== n) {
      throw new BadRequestException('closenessMatrix must be NxN of departments');
    }
    if (!dto.closenessMatrix.every((r) => Array.isArray(r) && r.length === n)) {
      throw new BadRequestException('closenessMatrix must be NxN of departments');
    }
    if (!dto.gridWidth || !dto.gridHeight) {
      throw new BadRequestException('gridWidth/gridHeight required');
    }

    // options สำหรับ split
    const options = {
      allowSplitting: raw.allowSplitting ?? true,
      maxFragmentsPerDept: raw.maxFragmentsPerDept ?? 3,
      cellSizeMeters: raw.cellSizeMeters ?? 5,
    };

    return this.service.generate(dto, options);
  }
}

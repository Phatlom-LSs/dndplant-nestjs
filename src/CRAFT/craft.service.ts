import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { CreateLayoutDto } from './dto/craft.dto';

@Injectable()
export class craftAlgoService {
  constructor(private databaseService: DatabaseService) {}

  async createLayoutDepartments(dto: CreateLayoutDto) {
    return this.databaseService.layout.create({
      data: {
        name: dto.name,
        gridSize: dto.gridSize,
        projectId: dto.projectId,
        departments: {
          create: dto.departments.map((dep) => ({
            name: dep.name,
            x: dep.x,
            y: dep.y,
            width: dep.width,
            height: dep.height,
          })),
        },
      },
      include: { departments: true },
    });
  }

  async getLatestResult(layoutId: string) {
    return this.databaseService.craftResult.findFirst({
      where: { layoutId },
      orderBy: { createdAt: 'desc' },
    });
  }
}

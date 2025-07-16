import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { CreateLayoutDto } from './dto/craft.dto';
import { bruteForceLayout } from './brutal-algorithm';

@Injectable()
export class CraftAlgoService {
  constructor(private databaseService: DatabaseService) {}

  async createProject(name: string, userId: number) {
    const project = await this.databaseService.project.create({
      data: { name, userId },
    });
    return project;
  }

  async createLayoutDepartments(dto: CreateLayoutDto) {
    // Create layout + departments
    const layout = await this.databaseService.layout.create({
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

    const { assignment, totalCost } = bruteForceLayout(
      dto.departments,
      dto.gridSize,
      dto.costMatrix,
      dto.metric,
    );

    for (let i = 0; i < assignment.length; i++) {
      const depName = assignment[i].name;
      await this.databaseService.department.updateMany({
        where: { layoutId: layout.id, name: depName },
        data: { x: assignment[i].x, y: assignment[i].y },
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
}

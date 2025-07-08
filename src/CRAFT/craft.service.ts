import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { CreateLayoutDto } from 'src/CRAFT/dto/craft.dto';

@Injectable()
export class CraftAlgoService {
  constructor(private databaseService: DatabaseService) {}

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

    // Calculate CRAFT
    const result = this.calCraft(layout, dto.costMatrix, dto.metric);

    // Save CraftResult
    await this.databaseService.craftResult.create({
      data: {
        layoutId: layout.id,
        totalCost: Math.round(result.totalCost),
        totalDistance: Math.round(result.totalDistance),
        resultJson: result,
      },
    });

    return result;
  }

  async getLatestResult(layoutId: string) {
    return this.databaseService.craftResult.findFirst({
      where: { layoutId },
      orderBy: { createdAt: 'desc' },
    });
  }

  calCraft(
    layout: any,
    costMatrix: number[][],
    metric: 'manhattan' | 'euclidean',
  ) {
    const depts = layout.departments;
    let totalCost = 0;
    let totalDistance = 0;

    for (let i = 0; i < depts.length; i++) {
      for (let j = 0; j < depts.length; j++) {
        if (i !== j) {
          const depA = depts[i];
          const depB = depts[j];
          const flow = costMatrix[i][j];
          let dist;
          if (metric === 'euclidean') {
            dist = Math.sqrt(
              Math.pow(depA.x - depB.x, 2) + Math.pow(depA.y - depB.y, 2)
            );
          } else {
            dist = Math.abs(depA.x - depB.x) + Math.abs(depA.y - depB.y);
          }
          totalDistance += dist * flow;
          totalCost += dist * flow;
        }
      }
    }
    return {
      totalCost,
      totalDistance,
      assignment: depts,
      matrix: costMatrix,
      metric,
    };
  }
}

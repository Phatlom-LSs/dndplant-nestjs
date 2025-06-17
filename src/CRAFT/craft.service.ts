import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';

@Injectable()
export class craftAlgoService {
  constructor(private databaseService: DatabaseService) {}

  async createLayoutWithDepartments(input: {
    name: string;
    gridSize: number;
    projectId: string;
    departments: Array<{
      name: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }>;
  }) {
    return this.databaseService.layout.create({
      data: {
        name: input.name,
        gridSize: input.gridSize,
        projectId: input.projectId,
        departments: {
          create: input.departments.map((dep) => ({
            name: dep.name,
            x: dep.x,
            y: dep.y,
            width: dep.width,
            height: dep.height,
          })),
        },
      },
      include: { departments: true, project: true },
    });
  }
}

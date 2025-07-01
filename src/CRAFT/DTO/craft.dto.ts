export class CreateLayoutDto {
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
}

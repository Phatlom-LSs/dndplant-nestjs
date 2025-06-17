export class CreateLayoutDto {
  name: string;
  gridSize: number;
  projectId: string;
  departments: {
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }[];
}

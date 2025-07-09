import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsString,
} from 'class-validator';

export class CreateLayoutDto {
  @IsString()
  name: string;

  @IsInt()
  gridSize: number;

  @IsString()
  projectId: string;

  @IsArray()
  @ArrayMinSize(1)
  departments: Array<{
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  @IsArray()
  costMatrix: number[][];

  @IsEnum(['manhattan', 'euclidean'])
  metric: 'manhattan' | 'euclidean';
}

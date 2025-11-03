import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum Metric {
  MANHATTAN = 'manhattan',
  EUCLIDEAN = 'euclidean',
}

export enum DepartmentKind {
  DEPT = 'dept',
  VOID = 'void',
}

export class DepartmentDto {
  @IsString()
  name!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  x!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  y!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  width!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  height!: number;

  @IsEnum(DepartmentKind)
  type!: DepartmentKind; // 'dept' | 'void'

  @IsBoolean()
  @Type(() => Boolean)
  locked!: boolean;
}

export class CreateLayoutDto {
  @IsString()
  name!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  gridSize!: number;

  @IsString()
  projectId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DepartmentDto)
  departments!: DepartmentDto[];

  @IsArray()
  flowMatrix: number[][];

  @IsArray()
  closenessMatrix: ('' | 'A' | 'E' | 'I' | 'O' | 'U' | 'X')[][];

  @IsEnum(Metric)
  metric!: Metric;
}

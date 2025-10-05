import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
  IsIn,
  IsNumber,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum DepartmentKind {
  DEPT = 'dept',
  VOID = 'void',
}

export type ClosenessRating = '' | 'A' | 'E' | 'I' | 'O' | 'U' | 'X';

export class ClosenessWeightsDto {
  @Type(() => Number) @IsNumber() A: number = 10;
  @Type(() => Number) @IsNumber() E: number = 8;
  @Type(() => Number) @IsNumber() I: number = 6;
  @Type(() => Number) @IsNumber() O: number = 4;
  @Type(() => Number) @IsNumber() U: number = 2;
  @Type(() => Number) @IsNumber() X: number = 0;
  @Type(() => Number) @IsNumber() blank: number = 0;
}

export class AdjacencyConstraintDto {
  @IsString() from!: string;
  @IsString() to!: string;
  @IsIn(['require', 'avoid', 'prefer', 'separate'])
  kind!: 'require' | 'avoid' | 'prefer' | 'separate';
  weight?: number;
}

export class BorderPreferenceDto {
  @IsString() dept!: string;
  @IsIn(['north', 'south', 'east', 'west', 'any'])
  edge!: 'north' | 'south' | 'east' | 'west' | 'any';
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  strenght?: number;
}

export class ZoneRectDto {
  @Type(() => Number) @IsInt() @Min(0) x!: number;
  @Type(() => Number) @IsInt() @Min(0) y!: number;
  @Type(() => Number) @IsInt() @Min(1) width!: number;
  @Type(() => Number) @IsInt() @Min(1) height!: number;
}

export class ZoneConstraintDto {
  @IsString() dept!: string;
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ZoneRectDto)
  allowedRects?: ZoneRectDto[];
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ZoneRectDto)
  forbiddenRects?: ZoneRectDto[];
}

export class DepartmentDto {
  @IsString() name!: string;

  // If fixed = true it should have Position/Site; If Fasle systems will do it auto.
  @IsBoolean()
  @Type(() => Boolean)
  fixed: boolean = false;

  @ValidateIf((o) => o.fixed)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  x?: number;

  @ValidateIf((o) => o.fixed)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  y?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  width?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  height?: number;

  @ValidateIf((o) => !o.width || !o.height)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  area?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  minAspectRatio?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  maxAspectRatio?: number;

  @IsEnum(DepartmentKind)
  type!: DepartmentKind; // 'dept' | 'void'

  @IsBoolean()
  @Type(() => Boolean)
  locked: boolean = false;
}

export class ObstacleDto {
  @Type(() => Number) @IsInt() @Min(0) x!: number;
  @Type(() => Number) @IsInt() @Min(0) y!: number;
  @Type(() => Number) @IsInt() @Min(0) width!: number;
  @Type(() => Number) @IsInt() @Min(0) height!: number;
}

export class CreateCorelapDto {
  @IsString() name!: string;

  // ขนาดพื้นที่จัดวางแบบ grid (จำเป็นสำหรับ CORELAP)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  gridWidth!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  gridHeight!: number;

  @IsString() projectId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DepartmentDto)
  departments!: DepartmentDto[];

  // NxN เฉพาะ DEPT จริง (ไม่รวม VOID/Obstacle)
  @IsArray()
  closenessMatrix!: ClosenessRating[][];

  @IsOptional()
  @ValidateNested()
  @Type(() => ClosenessWeightsDto)
  closenessWeights?: ClosenessWeightsDto;

  // constraints เสริม
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => AdjacencyConstraintDto)
  adjacencyConstraints?: AdjacencyConstraintDto[];

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => BorderPreferenceDto)
  borderPreferences?: BorderPreferenceDto[];

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ZoneConstraintDto)
  zoneConstraints?: ZoneConstraintDto[];

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ObstacleDto)
  obstacles?: ObstacleDto[];

  @IsOptional()
  @IsIn(['maxDegree', 'maxArea', 'random'])
  seedRule?: 'maxDegree' | 'maxArea' | 'random';
}

import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AldepDepartmentDto {
  @IsString()
  name: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  area?: number;

  @IsOptional()
  @IsBoolean()
  fixed?: boolean;
}

export class AldepGenerateDto {
  @IsString()
  name: string;

  @IsString()
  projectId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  gridWidth: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  gridHeight: number;

  @ValidateNested({ each: true })
  @Type(() => AldepDepartmentDto)
  departments: AldepDepartmentDto[];

  @IsArray()
  closenessMatrix: string[][];

  // weights object ไม่บังคับ cast ราย field ก็ได้
  @IsOptional()
  closenessWeights?: Record<
    'A' | 'E' | 'I' | 'O' | 'U' | 'X' | 'blank',
    number
  >;

  @IsOptional()
  @IsIn(['A', 'E', 'I', 'O', 'U', 'X', ''])
  lowerBound?: '' | 'A' | 'E' | 'I' | 'O' | 'U' | 'X';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  stripWidth?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  seeds?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxFragmentsPerDept?: number;

  @IsOptional()
  @IsBoolean()
  allowSplitting?: boolean;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  cellSizeMeters?: number;
}

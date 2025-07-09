import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
} from '@nestjs/common';
import { CraftAlgoService } from './craft.service';
import { CreateLayoutDto } from './dto/craft.dto';

@Controller('craft')
export class layoutController {
  constructor(private readonly layoutService: CraftAlgoService) {}

  @Post('project')
  async createProject(@Body() body: { name: string; userId: number }) {
    return this.layoutService.createProject(body.name, body.userId);
  }

  @Post('layout')
  async createLayout(@Body() dto: CreateLayoutDto) {
    if (!dto || !dto.departments || !Array.isArray(dto.departments)) {
      throw new BadRequestException('Invalid or missing departments array');
    }
    return this.layoutService.createLayoutDepartments(dto);
  }

  @Get('result')
  async getLayout(@Query('layoutId') layoutId: string) {
    if (!layoutId) {
      throw new BadRequestException('layoutID is required');
    }
    return this.layoutService.getLatestResult(layoutId);
  }
}

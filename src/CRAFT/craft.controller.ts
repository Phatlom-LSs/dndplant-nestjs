import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CraftAlgoService } from './craft.service';
import { CreateLayoutDto } from './dto/craft.dto';

@Controller('craftLayout')
export class layoutController {
  constructor(private readonly layoutService: CraftAlgoService) {}

  @Post('layout')
  async createLayout(@Body() dto: CreateLayoutDto) {
    return this.layoutService.createLayoutDepartments(dto);
  }

  @Get('result')
  async getLayout(@Query('layoutId') layoutId: string) {
    return this.layoutService.getLatestResult(layoutId);
  }
}

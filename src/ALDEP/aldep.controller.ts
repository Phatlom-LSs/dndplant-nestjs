// src/ALDEP/aldep.controller.ts
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AldepService } from './aldep.service';
import { GenerateAldepDto } from './dto/aldep.dto';

@Controller('aldep')
export class AldepController {
  constructor(private readonly svc: AldepService) {}

  @Post('generate')
  async generate(@Body() dto: GenerateAldepDto) {
    return this.svc.generate(dto);
  }

  @Get('run/:id')
  async getRun(@Param('id') id: string) {
    return this.svc.getRun(id);
  }
}

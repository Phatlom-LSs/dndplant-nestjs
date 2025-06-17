import { Body, Controller, Post } from '@nestjs/common';
import { craftAlgoService } from './craft.service';
import { CreateLayoutDto } from './DTO/craft.dto';

@Controller('craftLayout')
export class layoutController {
  constructor(private readonly layoutService: craftAlgoService) {}

  @Post('createLayout')
  async create(@Body() dto: CreateLayoutDto) {
    return this.layoutService.createLayoutWithDepartments(dto);
  }
}

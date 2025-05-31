import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { PersonalService } from './personal.service';
import { Prisma } from '@prisma/client';
import { JwtAuthGuard } from 'src/auth/jwt.guard';

@Controller('personal')
export class PersonalController {
  constructor(private readonly personalService: PersonalService) {}

  @Post()
  create(@Body() createPersonalDto: Prisma.userdataCreateInput) {
    return this.personalService.create(createPersonalDto);
  }

  @Get()
  findAll() {
    return this.personalService.findAll();
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.personalService.findOne(+id);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.personalService.remove(+id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updatePersonalDto: Prisma.userdataUpdateInput,
  ) {
    return this.personalService.patch(+id, updatePersonalDto);
  }
}

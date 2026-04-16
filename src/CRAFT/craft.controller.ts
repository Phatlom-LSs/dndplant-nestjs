import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from 'src/auth/jwt.guard';
import { CraftAlgoService } from './craft.service';
import { CreateLayoutDto } from './dto/craft.dto';

type AuthenticatedRequest = Request & {
  user: {
    id: number;
    username: string;
  };
};

@Controller('craft')
export class layoutController {
  constructor(private readonly layoutService: CraftAlgoService) {}

  @Post('project')
  @UseGuards(JwtAuthGuard)
  async createProject(
    @Body() body: { name: string },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.layoutService.createProject(body.name, req.user.id);
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
